import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/*
 * Outbound requests to URLs an org admin typed (OIDC discovery, SAML metadata):
 * the gateway and Keycloak sit inside the cluster network, so such a URL must
 * not reach the VNet, cluster services, loopback or cloud metadata (SSRF).
 *
 * - https only (http only when allowHttp, development).
 * - No credentials in the URL; optional host allowlist (exact or `*.suffix`).
 * - Every address the name resolves to must be public. The fetch resolves
 *   once, checks, and dials that exact address, so DNS rebinding between
 *   check and connect does not get through.
 * - No redirects, a size cap, a timeout, and errors that never echo upstream
 *   detail back to the caller.
 */

export interface EgressPolicy {
  /** Allow http:// (development: the dev IdP is http://localhost). */
  allowHttp?: boolean;
  /** Allow private, loopback and cluster addresses (development only). */
  allowPrivate?: boolean;
  /** When non-empty, the host must be one of these (`idp.example.com` or `*.okta.com`). */
  allowedHosts?: string[];
}

export class EgressError extends Error {
  constructor(
    message: string,
    /** Detail for the log only, never for the client. */
    readonly detail?: string,
    /**
     * The check could not be made (the name did not resolve): not a finding about the URL. A
     * DNS outage must not read as a private address (keycloak/repair.ts disables an IdP only
     * for a definite refusal).
     */
    readonly transient = false,
  ) {
    super(message);
  }
}

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT, also AKS/kubenet pod ranges
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3], // multicast and reserved, through 255.255.255.255
] as const)
  blocked.addSubnet(net, bits, 'ipv4');
blocked.addAddress('168.63.129.16', 'ipv4'); // Azure wireserver
for (const [net, bits] of [
  ['::', 96], // unspecified, loopback and IPv4-compatible ::a.b.c.d
  ['64:ff9b::', 96], // NAT64 of v4
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64],
  ['2001::', 32], // Teredo (embeds a v4 address)
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4 (embeds a v4 address)
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, bits, 'ipv6');

/** True for an address that must never be dialed from inside the cluster. */
export function isPrivateAddress(addr: string): boolean {
  const v = isIP(addr);
  if (v === 4) return blocked.check(addr, 'ipv4');
  if (v === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
    if (mapped) return blocked.check(mapped[1]!, 'ipv4');
    return blocked.check(addr, 'ipv6');
  }
  return true; // not an address at all: refuse
}

const INTERNAL_NAMES = /(^|\.)(localhost|local|internal|localdomain|svc|cluster\.local|home\.arpa)$/i;

function hostAllowed(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((e) => {
    const p = e.trim().toLowerCase();
    if (!p) return false;
    return p.startsWith('*.') ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p;
  });
}

/** Checks scheme, credentials, allowlist and the host's name; returns the parsed URL. Addresses are checked at resolve time. */
export function checkUrl(raw: string, policy: EgressPolicy = {}): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new EgressError('not a valid URL');
  }
  if (u.protocol !== 'https:' && !(policy.allowHttp && u.protocol === 'http:')) throw new EgressError(policy.allowHttp ? 'must be an http(s) URL' : 'must be an https URL');
  if (u.username || u.password) throw new EgressError('must not contain credentials');
  // A trailing dot (an absolute name) resolves the same: `x.svc.cluster.local.` is cluster-internal.
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (policy.allowedHosts?.length && !hostAllowed(host, policy.allowedHosts)) throw new EgressError('host is not on the allowed list for identity providers');
  if (!policy.allowPrivate) {
    if (isIP(host) ? isPrivateAddress(host) : INTERNAL_NAMES.test(host) || !host.includes('.')) throw new EgressError('must be a public address');
  }
  return u;
}

/** A dns.lookup that refuses private addresses (all of them must be public). */
export function guardedLookup(policy: EgressPolicy, lookup: typeof dnsLookup = dnsLookup): LookupFunction {
  return ((hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
    lookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return cb(err, '', 0);
      const list = addrs as LookupAddress[];
      if (!policy.allowPrivate && (!list.length || list.some((a) => isPrivateAddress(a.address)))) {
        const e = new EgressError('must be a public address', `${hostname} resolves to ${list.map((a) => a.address).join(', ')}`) as EgressError & { code: string };
        e.code = 'EPRIVATE';
        return cb(e, '', 0);
      }
      if ((options as { all?: boolean }).all) return cb(null, list);
      cb(null, list[0]!.address, list[0]!.family);
    });
  }) as LookupFunction;
}

/** Resolves `u`'s host now and refuses private addresses (for a URL another service will fetch). */
export async function checkResolves(u: URL, policy: EgressPolicy = {}, lookup: typeof dnsLookup = dnsLookup): Promise<void> {
  if (policy.allowPrivate) return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return; // checkUrl already judged a literal
  await new Promise<void>((resolve, reject) =>
    guardedLookup(policy, lookup)(host, {}, (err) => (err ? reject(err instanceof EgressError ? err : new EgressError('could not resolve the host', (err as Error).message, true)) : resolve())),
  );
}

/**
 * Resolves `host` under the policy to the one address the request dials (an IP literal resolves
 * to itself). Every address the name has must pass (guardedLookup), so a mix of public and
 * private answers is refused too.
 */
export async function resolveTarget(host: string, policy: EgressPolicy = {}, lookup: typeof dnsLookup = dnsLookup): Promise<LookupAddress> {
  return new Promise<LookupAddress>((resolve, reject) =>
    guardedLookup(policy, lookup)(host, { all: true }, (err, addrs) => {
      const list = addrs as unknown as LookupAddress[];
      if (err || !list?.length) return reject(err instanceof EgressError ? err : new EgressError('could not be reached', err?.message ?? `${host} has no address`));
      resolve(list[0]!);
    }),
  );
}

/** GETs a document from an admin-supplied URL under the policy. Throws EgressError with a client-safe message. */
export async function fetchText(raw: string, policy: EgressPolicy = {}, opts: { timeoutMs?: number; maxBytes?: number; lookup?: typeof dnsLookup; accept?: string } = {}): Promise<string> {
  const u = checkUrl(raw, policy);
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 256 * 1024;
  const https = u.protocol === 'https:';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  // Resolve and check first, then dial exactly that address: nothing resolves the name again
  // between the check and the connection (DNS rebinding). TLS still verifies the certificate
  // against the name (servername), and the Host header carries it for virtual hosting.
  const target = await resolveTarget(host, policy, opts.lookup);
  const options: RequestOptions = {
    method: 'GET',
    host: target.address,
    family: target.family,
    port: u.port ? Number(u.port) : https ? 443 : 80,
    path: `${u.pathname}${u.search}`,
    headers: { host: u.host, accept: opts.accept ?? 'application/json' },
    timeout: timeoutMs,
    ...(https && !isIP(host) ? { servername: host } : {}),
  };
  return new Promise<string>((resolve, reject) => {
    const req = (https ? httpsRequest : httpRequest)(options, (res) => {
      if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
        res.resume();
        return reject(new EgressError('did not answer with a document', `HTTP ${res.statusCode}`));
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          return reject(new EgressError('answered with a document that is too large'));
        }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', (e) => reject(new EgressError('could not be read', e.message)));
    });
    req.on('timeout', () => req.destroy(new EgressError('did not answer in time')));
    req.on('error', (e) => reject(e instanceof EgressError ? e : new EgressError('could not be reached', e.message)));
    req.end();
  });
}

/** GETs JSON from an admin-supplied URL under the policy. Throws EgressError with a client-safe message. */
export async function fetchJson(raw: string, policy: EgressPolicy = {}, opts: { timeoutMs?: number; maxBytes?: number; lookup?: typeof dnsLookup } = {}): Promise<unknown> {
  const body = await fetchText(raw, policy, opts);
  try {
    return JSON.parse(body);
  } catch {
    throw new EgressError('did not answer with JSON');
  }
}
