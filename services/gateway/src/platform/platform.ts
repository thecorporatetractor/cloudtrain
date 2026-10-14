import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { Capacity, CreatePlatformOrgRequest, PlatformOrg, UpdatePlatformOrgRequest } from '@cloudtrain/api-types';
import type { Principal } from '../auth.js';
import { authorize } from '../authz.js';
import type { Tx } from '../db/index.js';
import { badRequest, conflict, notFound } from '../errors.js';
import type { ClusterInfo } from '../kube/capacity.js';
import { phaseOf } from '../sessions/map.js';
import { checkQuotas, inviteUser, writeQuotas } from './admin.js';
import { audit } from './audit.js';
import { DEFAULT_QUOTAS, DEFAULT_SETTINGS, type PlatformService } from './service.js';

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const DAY = 86_400_000;

/** Platform actions are audited in the affected org's log. */
const platformActor = (p: Principal, orgId: string, ip?: string) => ({ orgId, actorId: p.sub, actorName: `${p.name} (platform)`, ip });

async function orgsWithStats(ps: PlatformService, tx: Tx, ids?: string[]): Promise<PlatformOrg[]> {
  let q = tx.selectFrom('orgs').selectAll().orderBy('name');
  if (ids) q = q.where('id', 'in', ids);
  const orgs = await q.execute();
  if (!orgs.length) return [];
  const live = await ps.cluster.listSessions('app.kubernetes.io/managed-by=cloudtrain-gateway').catch(() => []);
  const now = ps.now();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const out: PlatformOrg[] = [];
  for (const o of orgs) {
    const users = await tx.selectFrom('memberships').select((eb) => eb.fn.countAll<number>().as('n')).where('org_id', '=', o.id).where('status', '<>', 'deactivated').executeTakeFirstOrThrow();
    const active = await tx
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('id', 'in', tx.selectFrom('memberships').select('user_id').where('org_id', '=', o.id))
      .where('last_login_at', '>', new Date(now.getTime() - 30 * DAY))
      .executeTakeFirstOrThrow();
    const secs = await tx
      .selectFrom('lab_attempts')
      .select(sql<number>`coalesce(sum(duration_s), 0)`.as('s'))
      .where('org_id', '=', o.id)
      .where('started_at', '>=', monthStart)
      .executeTakeFirstOrThrow();
    const q = await tx.selectFrom('quotas').selectAll().where('org_id', '=', o.id).executeTakeFirst();
    const domains = await tx.selectFrom('org_domains').select('domain').where('org_id', '=', o.id).orderBy('domain').execute();
    const sso = await tx.selectFrom('sso_connections').select((eb) => eb.fn.countAll<number>().as('n')).where('org_id', '=', o.id).executeTakeFirstOrThrow();
    out.push({
      id: o.id,
      slug: o.slug,
      name: o.name,
      ...(o.settings.logoUrl ? { logoUrl: o.settings.logoUrl } : {}),
      status: o.status,
      createdAt: o.created_at.toISOString(),
      quotas: q ? { maxConcurrentSessions: q.max_concurrent_sessions, monthlyLabHours: q.monthly_lab_hours, maxSessionMinutes: q.max_session_minutes } : { ...DEFAULT_QUOTAS },
      domains: domains.map((d) => d.domain),
      users: Number(users.n),
      activeUsers30d: Number(active.n),
      runningSessions: live.filter((s) => s.spec.learner.org === o.id && !['expired', 'failed'].includes(phaseOf(s))).length,
      labHoursThisMonth: Math.round((Number(secs.s) / 3600) * 10) / 10,
      ssoConnections: Number(sso.n),
    });
  }
  return out;
}

export async function listOrgs(ps: PlatformService, p: Principal): Promise<PlatformOrg[]> {
  return ps.ptx(p, (tx) => orgsWithStats(ps, tx));
}

export async function getOrg(ps: PlatformService, p: Principal, id: string): Promise<PlatformOrg> {
  const [o] = await ps.ptx(p, (tx) => orgsWithStats(ps, tx, [id]));
  if (!o) throw notFound('Organization');
  return o;
}

/** Ensures the org exists as a Keycloak organization (alias = slug) with its verified domains. */
export async function syncKeycloakOrg(ps: PlatformService, org: { id: string; slug: string; name: string; kc_org_id: string | null }, verifiedDomains: string[]): Promise<string | null> {
  if (!ps.kc) return null;
  const existing = (org.kc_org_id ? await ps.kc.request<{ id: string; name: string; alias: string; enabled: boolean; domains?: { name: string; verified: boolean }[] }>('GET', `/organizations/${org.kc_org_id}`).then((r) => r.data).catch(() => null) : null) ?? (await ps.kc.findOrganization(org.slug));
  const domains = verifiedDomains.map((name) => ({ name, verified: true }));
  if (existing) {
    const have = new Set((existing.domains ?? []).map((d) => d.name));
    if (existing.name !== org.name || domains.some((d) => !have.has(d.name))) await ps.kc.updateOrganization({ ...existing, name: org.name, domains: [...(existing.domains ?? []).filter((d) => !verifiedDomains.includes(d.name)), ...domains] });
    return existing.id;
  }
  return (await ps.kc.createOrganization({ name: org.name, alias: org.slug, domains, description: 'Managed by CloudTrain' })).id;
}

export async function createOrg(ps: PlatformService, p: Principal, req: CreatePlatformOrgRequest, ip?: string): Promise<PlatformOrg> {
  authorize(p, 'org.manage', { kind: 'platform' });
  const slug = req?.slug?.trim().toLowerCase() ?? '';
  if (!SLUG.test(slug)) throw badRequest('slug must be 2-63 lowercase letters, digits or dashes', { slug: 'invalid' });
  if (!req.name?.trim()) throw badRequest('name is required', { name: 'required' });
  const domains = (req.domains ?? []).map((d) => d.trim().toLowerCase());
  for (const d of domains) if (!DOMAIN.test(d)) throw badRequest(`Invalid domain ${d}`, { domains: 'invalid' });
  const quotas = checkQuotas(req.quotas);
  const org = await ps.ptx(p, async (tx) => {
    if (await tx.selectFrom('orgs').select('id').where('slug', '=', slug).executeTakeFirst()) throw conflict(`An organization ${slug} already exists.`);
    for (const d of domains) if (await tx.selectFrom('org_domains').select('domain').where('domain', '=', d).executeTakeFirst()) throw conflict(`${d} is already claimed.`);
    const o = await tx
      .insertInto('orgs')
      .values({ slug, name: req.name.trim(), settings: JSON.stringify({ ...DEFAULT_SETTINGS }) })
      .returningAll()
      .executeTakeFirstOrThrow();
    // Domains named by the platform operator are trusted (verified on creation).
    for (const d of domains) await tx.insertInto('org_domains').values({ org_id: o.id, domain: d, verification_token: randomBytes(16).toString('hex'), verified_at: new Date() }).execute();
    await writeQuotas(tx, o.id, { ...DEFAULT_QUOTAS }, quotas);
    await audit(tx, platformActor(p, o.id, ip), 'platform.org_create', 'org', o.id, { slug, domains, quotas }, o.name);
    return o;
  });
  const kcId = await syncKeycloakOrg(ps, org, domains).catch((e: unknown) => {
    ps.log?.warn({ err: e }, 'keycloak organization create failed');
    return null;
  });
  if (kcId) await ps.ptx(p, (tx) => tx.updateTable('orgs').set({ kc_org_id: kcId }).where('id', '=', org.id).execute());
  if (req.adminEmail) {
    // Invite the first org admin as the platform admin acting inside the new org.
    await inviteUser(ps, { ...p, orgId: org.id, orgName: org.name, orgSlug: org.slug }, { email: req.adminEmail, roles: ['learner', 'org_admin'] }, ip);
  }
  return getOrg(ps, p, org.id);
}

export async function updateOrg(ps: PlatformService, p: Principal, id: string, req: UpdatePlatformOrgRequest, ip?: string): Promise<PlatformOrg> {
  authorize(p, 'org.manage', { kind: 'platform' });
  const quotas = checkQuotas(req?.quotas);
  if (req?.status && !['active', 'suspended'].includes(req.status)) throw badRequest('status must be active or suspended', { status: 'invalid' });
  const before = await ps.ptx(p, async (tx) => {
    const o = await tx.selectFrom('orgs').selectAll().where('id', '=', id).executeTakeFirst();
    if (!o) throw notFound('Organization');
    if (req.name?.trim() || req.status) await tx.updateTable('orgs').set({ ...(req.name?.trim() ? { name: req.name.trim() } : {}), ...(req.status ? { status: req.status } : {}) }).where('id', '=', id).execute();
    if (Object.keys(quotas).length) {
      const q = await tx.selectFrom('quotas').selectAll().where('org_id', '=', id).executeTakeFirst();
      await writeQuotas(tx, id, q ? { maxConcurrentSessions: q.max_concurrent_sessions, monthlyLabHours: q.monthly_lab_hours, maxSessionMinutes: q.max_session_minutes } : { ...DEFAULT_QUOTAS }, quotas);
    }
    const action = req.status === 'suspended' && o.status !== 'suspended' ? 'platform.org_suspend' : req.status === 'active' && o.status === 'suspended' ? 'platform.org_reactivate' : 'platform.org_update';
    await audit(tx, platformActor(p, id, ip), action, 'org', id, { ...(req.name ? { name: req.name } : {}), ...(req.status ? { status: req.status } : {}), ...(Object.keys(quotas).length ? { quotas } : {}) }, o.name);
    return o;
  });
  if (req.status === 'suspended' && before.status !== 'suspended' && ps.store) await ps.store.revokeOrg(id);
  return getOrg(ps, p, id);
}

export const suspendOrg = (ps: PlatformService, p: Principal, id: string, ip?: string) => updateOrg(ps, p, id, { status: 'suspended' }, ip);
export const reactivateOrg = (ps: PlatformService, p: Principal, id: string, ip?: string) => updateOrg(ps, p, id, { status: 'active' }, ip);

export async function deleteOrg(ps: PlatformService, p: Principal, id: string): Promise<void> {
  authorize(p, 'org.manage', { kind: 'platform' });
  const o = await ps.ptx(p, async (tx) => {
    const o = await tx.selectFrom('orgs').selectAll().where('id', '=', id).executeTakeFirst();
    if (!o) throw notFound('Organization');
    if (o.status !== 'suspended') throw conflict('Suspend the organization before deleting it.');
    return o;
  });
  const aliases = await ps.ptx(p, (tx) => tx.selectFrom('sso_connections').select('kc_alias').where('org_id', '=', id).execute());
  if (ps.kc) {
    for (const a of aliases) await ps.kc.deleteIdp(a.kc_alias).catch(() => undefined);
    if (o.kc_org_id) await ps.kc.deleteOrganization(o.kc_org_id).catch(() => undefined);
  }
  if (ps.store) await ps.store.revokeOrg(id);
  // The org's own audit log goes with it (cascade); the deletion is logged by the gateway.
  ps.log?.info({ org: o.slug, by: p.sub }, 'platform.org_delete');
  await ps.ptx(p, (tx) => tx.deleteFrom('orgs').where('id', '=', id).execute());
}

export async function capacity(ps: PlatformService, p: Principal, info: ClusterInfo | null): Promise<Capacity> {
  authorize(p, 'capacity.read', { kind: 'platform' });
  const base: Capacity = { generatedAt: ps.now().toISOString(), cluster: { context: ps.config.kubeContext, reachable: false }, nodes: [], vms: { running: 0, total: 0 }, warmPools: [], sessions: { total: 0, byPhase: {}, byOrg: [] } };
  if (!info) return { ...base, cluster: { ...base.cluster, error: 'no cluster access configured' } };
  try {
    const [nodes, vms, warmPools, sessions] = await Promise.all([info.nodes(), info.vms(), info.warmPools(), info.allSessions()]);
    const byPhase: Record<string, number> = {};
    const byOrgId = new Map<string, number>();
    for (const s of sessions) {
      const ph = phaseOf(s);
      byPhase[ph] = (byPhase[ph] ?? 0) + 1;
      if (s.spec.learner.org) byOrgId.set(s.spec.learner.org, (byOrgId.get(s.spec.learner.org) ?? 0) + 1);
    }
    const names = await ps.ptx(p, (tx) => tx.selectFrom('orgs').select(['id', 'name']).execute());
    return {
      ...base,
      cluster: { context: ps.config.kubeContext, reachable: true },
      nodes,
      vms: { running: vms.running, total: vms.total },
      warmPools,
      sessions: { total: sessions.length, byPhase, byOrg: [...byOrgId].map(([orgId, count]) => ({ orgId, name: names.find((n) => n.id === orgId)?.name ?? orgId, count })) },
    };
  } catch (e) {
    return { ...base, cluster: { ...base.cluster, error: (e as Error).message } };
  }
}
