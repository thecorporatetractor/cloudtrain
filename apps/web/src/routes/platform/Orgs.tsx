import { useNavigate } from '@tanstack/react-router';
import { Building2, Pause, Play, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '@/api/client';
import { useCreatePlatformOrg, usePlatformOrgAction, usePlatformOrgs, useUpdatePlatformOrg } from '@/api/platform';
import type { PlatformOrg, Quotas } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { When } from '@/components/platform';
import { Badge, Button, Card, ConfirmDialog, Dialog, Drawer, EmptyState, ErrorState, Field, Input, Stat, TableSkeleton, TableWrap } from '@/components/ui';
import { platformOrgsRoute } from '@/router';

export function PlatformOrgs() {
  return (
    <RequireAccess path="/platform">
      <Screen />
    </RequireAccess>
  );
}

function Screen() {
  const search = platformOrgsRoute.useSearch();
  const navigate = useNavigate({ from: platformOrgsRoute.fullPath });
  const set = (patch: Partial<typeof search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const q = usePlatformOrgs();

  if (q.isPending) return <TableSkeleton cols={7} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const orgs = q.data;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row-between">
        <div className="stat-row" style={{ marginBottom: 0 }}>
          <Stat label="Organisations" value={orgs.length} hint={`${orgs.filter((o) => o.status === 'suspended').length} suspended`} />
          <Stat label="Users" value={orgs.reduce((s, o) => s + o.users, 0)} hint={`${orgs.reduce((s, o) => s + o.activeUsers30d, 0)} active in 30 d`} />
          <Stat label="Running sessions" value={orgs.reduce((s, o) => s + o.runningSessions, 0)} />
          <Stat label="Lab hours this month" value={Math.round(orgs.reduce((s, o) => s + o.labHoursThisMonth, 0))} />
        </div>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => set({ create: true })}>
          New organisation
        </Button>
      </div>
      {orgs.length === 0 ? (
        <EmptyState icon={<Building2 size={20} />} title="No organisations" />
      ) : (
        <Card className="card-flush">
          <TableWrap>
            <table className="table table-clickable">
              <thead>
                <tr>
                  <th scope="col">Organisation</th>
                  <th scope="col">Status</th>
                  <th scope="col">Users</th>
                  <th scope="col">Sessions</th>
                  <th scope="col">Lab hours / quota</th>
                  <th scope="col">SSO</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id} className="row-link" tabIndex={0} onClick={() => set({ org: o.id })} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), set({ org: o.id }))} aria-label={`Open ${o.name}`}>
                    <td>
                      <span className="stack" style={{ gap: 1 }}>
                        <span className="small" style={{ fontWeight: 500 }}>
                          {o.name}
                        </span>
                        <span className="xs subtle mono">
                          {o.slug} · {o.domains.join(', ') || 'no domains'}
                        </span>
                      </span>
                    </td>
                    <td>
                      <Badge tone={o.status === 'active' ? 'ok' : 'warn'}>{o.status}</Badge>
                    </td>
                    <td className="small tnum">
                      {o.users} <span className="subtle xs">· {o.activeUsers30d} active</span>
                    </td>
                    <td className="small tnum">
                      {o.runningSessions} <span className="subtle xs">/ {o.quotas.maxConcurrentSessions}</span>
                    </td>
                    <td className="small tnum">
                      {Math.round(o.labHoursThisMonth)} <span className="subtle xs">/ {o.quotas.monthlyLabHours} h</span>
                    </td>
                    <td className="small">{o.ssoConnections ? `${o.ssoConnections} connection${o.ssoConnections === 1 ? '' : 's'}` : <span className="subtle">—</span>}</td>
                    <td className="small">
                      <When iso={o.createdAt} exact />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
      <OrgDrawer org={orgs.find((o) => o.id === search.org)} onClose={() => set({ org: undefined })} />
      <CreateOrgDialog open={!!search.create} onOpenChange={(o) => set({ create: o ? true : undefined })} />
    </div>
  );
}

function OrgDrawer({ org, onClose }: { org: PlatformOrg | undefined; onClose: () => void }) {
  const update = useUpdatePlatformOrg();
  const action = usePlatformOrgAction();
  const { toast } = useShell();
  const [quotas, setQuotas] = useState<Quotas>({ maxConcurrentSessions: 0, monthlyLabHours: 0, maxSessionMinutes: 0 });
  const [confirm, setConfirm] = useState<'suspend' | 'reactivate' | null>(null);
  useEffect(() => {
    if (org) setQuotas(org.quotas);
  }, [org]);
  const dirty = !!org && JSON.stringify(quotas) !== JSON.stringify(org.quotas);
  const num = (k: keyof Quotas) => (e: React.ChangeEvent<HTMLInputElement>) => setQuotas((f) => ({ ...f, [k]: Math.max(0, Number(e.target.value) || 0) }));

  return (
    <Drawer
      open={!!org}
      onOpenChange={(o) => !o && onClose()}
      title={org?.name ?? 'Organisation'}
      description={org ? `${org.slug} · created ${new Date(org.createdAt).toLocaleDateString()}` : undefined}
      width={520}
      actions={
        org && (
          <>
            {org.status === 'active' ? (
              <Button variant="danger" size="sm" icon={<Pause size={13} />} onClick={() => setConfirm('suspend')}>
                Suspend
              </Button>
            ) : (
              <Button variant="secondary" size="sm" icon={<Play size={13} />} onClick={() => setConfirm('reactivate')}>
                Reactivate
              </Button>
            )}
            <span className="grow" />
            <Button variant="primary" size="sm" disabled={!dirty} loading={update.isPending} onClick={() => update.mutate({ id: org.id, quotas }, { onSuccess: () => toast({ title: 'Quotas updated', description: org.name, tone: 'ok' }), onError: (e) => toast({ title: 'Could not save', description: e.message, tone: 'err' }) })}>
              Save quotas
            </Button>
          </>
        )
      }
    >
      {org && (
        <div className="stack" style={{ gap: 18 }}>
          <div className="grid-3">
            <Stat label="Users" value={org.users} hint={`${org.activeUsers30d} active`} />
            <Stat label="Sessions" value={org.runningSessions} hint="running" />
            <Stat label="Hours" value={Math.round(org.labHoursThisMonth)} hint="this month" />
          </div>
          <dl className="summary-list">
            <dt>Status</dt>
            <dd>
              <Badge tone={org.status === 'active' ? 'ok' : 'warn'}>{org.status}</Badge>
            </dd>
            <dt>Domains</dt>
            <dd>{org.domains.join(', ') || '—'}</dd>
            <dt>SSO</dt>
            <dd>{org.ssoConnections ? `${org.ssoConnections} connection${org.ssoConnections === 1 ? '' : 's'}` : 'none'}</dd>
          </dl>
          <div className="stack" style={{ gap: 12 }}>
            <div className="task-h">Quotas</div>
            <Field label="Monthly lab hours">{({ id }) => <Input id={id} type="number" min={0} value={quotas.monthlyLabHours} onChange={num('monthlyLabHours')} />}</Field>
            <Field label="Max concurrent sessions">{({ id }) => <Input id={id} type="number" min={1} value={quotas.maxConcurrentSessions} onChange={num('maxConcurrentSessions')} />}</Field>
            <Field label="Max session minutes">{({ id }) => <Input id={id} type="number" min={15} step={15} value={quotas.maxSessionMinutes} onChange={num('maxSessionMinutes')} />}</Field>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'suspend' ? `Suspend ${org?.name}?` : `Reactivate ${org?.name}?`}
        description={confirm === 'suspend' ? 'Every member is signed out and refused at the next sign-in; running labs are terminated. Data is kept.' : 'Members can sign in again with the roles they had.'}
        confirmLabel={confirm === 'suspend' ? 'Suspend organisation' : 'Reactivate'}
        danger={confirm === 'suspend'}
        loading={action.isPending}
        onConfirm={() => org && confirm && action.mutate({ id: org.id, action: confirm }, { onSuccess: () => (setConfirm(null), toast({ title: confirm === 'suspend' ? `${org.name} suspended` : `${org.name} reactivated`, tone: confirm === 'suspend' ? 'warn' : 'ok' })), onError: (e) => toast({ title: 'Failed', description: e.message, tone: 'err' }) })}
      />
    </Drawer>
  );
}

function CreateOrgDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreatePlatformOrg();
  const { toast } = useShell();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [domain, setDomain] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [hours, setHours] = useState(100);
  const [sessions, setSessions] = useState(10);
  const slugAuto = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const effSlug = slug || slugAuto;
  const err = create.error instanceof ApiError ? (create.error.details as Record<string, string> | undefined)?.slug : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New organisation" description="Creates the tenant and its Keycloak organisation; the first admin receives an invitation." width={560}>
      <div className="stack" style={{ gap: 12 }}>
        <div className="grid-2" style={{ gap: 12 }}>
          <Field label="Name" required>
            {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
          </Field>
          <Field label="Slug" required error={err ? 'Lowercase letters, digits and dashes' : create.error && !err ? create.error.message : undefined} hint="Used in URLs and the Keycloak organisation.">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} className="mono" value={effSlug} onChange={(e) => setSlug(e.target.value)} />}
          </Field>
        </div>
        <div className="grid-2" style={{ gap: 12 }}>
          <Field label="Email domain" hint="Routes sign-ins; verified later by the org admin.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />}
          </Field>
          <Field label="First org admin" hint="Gets the invitation email.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@example.com" />}
          </Field>
        </div>
        <div className="grid-2" style={{ gap: 12 }}>
          <Field label="Monthly lab hours">{({ id }) => <Input id={id} type="number" min={0} value={hours} onChange={(e) => setHours(Number(e.target.value) || 0)} />}</Field>
          <Field label="Max concurrent sessions">{({ id }) => <Input id={id} type="number" min={1} value={sessions} onChange={(e) => setSessions(Number(e.target.value) || 1)} />}</Field>
        </div>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={name.trim().length < 2 || effSlug.length < 3}
            loading={create.isPending}
            onClick={() =>
              create.mutate(
                { name: name.trim(), slug: effSlug, domains: domain ? [domain.trim()] : [], adminEmail: adminEmail || undefined, quotas: { monthlyLabHours: hours, maxConcurrentSessions: sessions } },
                {
                  onSuccess: (o) => {
                    toast({ title: `${o.name} created`, description: adminEmail ? `Invitation sent to ${adminEmail}` : 'No admin invited yet', tone: 'ok' });
                    onOpenChange(false);
                    setName('');
                    setSlug('');
                    setDomain('');
                    setAdminEmail('');
                    create.reset();
                  },
                },
              )
            }
          >
            Create organisation
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
