import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Edition, Feature, LicenseInfo, LicenseNotice, LicenseState, LicenseStatus } from '@cloudtrain/api-types';
import { sql } from 'kysely';
import { withTenant, type Db } from '../db/index.js';
import { FEATURE_INFO, FEATURES, featuresOf } from '../entitlements/features.js';
import { HttpError, badRequest } from '../errors.js';
import { ACCEPTED_KEYS } from './keys.js';
import { evaluate, GRACE_DAYS, WARN_DAYS } from './state.js';
import { extractToken, generateSigningKeyPair, LICENSE_VERSION, LicenseError, signLicense, verifyLicense, type LicensePayload, type PublicKeyEntry } from './token.js';

/*
 * The license of this deployment (docs/licensing-keys.md). Read from, in order:
 *
 *   1. CT_DEV_LICENSE=1    a development license signed at startup with a key pair
 *                          that exists only in this process (never in production)
 *   2. CT_LICENSE_KEY      the token (or the whole file) in the environment
 *   3. CT_LICENSE_FILE     a file holding it (e.g. a mounted Secret)
 *   4. the database        uploaded by a platform admin on /platform/license
 *
 * The first one set wins; an upload is refused while the environment sets one.
 * Nothing is ever sent anywhere: verification, expiry and seats are local.
 * State is re-evaluated against the clock on every call, so a license expires
 * (and its grace period ends) without a restart; the database copy is re-read
 * every `refreshMs` so every gateway replica sees an upload.
 */

export interface LicenseSourceConfig {
  key?: string;
  file?: string;
  /** CT_DEV_LICENSE=1 (loadConfig refuses it in production or on a non-loopback URL). */
  dev?: boolean;
}

export interface LicenseManagerDeps {
  edition: Edition;
  source: LicenseSourceConfig;
  db?: Db;
  /** Accepted signing keys; defaults to the embedded ones (keys.ts). Tests pass their own. */
  keys?: readonly PublicKeyEntry[];
  now?: () => Date;
  refreshMs?: number;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

interface Loaded {
  source: LicenseStatus['source'];
  kid?: string;
  payload?: LicensePayload;
  error?: string;
  installedAt?: Date;
  installedBy?: string | null;
}

export const DEV_KID = 'dev-ephemeral';

export class LicenseManager {
  readonly edition: Edition;
  private readonly keys: PublicKeyEntry[];
  private readonly now: () => Date;
  private loaded: Loaded = { source: 'none' };
  private lastRefresh = 0;
  private readonly fixed: boolean;

  constructor(private readonly d: LicenseManagerDeps) {
    this.edition = d.edition;
    this.keys = [...(d.keys ?? ACCEPTED_KEYS)];
    this.now = d.now ?? (() => new Date());
    this.fixed = !!(d.source.dev || d.source.key || d.source.file);
  }

  /** Loads the license from the first source that sets one. Call once at startup. */
  async init(): Promise<this> {
    const s = this.d.source;
    if (s.dev) this.loaded = this.devLicense();
    else if (s.key) this.loaded = this.parse(s.key, 'env');
    else if (s.file) {
      let text: string;
      try {
        text = readFileSync(s.file, 'utf8');
      } catch (e) {
        this.loaded = { source: 'file', error: `Cannot read CT_LICENSE_FILE ${s.file}: ${(e as Error).message}` };
        return this;
      }
      this.loaded = this.parse(text, 'file');
    } else await this.refresh(true);
    this.logState();
    return this;
  }

  private devLicense(): Loaded {
    if (process.env.NODE_ENV === 'production') throw new Error('CT_DEV_LICENSE is for local development only and refuses to run with NODE_ENV=production');
    // A key pair that exists only in this process: the dev license cannot be copied to another gateway.
    const pair = generateSigningKeyPair();
    this.keys.push({ kid: DEV_KID, publicKey: pair.publicKey, label: 'Development key (this process only)' });
    const now = this.now();
    const payload: LicensePayload = {
      v: LICENSE_VERSION,
      licenseId: `dev_${randomBytes(4).toString('hex')}`,
      licensee: { name: 'Local development (CT_DEV_LICENSE)' },
      edition: 'development',
      features: [...FEATURES],
      seats: 0,
      issuedAt: now.toISOString(),
      notBefore: now.toISOString(),
      expiresAt: new Date(now.getTime() + 365 * 86_400_000).toISOString(),
    };
    return this.parse(signLicense(payload, pair.privateKey, DEV_KID), 'dev');
  }

  private parse(text: string, source: Loaded['source'], extra: Partial<Loaded> = {}): Loaded {
    try {
      const { kid, payload } = verifyLicense(text, this.keys);
      return { source, kid, payload, ...extra };
    } catch (e) {
      return { source, error: e instanceof LicenseError ? e.message : `Unreadable license: ${(e as Error).message}`, ...extra };
    }
  }

  /** Re-reads the uploaded license (no-op when the environment sets one). */
  async refresh(force = false): Promise<void> {
    if (this.fixed || !this.d.db) return;
    const t = Date.now();
    if (!force && t - this.lastRefresh < (this.d.refreshMs ?? 300_000)) return;
    this.lastRefresh = t;
    try {
      const row = await withTenant(this.d.db, { platform: true }, (tx) => tx.selectFrom('platform_licenses').selectAll().where('removed_at', 'is', null).executeTakeFirst());
      this.loaded = row ? this.parse(row.token, 'upload', { installedAt: row.installed_at, installedBy: row.installed_by }) : { source: 'none' };
    } catch (e) {
      // Keep the last known license; a database hiccup must not switch features off.
      this.d.log?.warn({ err: (e as Error).message }, 'license: could not re-read the uploaded license');
    }
  }

  private logState(): void {
    const st = this.state();
    const l = this.loaded;
    if (st === 'none') this.d.log?.info({ edition: this.edition }, 'license: none installed (community edition)');
    else if (st === 'invalid') this.d.log?.warn({ source: l.source, error: l.error }, 'license: invalid, premium features off');
    else this.d.log?.info({ source: l.source, state: st, licenseId: l.payload?.licenseId, licensee: l.payload?.licensee.name, expiresAt: l.payload?.expiresAt, features: this.features() }, 'license loaded');
  }

  /** Development licenses apply to both editions; others only to self-hosted. */
  private get applies(): boolean {
    return this.loaded.source === 'dev' || this.edition === 'selfhosted';
  }

  state(): LicenseState {
    const l = this.loaded;
    if (l.source === 'none') return 'none';
    if (!l.payload) return 'invalid';
    if (!this.applies) return 'ignored';
    return evaluate(l.payload, this.now()).state;
  }

  /** Premium features the license grants right now (empty unless valid, expiring or in grace). */
  features(): Feature[] {
    const l = this.loaded;
    if (!l.payload || !this.applies) return [];
    return evaluate(l.payload, this.now()).active ? featuresOf(l.payload.features) : [];
  }

  get isDev(): boolean {
    return this.loaded.source === 'dev';
  }

  /** Licensed seats (0 = unlimited) while the license is in force. */
  seats(): number {
    return this.active() ? (this.loaded.payload?.seats ?? 0) : 0;
  }

  active(): boolean {
    const l = this.loaded;
    return !!l.payload && this.applies && evaluate(l.payload, this.now()).active;
  }

  /** Why a feature the license does not grant is off. */
  offReason(): 'no_license' | 'license_expired' | 'license_invalid' {
    const st = this.state();
    if (st === 'expired' || st === 'not_yet_valid') return 'license_expired';
    if (st === 'invalid') return 'license_invalid';
    return 'no_license';
  }

  info(): LicenseInfo | undefined {
    const p = this.loaded.payload;
    if (!p) return undefined;
    return { licenseId: p.licenseId, licensee: p.licensee, edition: p.edition, features: p.features, seats: p.seats, issuedAt: p.issuedAt, notBefore: p.notBefore, expiresAt: p.expiresAt, kid: this.loaded.kid ?? '' };
  }

  /** A banner-worthy notice for admins, or undefined when nothing needs attention. */
  notice(seatsUsed?: number): LicenseNotice | undefined {
    const st = this.state();
    const p = this.loaded.payload;
    if (st === 'none' || st === 'ignored' || this.isDev) return undefined;
    if (st === 'invalid') return { state: st, message: `The installed license is invalid (${this.loaded.error ?? 'unreadable'}): premium features are off. Install a valid license on /platform/license.` };
    const ev = evaluate(p!, this.now());
    const seatsOver = seatsUsed !== undefined && p!.seats > 0 && ev.active && seatsUsed > p!.seats;
    const base = { state: st, daysLeft: ev.daysLeft, expiresAt: p!.expiresAt, graceEndsAt: ev.graceEndsAt, ...(seatsOver ? { seatsOver } : {}) };
    const day = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
    if (st === 'expiring') return { ...base, message: `The CloudTrain license expires in ${day(Math.max(0, ev.daysLeft))} (${p!.expiresAt.slice(0, 10)}). Renew it to keep the premium features.` };
    if (st === 'grace') return { ...base, message: `The CloudTrain license expired on ${p!.expiresAt.slice(0, 10)}. Premium features stay on until ${ev.graceEndsAt.slice(0, 10)}; install a renewed license before then.` };
    if (st === 'expired') return { ...base, message: `The CloudTrain license expired on ${p!.expiresAt.slice(0, 10)} and its grace period has ended: premium features are off. Nothing was deleted; installing a renewed license turns them back on.` };
    if (st === 'not_yet_valid') return { ...base, message: `The installed license is valid from ${p!.notBefore.slice(0, 10)}; premium features are off until then.` };
    if (seatsOver) return { ...base, message: `${seatsUsed} active members exceed the ${p!.seats} seats of the license. New invitations are paused until members are deactivated or the license is extended.` };
    return undefined;
  }

  status(seatsUsed: number): LicenseStatus {
    const st = this.state();
    const l = this.loaded;
    const ev = l.payload ? evaluate(l.payload, this.now()) : undefined;
    const licensed = this.active() ? (l.payload?.seats ?? 0) : 0;
    const message =
      this.notice(seatsUsed)?.message ??
      (st === 'none'
        ? this.edition === 'hosted'
          ? 'Hosted edition: premium features come from each organisation plan.'
          : 'Community edition: every lab, no premium features. Install a license key to unlock them.'
        : st === 'ignored'
          ? 'Hosted edition: premium features come from each organisation plan; the installed license is not used.'
          : this.isDev
            ? 'Development license (CT_DEV_LICENSE): every premium feature, for local development only.'
            : `Licensed to ${l.payload!.licensee.name} until ${l.payload!.expiresAt.slice(0, 10)}.`);
    return {
      edition: this.edition,
      state: st,
      source: l.source,
      ...(l.payload ? { license: this.info()! } : {}),
      ...(l.error ? { error: l.error } : {}),
      ...(ev ? { daysLeft: ev.daysLeft, graceEndsAt: ev.graceEndsAt } : {}),
      warnDays: WARN_DAYS,
      graceDays: GRACE_DAYS,
      activeFeatures: this.features(),
      seats: { licensed, used: seatsUsed, over: licensed > 0 && seatsUsed > licensed },
      keys: this.keys.map((k) => ({ kid: k.kid, ...(k.label ? { label: k.label } : {}), ...(k.retiredAt ? { retiredAt: k.retiredAt } : {}) })),
      uploadAllowed: !this.fixed && !!this.d.db,
      ...(l.installedAt ? { installedAt: l.installedAt.toISOString() } : {}),
      ...(l.installedBy ? { installedBy: l.installedBy } : {}),
      catalog: FEATURES.map((f) => FEATURE_INFO[f]),
      message,
    };
  }

  /** Installs an uploaded license (platform admin). Refuses invalid, expired or wrong-edition keys. */
  async install(text: string, actor: { id: string; name: string }): Promise<void> {
    if (this.fixed) throw new HttpError(409, 'The license is set by the environment (CT_LICENSE_KEY, CT_LICENSE_FILE or CT_DEV_LICENSE); change it there.', { code: 'conflict' });
    if (!this.d.db) throw new HttpError(409, 'Uploading a license needs the platform database.', { code: 'conflict' });
    if (typeof text !== 'string' || !text.trim()) throw badRequest('license is required', { license: 'required' });
    if (text.length > 16384) throw badRequest('That is too long to be a license key', { license: 'too long' });
    let parsed;
    try {
      parsed = verifyLicense(text, this.keys);
    } catch (e) {
      throw badRequest(e instanceof LicenseError ? e.message : 'Unreadable license', { license: e instanceof LicenseError ? e.reason : 'malformed' });
    }
    if (parsed.kid === DEV_KID) throw badRequest('A development license cannot be installed', { license: 'dev' });
    const ev = evaluate(parsed.payload, this.now());
    if (ev.state === 'expired') throw badRequest(`This license expired on ${parsed.payload.expiresAt.slice(0, 10)} and its grace period has ended`, { license: 'expired' });
    const token = extractToken(text);
    const db = this.d.db;
    await withTenant(db, { platform: true, userId: actor.id }, async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('platform_license'))`.execute(tx);
      await tx.updateTable('platform_licenses').set({ removed_at: this.now(), removed_by: actor.id }).where('removed_at', 'is', null).execute();
      await tx.insertInto('platform_licenses').values({ license_id: parsed.payload.licenseId, token, installed_by: actor.name }).execute();
    });
    await this.refresh(true);
    this.logState();
  }

  /** Removes the uploaded license: back to the community edition (data kept). */
  async remove(actor: { id: string }): Promise<boolean> {
    if (this.fixed) throw new HttpError(409, 'The license is set by the environment; remove it there.', { code: 'conflict' });
    if (!this.d.db) return false;
    const n = await withTenant(this.d.db, { platform: true, userId: actor.id }, (tx) => tx.updateTable('platform_licenses').set({ removed_at: this.now(), removed_by: actor.id }).where('removed_at', 'is', null).executeTakeFirst());
    await this.refresh(true);
    return Number(n.numUpdatedRows) > 0;
  }
}
