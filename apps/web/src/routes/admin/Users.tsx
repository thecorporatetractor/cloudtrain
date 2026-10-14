import { useNavigate } from '@tanstack/react-router';
import { Mail, Search, UserPlus, UserX, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError, useMe } from '@/api/client';
import { useAdminTeams, useAdminUser, useAdminUsers, useInvitations, useInviteUser, useRevokeInvitation, useUpdateUser } from '@/api/platform';
import type { MembershipStatus, OrgRole, OrgUser, TeamRole } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { roleLabel } from '@/app/Shell';
import { useShell } from '@/app/shell-context';
import { UserCell, When } from '@/components/platform';
import { Badge, Button, Card, Checkbox, ChipSelect, ConfirmDialog, Dialog, Drawer, EmptyState, ErrorState, Field, Input, Pager, Select, Skeleton, TableSkeleton, TableWrap, Toolbar } from '@/components/ui';
import { adminUsersRoute } from '@/router';

const PAGE = 12;
const ROLES: OrgRole[] = ['learner', 'manager', 'instructor', 'author', 'org_admin'];
const roleHint: Record<OrgRole, string> = { learner: 'Takes labs and paths', manager: 'Sees team progress, assigns work', instructor: 'Runs cohorts, observes sessions', author: 'Scenario Studio', org_admin: 'Users, teams, SSO, settings' };
const statusMeta: Record<MembershipStatus, { label: string; tone: 'ok' | 'neutral' | 'warn' }> = { active: { label: 'Active', tone: 'ok' }, invited: { label: 'Invited', tone: 'neutral' }, deactivated: { label: 'Deactivated', tone: 'warn' } };

export function AdminUsers() {
  return (
    <RequireAccess path="/admin/users">
      <Screen />
    </RequireAccess>
  );
}

function Screen() {
  const search = adminUsersRoute.useSearch();
  const navigate = useNavigate({ from: adminUsersRoute.fullPath });
  const set = (patch: Partial<typeof search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const page = search.page ?? 1;
  const [q, setQ] = useState(search.q ?? '');
  useEffect(() => {
    const t = window.setTimeout(() => q !== (search.q ?? '') && set({ q: q || undefined, page: undefined }), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const users = useAdminUsers({ q: search.q, role: search.role as OrgRole | undefined, team: search.team, status: search.status as MembershipStatus | undefined, cursor: String((page - 1) * PAGE), limit: PAGE });
  const teams = useAdminTeams();
  const invitations = useInvitations();
  const pendingInvites = (invitations.data ?? []).filter((i) => i.status === 'pending');

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Toolbar
        end={
          <Button variant="primary" icon={<UserPlus size={14} />} onClick={() => set({ invite: true })}>
            Invite
          </Button>
        }
      >
        <label className="search-field">
          <Search size={13} aria-hidden />
          <input className="search-input" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
          {q && (
            <button type="button" className="link-quiet" aria-label="Clear search" onClick={() => setQ('')}>
              <X size={12} />
            </button>
          )}
        </label>
        <Select aria-label="Role" value={search.role ?? ''} onChange={(e) => set({ role: e.target.value || undefined, page: undefined })}>
          <option value="">Any role</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </Select>
        <Select aria-label="Team" value={search.team ?? ''} onChange={(e) => set({ team: e.target.value || undefined, page: undefined })}>
          <option value="">Any team</option>
          {(teams.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Status" value={search.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined, page: undefined })}>
          <option value="">Any status</option>
          {(Object.keys(statusMeta) as MembershipStatus[]).map((s) => (
            <option key={s} value={s}>
              {statusMeta[s].label}
            </option>
          ))}
        </Select>
      </Toolbar>

      {users.isPending ? (
        <TableSkeleton cols={6} rows={8} />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : users.data.items.length === 0 ? (
        <EmptyState title="No one matches" description="Try a different search, or invite someone." action={<Button variant="secondary" onClick={() => set({ invite: true })}>Invite</Button>} />
      ) : (
        <Card className="card-flush">
          <TableWrap>
            <table className="table table-clickable">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Roles</th>
                  <th scope="col">Teams</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((u) => (
                  <tr key={u.id} className="row-link" tabIndex={0} onClick={() => set({ user: u.id })} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), set({ user: u.id }))} aria-label={`Edit ${u.name}`}>
                    <td>
                      <UserCell user={u} size="sm" />
                    </td>
                    <td>
                      <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                        {u.roles.filter((r) => r !== 'learner' || u.roles.length === 1).map((r) => (
                          <Badge key={r} tone={r === 'org_admin' ? 'accent' : 'neutral'}>
                            {roleLabel(r)}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className="small">
                      {u.teams.length ? (
                        <span className="truncate" style={{ display: 'block', maxWidth: 220 }}>
                          {u.teams.map((t) => `${t.name}${t.role === 'manager' ? ' (manager)' : ''}`).join(', ')}
                        </span>
                      ) : (
                        <span className="subtle">—</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={statusMeta[u.status].tone}>{statusMeta[u.status].label}</Badge>
                    </td>
                    <td className="small">
                      <When iso={u.lastLoginAt} />
                    </td>
                    <td className="xs subtle">{u.idp ?? u.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <div className="card-foot">
            <Pager offset={(page - 1) * PAGE} pageSize={PAGE} total={users.data.total} loading={users.isFetching} onChange={(o) => set({ page: o / PAGE + 1 || undefined })} />
          </div>
        </Card>
      )}

      {pendingInvites.length > 0 && <Invitations items={pendingInvites} />}

      <UserDrawer id={search.user} onClose={() => set({ user: undefined })} />
      <InviteDialog open={!!search.invite} onOpenChange={(o) => set({ invite: o ? true : undefined })} />
    </div>
  );
}

function Invitations({ items }: { items: { id: string; email: string; roles: OrgRole[]; expiresAt: string; invitedBy: { name: string } }[] }) {
  const revoke = useRevokeInvitation();
  const { toast } = useShell();
  return (
    <Card className="card-flush">
      <div className="card-head">
        <h2 className="row" style={{ gap: 8 }}>
          <Mail size={14} className="subtle" /> Pending invitations <span className="subtle small tnum">{items.length}</span>
        </h2>
      </div>
      <ul className="due-list">
        {items.map((i) => (
          <li key={i.id} className="due-row">
            <span className="stack grow" style={{ gap: 1, minWidth: 0 }}>
              <span className="small truncate">{i.email}</span>
              <span className="xs subtle">
                {i.roles.map(roleLabel).join(', ')} · invited by {i.invitedBy.name} · expires <When iso={i.expiresAt} />
              </span>
            </span>
            <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === i.id} onClick={() => revoke.mutate(i.id, { onSuccess: () => toast({ title: 'Invitation revoked', description: i.email, tone: 'neutral' }) })}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TeamPicker({ value, onChange, teams }: { value: { teamId: string; role: TeamRole }[]; onChange: (v: { teamId: string; role: TeamRole }[]) => void; teams: { id: string; name: string }[] }) {
  return (
    <div className="pick-scroll" style={{ maxHeight: 180 }}>
      {teams.map((t) => {
        const cur = value.find((v) => v.teamId === t.id);
        return (
          <div key={t.id} className="pick-check-row row" style={{ gap: 8 }}>
            <Checkbox label={t.name} checked={!!cur} onChange={(e) => onChange(e.target.checked ? [...value, { teamId: t.id, role: 'member' }] : value.filter((v) => v.teamId !== t.id))} className="grow" />
            {cur && (
              <Select aria-label={`Role in ${t.name}`} value={cur.role} onChange={(e) => onChange(value.map((v) => (v.teamId === t.id ? { ...v, role: e.target.value as TeamRole } : v)))}>
                <option value="member">Member</option>
                <option value="manager">Manager</option>
              </Select>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const invite = useInviteUser();
  const teams = useAdminTeams();
  const { toast } = useShell();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<OrgRole[]>(['learner']);
  const [teamSel, setTeamSel] = useState<{ teamId: string; role: TeamRole }[]>([]);
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && roles.length > 0;
  const fieldError = invite.error instanceof ApiError ? (invite.error.details as Record<string, string> | undefined)?.email : undefined;

  const submit = () =>
    invite.mutate(
      { email: email.trim(), name: name.trim() || undefined, roles, teams: teamSel },
      {
        onSuccess: (r) => {
          toast({ title: `Invitation sent to ${r.invitation.email}`, description: r.emailSent ? `Expires ${new Date(r.invitation.expiresAt).toLocaleDateString()}. They sign in through ${roles.includes('org_admin') ? 'SSO or password' : 'the usual route'} and land with the roles you picked.` : 'Email delivery is pending.', tone: 'ok' });
          onOpenChange(false);
          setEmail('');
          setName('');
          setRoles(['learner']);
          setTeamSel([]);
          invite.reset();
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Invite someone" description="They get an email with a link; their account is created with these roles and teams when they first sign in." width={560}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="grid-2" style={{ gap: 12 }}>
          <Field label="Work email" required error={fieldError ? 'Enter a valid email address' : invite.error && !fieldError ? invite.error.message : undefined}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@quillmoor.example" autoFocus />}
          </Field>
          <Field label="Name" hint="Optional; SSO fills it in.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
        </div>
        <Field label="Roles" required hint={roles.map((r) => roleHint[r]).join(' · ')}>
          {() => <ChipSelect label="Roles" options={ROLES.map((r) => ({ value: r, label: roleLabel(r), hint: roleHint[r] }))} value={roles} onChange={(v) => setRoles(v.length ? v : ['learner'])} />}
        </Field>
        <Field label="Teams" hint="A manager of a team sees its dashboard and can assign work to it.">
          {() => <TeamPicker value={teamSel} onChange={setTeamSel} teams={teams.data ?? []} />}
        </Field>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} loading={invite.isPending} onClick={submit} icon={<Mail size={14} />}>
            Send invitation
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function UserDrawer({ id, onClose }: { id: string | undefined; onClose: () => void }) {
  const q = useAdminUser(id);
  const me = useMe().data;
  const teams = useAdminTeams();
  const update = useUpdateUser();
  const { toast } = useShell();
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [teamSel, setTeamSel] = useState<{ teamId: string; role: TeamRole }[]>([]);
  const [confirm, setConfirm] = useState<'deactivate' | 'reactivate' | null>(null);
  const [ack, setAck] = useState(false);
  const u = q.data;

  useEffect(() => {
    if (u) {
      setRoles(u.roles);
      setTeamSel(u.teams.map((t) => ({ teamId: t.id, role: t.role })));
    }
  }, [u]);

  const dirty = !!u && (JSON.stringify([...roles].sort()) !== JSON.stringify([...u.roles].sort()) || JSON.stringify(teamSel) !== JSON.stringify(u.teams.map((t) => ({ teamId: t.id, role: t.role }))));
  const self = u?.id === me?.id;

  const save = () =>
    u &&
    update.mutate(
      { id: u.id, roles, teams: teamSel },
      {
        onSuccess: () => toast({ title: 'Saved', description: `${u.name}: ${roles.map(roleLabel).join(', ')}`, tone: 'ok' }),
        onError: (e) => toast({ title: 'Could not save', description: e.message, tone: 'err' }),
      },
    );

  const changeStatus = () =>
    u &&
    confirm &&
    update.mutate(
      { id: u.id, status: confirm === 'deactivate' ? 'deactivated' : 'active' },
      {
        onSuccess: (r) => {
          setConfirm(null);
          setAck(false);
          toast({ title: confirm === 'deactivate' ? `${u.name} deactivated` : `${u.name} reactivated`, description: confirm === 'deactivate' ? `${r.revokedSessions ?? 0} session${r.revokedSessions === 1 ? '' : 's'} revoked · ${r.terminatedLabs ?? 0} running lab${r.terminatedLabs === 1 ? '' : 's'} terminated` : 'They can sign in again.', tone: confirm === 'deactivate' ? 'warn' : 'ok' });
        },
        onError: (e) => toast({ title: 'Could not change status', description: e.message, tone: 'err' }),
      },
    );

  return (
    <Drawer
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={u?.name ?? 'Member'}
      description={u ? `${u.email} · ${u.title ?? ''}` : undefined}
      width={520}
      actions={
        u && (
          <>
            {u.status === 'deactivated' ? (
              <Button variant="secondary" size="sm" onClick={() => setConfirm('reactivate')}>
                Reactivate
              </Button>
            ) : (
              <Button variant="danger" size="sm" icon={<UserX size={13} />} disabled={self} title={self ? 'You cannot deactivate yourself' : undefined} onClick={() => setConfirm('deactivate')}>
                Deactivate
              </Button>
            )}
            <span className="grow" />
            <Button variant="primary" size="sm" disabled={!dirty} loading={update.isPending && !confirm} onClick={save}>
              Save changes
            </Button>
          </>
        )
      }
    >
      {q.isPending ? (
        <Skeleton h={200} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <UserForm u={q.data} roles={roles} setRoles={setRoles} teamSel={teamSel} setTeamSel={setTeamSel} teams={teams.data ?? []} />
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && (setConfirm(null), setAck(false))}
        title={confirm === 'deactivate' ? `Deactivate ${u?.name}?` : `Reactivate ${u?.name}?`}
        description={confirm === 'deactivate' ? 'This takes effect immediately.' : 'They regain access with the roles and teams they had.'}
        confirmLabel={confirm === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        danger={confirm === 'deactivate'}
        loading={update.isPending}
        disabled={confirm === 'deactivate' && !ack}
        onConfirm={changeStatus}
      >
        {confirm === 'deactivate' && (
          <div className="stack" style={{ gap: 10, marginBottom: 6 }}>
            <ul className="effects">
              <li>Every signed-in session is revoked; the next request signs them out.</li>
              <li>Running labs are terminated and saved as abandoned.</li>
              <li>They are removed from team and cohort boards; attempts and skill evidence are kept.</li>
              <li>If they sign in through SSO, the IdP must also stop asserting them, or deactivate them there.</li>
            </ul>
            <Checkbox label="I understand the running labs will be terminated" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          </div>
        )}
      </ConfirmDialog>
    </Drawer>
  );
}

function UserForm({ u, roles, setRoles, teamSel, setTeamSel, teams }: { u: OrgUser; roles: OrgRole[]; setRoles: (r: OrgRole[]) => void; teamSel: { teamId: string; role: TeamRole }[]; setTeamSel: (v: { teamId: string; role: TeamRole }[]) => void; teams: { id: string; name: string }[] }) {
  return (
    <div className="stack" style={{ gap: 18 }}>
      <dl className="summary-list">
        <dt>Status</dt>
        <dd>
          <Badge tone={statusMeta[u.status].tone}>{statusMeta[u.status].label}</Badge>
        </dd>
        <dt>Joined</dt>
        <dd>
          <When iso={u.joinedAt} exact />
          {u.invitedBy ? ` · invited by ${u.invitedBy.name}` : ''}
        </dd>
        <dt>Last sign-in</dt>
        <dd>
          <When iso={u.lastLoginAt} />
          {u.idp ? ` · via ${u.idp}` : ''}
        </dd>
        {u.cohorts.length > 0 && (
          <>
            <dt>Cohorts</dt>
            <dd>{u.cohorts.map((c) => c.name).join(', ')}</dd>
          </>
        )}
      </dl>
      <Field label="Roles" hint={u.idp ? 'Roles from the IdP group mapping are re-applied at every sign-in; changes here last until then.' : roles.map((r) => roleHint[r]).join(' · ')}>
        {() => <ChipSelect label="Roles" options={ROLES.map((r) => ({ value: r, label: roleLabel(r), hint: roleHint[r] }))} value={roles} onChange={(v) => setRoles(v.length ? v : ['learner'])} disabled={u.status === 'deactivated'} />}
      </Field>
      <Field label="Teams">{() => <TeamPicker value={teamSel} onChange={setTeamSel} teams={teams} />}</Field>
    </div>
  );
}
