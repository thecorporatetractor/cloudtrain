import type {} from '@fastify/cookie';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Principal, Authenticator } from '../auth.js';
import type { Db } from '../db/index.js';
import type { AuthSessionRow } from '../db/schema.js';
import { loadPrincipal } from '../platform/identity.js';
import { OidcError, randomToken, type OidcClient, type TokenSet } from './client.js';

/*
 * Server-side sessions (Postgres auth_sessions) behind an opaque cookie. The
 * table stores sha256(cookie value), never the value; the refresh token is
 * sealed with AES-256-GCM under CT_SESSION_SECRET.
 */

export const SESSION_COOKIE = 'ct_session';
export const CSRF_HEADER = 'x-csrf-token';

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export class Sealer {
  private readonly key: Buffer;
  constructor(secret: string) {
    if (secret.length < 16) throw new Error('CT_SESSION_SECRET must be at least 16 characters');
    this.key = createHash('sha256').update(secret).digest();
  }
  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
  }
  open(sealed: string): string | null {
    try {
      const [iv, tag, body] = sealed.split('.').map((s) => Buffer.from(s, 'base64url'));
      const d = createDecipheriv('aes-256-gcm', this.key, iv!);
      d.setAuthTag(tag!);
      return Buffer.concat([d.update(body!), d.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}

export interface SessionStoreOptions {
  /** Absolute lifetime of a gateway session. */
  maxAgeSeconds: number;
  /** Idle timeout (no request). */
  idleSeconds: number;
  secureCookie: boolean;
  now?: () => number;
}

export interface NewSession {
  userId: string;
  orgId: string | null;
  tokens: TokenSet;
  kcSid?: string;
  idp?: string;
  ip?: string;
  userAgent?: string;
}

export class SessionStore {
  private readonly now: () => number;
  constructor(
    private readonly db: Db,
    private readonly sealer: Sealer,
    readonly opts: SessionStoreOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  async create(s: NewSession): Promise<{ token: string; csrf: string }> {
    const token = randomToken(32);
    const csrf = randomToken(24);
    const now = this.now();
    await this.db
      .insertInto('auth_sessions')
      .values({
        id_hash: hashToken(token),
        user_id: s.userId,
        org_id: s.orgId,
        csrf,
        kc_sid: s.kcSid ?? null,
        idp: s.idp ?? null,
        id_token: s.tokens.id_token ?? null,
        refresh_token: s.tokens.refresh_token ? this.sealer.seal(s.tokens.refresh_token) : null,
        access_expires_at: new Date(now + (s.tokens.expires_in ?? 300) * 1000),
        expires_at: new Date(now + this.opts.maxAgeSeconds * 1000),
        ip: s.ip ?? null,
        user_agent: s.userAgent?.slice(0, 300) ?? null,
      })
      .execute();
    return { token, csrf };
  }

  async get(token: string): Promise<AuthSessionRow | null> {
    const row = await this.db.selectFrom('auth_sessions').selectAll().where('id_hash', '=', hashToken(token)).executeTakeFirst();
    if (!row) return null;
    const now = this.now();
    if (row.expires_at.getTime() < now || row.last_seen_at.getTime() + this.opts.idleSeconds * 1000 < now) {
      await this.revoke(row.id_hash);
      return null;
    }
    return row;
  }

  async touch(idHash: string): Promise<void> {
    await this.db.updateTable('auth_sessions').set({ last_seen_at: new Date(this.now()) }).where('id_hash', '=', idHash).execute();
  }

  async setOrg(idHash: string, orgId: string | null): Promise<void> {
    await this.db.updateTable('auth_sessions').set({ org_id: orgId }).where('id_hash', '=', idHash).execute();
  }

  async storeRefresh(idHash: string, t: TokenSet): Promise<void> {
    await this.db
      .updateTable('auth_sessions')
      .set({
        access_expires_at: new Date(this.now() + (t.expires_in ?? 300) * 1000),
        ...(t.refresh_token ? { refresh_token: this.sealer.seal(t.refresh_token) } : {}),
        ...(t.id_token ? { id_token: t.id_token } : {}),
      })
      .where('id_hash', '=', idHash)
      .execute();
  }

  refreshTokenOf(row: AuthSessionRow): string | null {
    return row.refresh_token ? this.sealer.open(row.refresh_token) : null;
  }

  async revoke(idHash: string): Promise<void> {
    await this.db.deleteFrom('auth_sessions').where('id_hash', '=', idHash).execute();
  }

  /** Every session of a user (optionally only those working in one org). Returns how many were revoked. */
  async revokeUser(userId: string, orgId?: string): Promise<number> {
    let q = this.db.deleteFrom('auth_sessions').where('user_id', '=', userId);
    if (orgId) q = q.where('org_id', '=', orgId);
    const r = await q.executeTakeFirst();
    return Number(r.numDeletedRows);
  }

  async revokeOrg(orgId: string): Promise<number> {
    const r = await this.db.deleteFrom('auth_sessions').where('org_id', '=', orgId).executeTakeFirst();
    return Number(r.numDeletedRows);
  }

  /** Back-channel logout: by Keycloak session id, else every session of the subject. */
  async revokeKeycloak(t: { sub?: string; sid?: string }): Promise<number> {
    let q = this.db.deleteFrom('auth_sessions');
    q = t.sid ? q.where('kc_sid', '=', t.sid) : q.where('user_id', '=', t.sub!);
    const r = await q.executeTakeFirst();
    return Number(r.numDeletedRows);
  }

  setCookie(reply: FastifyReply, token: string) {
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, secure: this.opts.secureCookie, sameSite: 'lax', maxAge: this.opts.maxAgeSeconds });
  }

  clearCookie(reply: FastifyReply) {
    reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: this.opts.secureCookie, sameSite: 'lax' });
  }
}

export function csrfMatches(expected: string, got: unknown): boolean {
  if (typeof got !== 'string' || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}

/**
 * Cookie session -> Principal. Access-token expiry triggers a server-side
 * refresh against Keycloak; a refused refresh (user disabled, session ended
 * at the IdP) ends the gateway session too. The principal is rebuilt from the
 * database on every request, so role changes and deactivation apply at once.
 */
export class OidcAuthenticator implements Authenticator {
  readonly csrf = true;
  constructor(
    private readonly db: Db,
    private readonly store: SessionStore,
    private readonly oidc: OidcClient,
    private readonly log?: { warn(o: object, m: string): void },
  ) {}

  async authenticate(req: FastifyRequest): Promise<Principal | null> {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return null;
    const row = await this.store.get(token);
    if (!row) return null;
    if (row.access_expires_at && row.access_expires_at.getTime() < Date.now()) {
      const rt = this.store.refreshTokenOf(row);
      if (!rt) {
        await this.store.revoke(row.id_hash);
        return null;
      }
      try {
        await this.store.storeRefresh(row.id_hash, await this.oidc.refresh(rt));
      } catch (e) {
        if (e instanceof OidcError && e.status && e.status >= 400 && e.status < 500) {
          await this.store.revoke(row.id_hash);
          return null;
        }
        this.log?.warn({ err: e }, 'token refresh failed; keeping the session for now');
      }
    }
    const p = await loadPrincipal(this.db, row.user_id, row.org_id);
    if (!p) {
      await this.store.revoke(row.id_hash);
      return null;
    }
    void this.store.touch(row.id_hash).catch(() => undefined);
    return { ...p, session: { idHash: row.id_hash, csrf: row.csrf, ...(row.idp ? { idp: row.idp } : {}), expiresAt: row.expires_at.toISOString(), method: 'oidc' } };
  }
}
