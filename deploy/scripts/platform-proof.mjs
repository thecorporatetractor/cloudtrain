#!/usr/bin/env node
// End-to-end proof of the platform backend against the local stack:
//   task dev:deps && task dev:gateway   (gateway on :8787)
//   node deploy/scripts/platform-proof.mjs [--log deploy/.results/platform-proof.log]
// Logs in through Keycloak (local accounts and the brokered acme-idp realm),
// prints /api/me per role and exercises manager, instructor, admin and platform
// endpoints, cross-org isolation, CSRF, deactivation, invitations (Mailpit),
// quotas and the audit log. DEV ONLY (fictional people, dev passwords).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { login } from './platform-login.mjs';

const GW = process.env.CT_PUBLIC_URL ?? 'http://localhost:8787';
const MAILPIT = process.env.CT_MAILPIT_URL ?? 'http://localhost:8025';
const PASSWORD = 'CloudTrain-dev-only-1';
const logArg = process.argv.indexOf('--log');
const logFile = logArg > 0 ? process.argv[logArg + 1] : null;

const lines = [];
const out = (s = '') => {
  lines.push(s);
  console.log(s);
};
let failures = 0;
const check = (ok, what) => {
  if (!ok) failures++;
  out(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
};
const j = (v) => JSON.stringify(v);

out(`# CloudTrain platform proof  ${new Date().toISOString()}`);
out(`gateway ${GW}, keycloak http://localhost:8180, mailpit ${MAILPIT}`);

/* ------------------------------------------------------------------ logins */
const people = {
  priya: 'priya.raman@quillmoor.example',
  tomasz: 'tomasz.wierzbicki@quillmoor.example',
  elena: 'elena.duarte@quillmoor.example',
  kenji: 'kenji.morita@quillmoor.example',
  amara: 'amara.nwosu@quillmoor.example',
  mei: 'mei.tanaka@quillmoor.example',
  rhea: 'rhea.castellanos@cloudtrain-ops.example',
  olivia: 'olivia.hart@acme-freight.example',
  marcus: 'marcus.bell@acme-freight.example',
  nadia: 'nadia.okafor@acme-freight.example',
  felix: 'felix.moreau@acme-freight.example',
  hannah: 'hannah.vogel@acme-freight.example',
  sam: 'sam.kowalczyk@acme-freight.example',
  ari: 'ari.lindgren@acme-freight.example',
};
const s = {};
out('\n## 1. Logins (identity-first: email -> verified domain -> local Keycloak login or kc_idp_hint=acme-idp)');
for (const [k, email] of Object.entries(people)) {
  try {
    s[k] = await login(GW, email, PASSWORD);
    const hops = s[k].trace.filter((t) => /acme-idp|cloudtrain\/(protocol|login-actions|broker)|callback/.test(t)).length;
    check(true, `${email} -> org=${s[k].me.activeOrg?.name ?? '(none)'} idp=${s[k].me.auth.idp} (${hops} auth hops)`);
  } catch (e) {
    check(false, `${email}: ${e.message}`);
  }
}
out('\nBrokered login trace (marcus.bell via acme-idp):');
for (const t of s.marcus?.trace ?? []) out(`    ${t}`);

out('\n## 2. /api/me per role (roles from Keycloak local membership or acme-idp app-role claims)');
for (const [k, sess] of Object.entries(s)) {
  const me = sess.me;
  out(`- ${me.email}: roles=${j(me.roles)} legacyRole=${me.role} managedTeams=${j(me.managedTeams.map((t) => t.name))} instructedCohorts=${j(me.instructedCohorts.map((c) => c.name))}`);
  out(`    permissions=${j(me.permissions)}`);
}
check(s.olivia?.me.roles.includes('org_admin'), 'acme CloudTrain.OrgAdmin -> org_admin');
check(s.marcus?.me.roles.includes('manager') && s.marcus.me.managedTeams.some((t) => t.name === 'Linehaul Operations'), 'acme CloudTrain.Manager + group acme-linehaul-leads -> manager of Linehaul Operations');
check(s.nadia?.me.roles.includes('instructor'), 'acme CloudTrain.Instructor -> instructor');
check(s.felix?.me.roles.includes('author') && s.felix.me.teams.some((t) => t.name === 'Terminal IT'), 'acme CloudTrain.Author + group acme-terminal-it -> author, Terminal IT member');
check(s.ari?.me.platformAdmin && s.ari.me.activeOrg === null, 'acme CloudTrain.PlatformAdmin (trusted stand-in IdP) -> platform_admin, no org membership');
check(s.rhea?.me.platformAdmin, 'local platform operator -> platform_admin');
check(s.hannah?.me.streakDays >= 0 && s.hannah.me.user.id.length === 36, `seeded acme identity claimed on first login (id ${s.hannah?.me.user.id})`);
check(s.sam?.me.roles.join() === 'learner' && s.sam.me.teams.some((t) => t.name === 'Linehaul Operations'), 'JIT-provisioned new acme user (learner, team from group mapping)');
check(s.amara?.me.permissions.join() === 'lab.run,progress.read.self', 'learner holds exactly lab.run + progress.read.self');

/* ------------------------------------------------------------ learner data */
out('\n## 3. Learner: home, assignments, attempt history (persisted learner model)');
const home = await s.amara.api('GET', '/api/home');
out(`- amara home: source=${home.json.source} recommendations=${j(home.json.recommendations.map((r) => `${r.labId} p=${r.predictedSuccess}`))} assignmentsDue=${home.json.assignmentsDue.length} readiness(${home.json.goal.frameworkId})=${home.json.goal.readiness}`);
const mine = await s.amara.api('GET', '/api/assignments/mine');
out(`- amara assignments: ${j(mine.json.map((a) => `${a.item.kind}:${a.item.id} via ${a.via.kind}:${a.via.name} ${a.status} ${Math.round(a.progress * 100)}%`))}`);
const attempts = await s.amara.api('GET', '/api/attempts/mine?limit=3');
out(`- amara attempts (latest 3): ${j(attempts.json.items.map((a) => `${a.labId} ${a.outcome} ${a.score}% ${a.checksPassed}/${a.checksTotal}`))}`);
check(home.status === 200 && home.json.source === 'live' && attempts.json.items.length === 3, 'home and history come from the database');

/* ----------------------------------------------------------------- manager */
out('\n## 4. Manager (tomasz, Yard Platform)');
const teams = await s.tomasz.api('GET', '/api/teams');
const yard = teams.json.find((t) => t.name === 'Yard Platform');
out(`- GET /api/teams -> ${teams.status} ${j(teams.json.map((t) => t.name))}`);
const dash = await s.tomasz.api('GET', `/api/teams/${yard.id}/dashboard`);
out(`- dashboard -> ${dash.status} members=${dash.json.members.length} activeThisWeek=${dash.json.totals.activeThisWeek} overdue=${dash.json.totals.assignmentsOverdue} atRisk=${j(dash.json.atRisk.map((r) => `${r.user.name}:${r.reason}`))}`);
const created = await s.tomasz.api('POST', '/api/assignments', { targets: [{ kind: 'team', id: yard.id }], item: { kind: 'lab', id: 'rbac-pipeline-grant' }, dueAt: new Date(Date.now() + 7 * 864e5).toISOString(), note: 'proof run' });
out(`- POST /api/assignments -> ${created.status} ${j(created.json.assignments?.map((a) => ({ id: a.id, target: a.target.name, item: a.item.title, counts: a.counts })))}`);
check(created.status === 201, 'manager creates an assignment for the team they manage');
const dispatch = (await s.priya.api('GET', '/api/admin/teams')).json.find((t) => t.name === 'Dispatch SRE');
const denied = await s.tomasz.api('POST', '/api/assignments', { targets: [{ kind: 'team', id: dispatch.id }], item: { kind: 'lab', id: 'rbac-pipeline-grant' } });
out(`- POST /api/assignments for Dispatch SRE (not managed) -> ${denied.status} ${denied.text}`);
check(denied.status === 403 && denied.json.permission === 'assignment.manage', 'manager cannot assign outside their teams (403 ApiError)');
const csv = await s.tomasz.api('GET', `/api/reports/progress.csv?team=${yard.id}`);
out(`- GET /api/reports/progress.csv -> ${csv.status} ${csv.headers.get('content-type')}; first lines:`);
for (const l of csv.text.split('\r\n').slice(0, 3)) out(`    ${l}`);
const nocsrf = await fetch(`${GW}/api/assignments`, { method: 'POST', headers: { cookie: s.tomasz.cookie, 'content-type': 'application/json' }, body: '{}' });
out(`- POST without x-csrf-token -> ${nocsrf.status} ${await nocsrf.text()}`);
check(nocsrf.status === 403, 'CSRF token required on writes');
const acmeTeams = await s.marcus.api('GET', '/api/teams');
const linehaul = acmeTeams.json.find((t) => t.name === 'Linehaul Operations');
const acmeDash = await s.marcus.api('GET', `/api/teams/${linehaul.id}/dashboard`);
out(`- marcus (acme, brokered) dashboard Linehaul -> ${acmeDash.status} members=${j(acmeDash.json.members.map((m) => m.user.name))}`);

/* -------------------------------------------------------------- instructor */
out('\n## 5. Instructor (elena)');
const cohorts = await s.elena.api('GET', '/api/cohorts');
out(`- GET /api/cohorts -> ${cohorts.status} ${j(cohorts.json.map((c) => `${c.name} (${c.status}, ${c.memberCount} learners)`))}`);
const board = await s.elena.api('GET', `/api/cohorts/${cohorts.json[0].id}/board`);
out(`- board -> ${board.status} ${j(board.json.rows.map((r) => `${r.user.name}: ${r.progress.labsPassed}/${r.progress.labsTotal}${r.session ? ` live ${r.session.labId}` : ''}`))}`);
const bc = await s.elena.api('POST', `/api/cohorts/${cohorts.json[0].id}/broadcast`, { message: 'Remember to drain before you cordon-check.', kind: 'hint' });
check(bc.status === 204, 'instructor broadcasts a hint to the cohort');
const elenaTeam = await s.elena.api('GET', `/api/teams/${yard.id}/dashboard`);
check(elenaTeam.status === 403, `instructor cannot read a team dashboard (${elenaTeam.status})`);

/* ------------------------------------------------------------------- admin */
out('\n## 6. Org admin (priya): invitation email, roles, deactivation');
const stamp = Date.now().toString(36);
const inviteEmail = `new.hire.${stamp}@quillmoor.example`;
const inv = await s.priya.api('POST', '/api/admin/users', { email: inviteEmail, name: 'Noor Haddad', roles: ['learner'], teams: [{ teamId: yard.id, role: 'member' }] });
out(`- POST /api/admin/users -> ${inv.status} status=${inv.json.user?.status} emailSent=${inv.json.emailSent} expires=${inv.json.invitation?.expiresAt}`);
check(inv.status === 201 && inv.json.emailSent, 'org admin invites a user');
await new Promise((r) => setTimeout(r, 800));
const mails = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${inviteEmail}`)}`)).json();
for (const m of mails.messages ?? []) out(`- Mailpit: "${m.Subject}" from ${m.From.Address} to ${m.To.map((t) => t.Address).join(',')}`);
check((mails.messages ?? []).some((m) => /invited you to Quillmoor Logistics/.test(m.Subject)), 'invitation email landed in Mailpit');

const meiId = s.mei.me.user.id;
const before = await s.mei.api('GET', '/api/me');
const deact = await s.priya.api('PATCH', `/api/admin/users/${meiId}`, { status: 'deactivated' });
const after = await s.mei.api('GET', '/api/me');
out(`- deactivate mei -> ${deact.status} revokedSessions=${deact.json.revokedSessions} terminatedLabs=${deact.json.terminatedLabs}; mei /api/me before=${before.status} after=${after.status}`);
check(deact.status === 200 && after.status === 401, 'deactivation revokes the user session immediately');
let reLogin;
try {
  await login(GW, people.mei, PASSWORD);
  reLogin = 'allowed';
} catch (e) {
  reLogin = e.message.replace(/\s+/g, ' ').slice(0, 120);
}
out(`- mei logs in again while deactivated -> ${reLogin}`);
check(/deactivated/.test(reLogin), 'deactivated user is blocked at login');
const react = await s.priya.api('PATCH', `/api/admin/users/${meiId}`, { status: 'active' });
check(react.status === 200, 'reactivated (cleanup)');

const learnerAudit = await s.amara.api('GET', '/api/admin/audit');
out(`- learner GET /api/admin/audit -> ${learnerAudit.status} ${learnerAudit.text}`);
check(learnerAudit.status === 403, 'learner cannot read the audit log');

/* --------------------------------------------------------- cross-org access */
out('\n## 7. Cross-org isolation (Quillmoor admin vs Acme objects)');
const acmeAttempt = (await s.hannah.api('GET', '/api/attempts/mine?limit=1')).json.items[0];
const probes = [
  ['GET', `/api/teams/${linehaul.id}/dashboard`],
  ['GET', `/api/admin/teams/${linehaul.id}`],
  ['GET', `/api/admin/users/${s.hannah.me.user.id}`],
  ['GET', `/api/attempts/${acmeAttempt.id}`],
  ['PATCH', `/api/admin/users/${s.hannah.me.user.id}`, { status: 'deactivated' }],
  ['POST', '/api/assignments', { targets: [{ kind: 'team', id: linehaul.id }], item: { kind: 'lab', id: 'two-container-pod' } }],
  ['POST', '/api/me/org', { orgId: s.marcus.me.activeOrg.id }],
];
for (const [m, p, body] of probes) {
  const r = await s.priya.api(m, p, body);
  out(`- priya ${m} ${p} -> ${r.status} ${r.text.slice(0, 120)}`);
  check(r.status === 404 || r.status === 403, `cross-org ${m} ${p.split('/').slice(0, 4).join('/')} rejected`);
}
const hannahStill = await s.olivia.api('GET', `/api/admin/users/${s.hannah.me.user.id}`);
check(hannahStill.json?.status === 'active', 'acme user untouched by the cross-org attempt');

/* ---------------------------------------------------------------- platform */
out('\n## 8. Platform admin (rhea)');
const orgs = await s.rhea.api('GET', '/api/platform/orgs');
out(`- GET /api/platform/orgs -> ${orgs.status} ${j(orgs.json.map((o) => `${o.name} users=${o.users} labHours=${o.labHoursThisMonth} sso=${o.ssoConnections}`))}`);
const cap = await s.rhea.api('GET', '/api/platform/capacity');
out(`- GET /api/platform/capacity -> ${cap.status} reachable=${cap.json.cluster.reachable} nodes=${j(cap.json.nodes.map((n) => `${n.name} ready=${n.ready} kvm=${n.kvm} cpu=${n.cpu.requested}/${n.cpu.allocatable}`))} vms=${j(cap.json.vms)} warmPools=${cap.json.warmPools.length} sessions=${cap.json.sessions.total}`);
const orgAdminPlatform = await s.priya.api('GET', '/api/platform/orgs');
check(orgs.status === 200 && orgAdminPlatform.status === 403, `platform scope only for platform_admin (org_admin -> ${orgAdminPlatform.status})`);

/* ------------------------------------------------------------ quota + labs */
out('\n## 9. Lab start with quota enforcement (cluster kind-cloudtrain-dev)');
const q0 = (await s.priya.api('GET', '/api/admin/quotas')).json;
await s.priya.api('PUT', '/api/admin/quotas', { maxConcurrentSessions: 1 });
const live0 = (await s.priya.api('GET', '/api/admin/sessions')).json?.length ?? 0;
const first = await s.amara.api('POST', '/api/labs/scale-berth-planner/sessions');
const second = await s.kenji.api('POST', '/api/labs/two-container-pod/sessions');
out(`- quota maxConcurrentSessions=1 (live before: ${live0}); amara start -> ${first.status} ${first.json?.id ?? first.text.slice(0, 100)}; kenji start -> ${second.status} ${second.text.slice(0, 200)}`);
check(first.status === 201 || live0 >= 1, 'first lab session starts');
check(second.status === 429 && second.json.details?.quota === 'max_concurrent_sessions', 'second start refused by the concurrency quota (429)');
if (first.status === 201) {
  const id = first.json.id;
  const ext = await s.elena.api('POST', `/api/sessions/${id}/extend`, { minutes: 15 });
  out(`- instructor extend (amara is in elena's cohort) -> ${ext.status} ${ext.text}`);
  const reset = await s.elena.api('POST', `/api/sessions/${id}/reset`);
  out(`- instructor reset -> ${reset.status} ${reset.text}`);
  const tomaszCtl = await s.tomasz.api('POST', `/api/sessions/${id}/terminate`);
  out(`- manager terminate (no session.control) -> ${tomaszCtl.status}`);
  const sess = await s.amara.api('GET', `/api/sessions/${id}`);
  out(`- learner sees notices: ${j(sess.json.notices?.map((n) => `${n.kind}: ${n.message}`))}`);
  const term = await s.priya.api('POST', `/api/sessions/${id}/terminate`);
  out(`- org admin terminate -> ${term.status} ${term.text}`);
  check(ext.status === 200 && reset.status === 200 && tomaszCtl.status === 403 && term.status === 200, 'session control by cohort instructor and org admin only');
}
await s.priya.api('PUT', '/api/admin/quotas', { maxConcurrentSessions: q0.maxConcurrentSessions });

/* ------------------------------------------------------------------- audit */
out('\n## 10. Audit log (priya, Quillmoor)');
const audit = await s.priya.api('GET', '/api/admin/audit?limit=25');
for (const e of audit.json.items) out(`- ${e.at} ${e.actor?.name ?? 'system'} ${e.action} ${e.targetType}:${e.targetLabel ?? e.targetId} ${e.ip ?? ''}`);
const actions = new Set(audit.json.items.map((e) => e.action));
for (const a of ['assignment.create', 'user.invite', 'user.deactivate', 'user.reactivate', 'quota.update', 'report.export']) check(actions.has(a), `audit has ${a}`);
const auditCsv = await s.priya.api('GET', '/api/admin/audit.csv?action=user.');
out(`- GET /api/admin/audit.csv?action=user. -> ${auditCsv.status} ${auditCsv.text.split('\r\n').length - 2} rows`);
const acmeAudit = await s.olivia.api('GET', '/api/admin/audit?limit=5');
out(`- olivia (Acme) sees only Acme rows: ${j(acmeAudit.json.items.map((e) => e.action))}`);

/* --------------------------------------------------------------------- end */
const logout = await s.sam.api('POST', '/api/auth/logout');
out(`\n- logout -> ${logout.status} redirect=${logout.json.redirectUrl.split('?')[0]}; /api/me after -> ${(await s.sam.api('GET', '/api/me')).status}`);
out(`\n${failures ? `FAILED: ${failures} check(s)` : 'ALL CHECKS PASSED'}`);
if (logFile) {
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(logFile, lines.join('\n') + '\n');
}
process.exit(failures ? 1 : 0);
