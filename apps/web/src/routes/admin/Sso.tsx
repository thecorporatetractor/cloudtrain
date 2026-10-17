import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, Check, CheckCircle2, Copy, ExternalLink, Globe, KeyRound, Plus, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAddDomain, useAdminTeams, useCreateSso, useDeleteSso, useRemoveDomain, useSso, useTestSso, useUpdateSso, useVerifyDomain } from '@/api/platform';
import type { OrgDomain, OrgRole, SsoConnection, SsoGroupMapping, SsoStatus, SsoType, TeamRole } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { roleLabel } from '@/app/Shell';
import { useShell } from '@/app/shell-context';
import { When } from '@/components/platform';
import { Badge, Button, Card, Checkbox, ChipSelect, ConfirmDialog, Dialog, Drawer, EmptyState, ErrorState, Field, Input, PageSkeleton, Segmented, Switch, Textarea, Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { adminSsoRoute } from '@/router';

const ROLES: OrgRole[] = ['learner', 'manager', 'instructor', 'author', 'org_admin'];
const statusMeta: Record<SsoStatus, { label: string; tone: 'ok' | 'neutral' | 'err' | 'warn' }> = { active: { label: 'Active', tone: 'ok' }, draft: { label: 'Draft', tone: 'neutral' }, error: { label: 'Error', tone: 'err' }, disabled: { label: 'Disabled', tone: 'warn' } };

export function AdminSso() {
  return (
    <RequireAccess path="/admin/sso">
      <Screen />
    </RequireAccess>
  );
}

function Screen() {
  const search = adminSsoRoute.useSearch();
  const navigate = useNavigate({ from: adminSsoRoute.fullPath });
  const set = (patch: Partial<typeof search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const q = useSso();
  const test = useTestSso();
  const { toast } = useShell();

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { connections, domains } = q.data;
  const verified = domains.filter((d) => d.verified).length;
  const enforced = connections.some((c) => c.enforced);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="split split-7-5" style={{ alignItems: 'start' }}>
        <Card className="card-flush">
          <div className="card-head">
            <h2 className="row" style={{ gap: 8 }}>
              <KeyRound size={14} className="subtle" /> Identity providers
            </h2>
            <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => set({ add: true })}>
              Add connection
            </Button>
          </div>
          {connections.length === 0 ? (
            <EmptyState compact icon={<KeyRound size={18} />} title="No identity provider yet" description="Members sign in with CloudTrain passwords. Connect Entra ID, Okta, Google Workspace or any OIDC / SAML 2.0 provider, verify your domain, then enforce it." action={<Button variant="secondary" size="sm" onClick={() => set({ add: true })}>Add connection</Button>} />
          ) : (
            <ul className="due-list">
              {connections.map((c) => (
                <li key={c.id} className="due-row conn-row">
                  <button type="button" className="stack grow conn-main" style={{ gap: 3, minWidth: 0, textAlign: 'left' }} onClick={() => set({ connection: c.id })}>
                    <span className="row" style={{ gap: 8 }}>
                      <span className="small" style={{ fontWeight: 500 }}>
                        {c.displayName}
                      </span>
                      <Badge tone="outline">{c.type.toUpperCase()}</Badge>
                      <Badge tone={statusMeta[c.status].tone}>{statusMeta[c.status].label}</Badge>
                      {c.enforced && (
                        <Badge tone="accent">
                          <ShieldCheck size={10} /> Enforced
                        </Badge>
                      )}
                    </span>
                    <span className="xs subtle truncate">
                      <span className="mono">{c.alias}</span> · {c.groupMappings.length} group mapping{c.groupMappings.length === 1 ? '' : 's'} · {c.lastTest ? (<>last test {c.lastTest.ok ? 'passed' : 'failed'} <When iso={c.lastTest.checkedAt} /></>) : 'never tested'}
                    </span>
                  </button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={test.isPending && test.variables === c.id}
                    onClick={() =>
                      test.mutate(c.id, {
                        onSuccess: (r) => toast({ title: r.ok ? `${c.displayName}: all checks passed` : `${c.displayName}: test failed`, description: r.ok ? 'The connection is active; you can now enforce it.' : r.steps.find((s) => !s.ok)?.detail, tone: r.ok ? 'ok' : 'err' }),
                        onError: (e) => toast({ title: 'Test failed to run', description: e.message, tone: 'err' }),
                      })
                    }
                  >
                    Test
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Domains domains={domains} />
      </div>

      <Card className="card-body" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
          {enforced ? <ShieldCheck size={18} className="text-ok" style={{ marginTop: 2 }} /> : <AlertTriangle size={18} className="subtle" style={{ marginTop: 2 }} />}
          <div className="stack" style={{ gap: 2 }}>
            <strong className="small">{enforced ? 'Single sign-on is enforced' : 'Single sign-on is not enforced'}</strong>
            <span className="small muted">{enforced ? `Local passwords are disabled for ${verified} verified domain${verified === 1 ? '' : 's'}. Deactivating someone in the IdP blocks them at the next sign-in; deactivating here is immediate.` : `${verified ? 'Members can still sign in with CloudTrain passwords. Test the connection and switch on “Enforce” to require the IdP.' : 'Verify at least one domain (DNS TXT record) and test the connection before enforcing.'}`}</span>
          </div>
        </div>
      </Card>

      <ConnectionDrawer id={search.connection} connections={connections} domains={domains} onClose={() => set({ connection: undefined })} />
      <AddConnectionWizard open={!!search.add} onOpenChange={(o) => set({ add: o ? true : undefined })} onCreated={(c) => set({ add: undefined, connection: c.id })} />
    </div>
  );
}

/* -------------------------------- Domains ---------------------------------- */

function Domains({ domains }: { domains: OrgDomain[] }) {
  const add = useAddDomain();
  const verify = useVerifyDomain();
  const remove = useRemoveDomain();
  const { toast } = useShell();
  const [domain, setDomain] = useState('');
  const [showTxt, setShowTxt] = useState<string | null>(domains.find((d) => !d.verified)?.domain ?? null);
  const copy = (v: string) => void navigator.clipboard?.writeText(v).then(() => toast({ title: 'Copied', description: v, tone: 'neutral' }));

  return (
    <Card className="card-flush">
      <div className="card-head">
        <h2 className="row" style={{ gap: 8 }}>
          <Globe size={14} className="subtle" /> Email domains
        </h2>
        <span className="xs subtle">route sign-ins to this org</span>
      </div>
      <ul className="due-list">
        {domains.map((d) => (
          <li key={d.domain} className="stack" style={{ gap: 0 }}>
            <div className="due-row">
              <span className="stack grow" style={{ gap: 1, minWidth: 0 }}>
                <span className="small mono">{d.domain}</span>
                <span className="xs subtle">{d.verified ? (<>verified <When iso={d.verifiedAt} /></>) : 'not verified'}</span>
              </span>
              {d.verified ? (
                <Badge tone="ok">
                  <CheckCircle2 size={10} /> Verified
                </Badge>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setShowTxt(showTxt === d.domain ? null : d.domain)}>
                    {showTxt === d.domain ? 'Hide record' : 'DNS record'}
                  </Button>
                  <Button variant="secondary" size="sm" loading={verify.isPending && verify.variables === d.domain} onClick={() => verify.mutate(d.domain, { onSuccess: (r) => toast({ title: r.ok ? `${d.domain} verified` : `${d.domain} not verified yet`, description: r.detail, tone: r.ok ? 'ok' : 'warn' }) })}>
                    Verify
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${d.domain}`} icon={<Trash2 size={13} />} onClick={() => remove.mutate(d.domain, { onSuccess: () => toast({ title: `${d.domain} removed`, tone: 'neutral' }) })} />
            </div>
            {!d.verified && showTxt === d.domain && (
              <div className="txt-record">
                <p className="xs muted" style={{ marginBottom: 8 }}>
                  Add this TXT record at your DNS provider, wait for it to propagate (usually minutes, up to an hour), then press Verify.
                </p>
                <dl className="summary-list summary-list-mono">
                  <dt>Type</dt>
                  <dd>TXT</dd>
                  <dt>Name</dt>
                  <dd className="row" style={{ gap: 6 }}>
                    {d.verification.name}
                    <Button variant="ghost" size="sm" iconOnly aria-label="Copy name" icon={<Copy size={12} />} onClick={() => copy(d.verification.name)} />
                  </dd>
                  <dt>Value</dt>
                  <dd className="row" style={{ gap: 6 }}>
                    <span className="truncate">{d.verification.value}</span>
                    <Button variant="ghost" size="sm" iconOnly aria-label="Copy value" icon={<Copy size={12} />} onClick={() => copy(d.verification.value)} />
                  </dd>
                </dl>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form
        className="row"
        style={{ gap: 8, padding: '10px 14px 14px' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!domain.trim()) return;
          add.mutate(
            { domain: domain.trim() },
            {
              onSuccess: (d) => {
                setDomain('');
                setShowTxt(d.domain);
                toast({ title: `${d.domain} added`, description: 'Publish the TXT record, then verify.', tone: 'ok' });
              },
              onError: (err) => toast({ title: 'Could not add domain', description: err.message, tone: 'err' }),
            },
          );
        }}
      >
        <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="add a domain, e.g. eu.quillmoor.example" aria-label="New domain" />
        <Button type="submit" variant="secondary" size="md" disabled={!domain.trim()} loading={add.isPending} icon={<Plus size={13} />}>
          Add
        </Button>
      </form>
    </Card>
  );
}

/* ---------------------------- Connection drawer ----------------------------- */

function ConnectionDrawer({ id, connections, domains, onClose }: { id: string | undefined; connections: SsoConnection[]; domains: OrgDomain[]; onClose: () => void }) {
  const c = connections.find((x) => x.id === id);
  const update = useUpdateSso();
  const remove = useDeleteSso();
  const test = useTestSso();
  const teams = useAdminTeams();
  const { toast } = useShell();
  const [mappings, setMappings] = useState<SsoGroupMapping[]>([]);
  const [enforceConfirm, setEnforceConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  useEffect(() => setMappings(c?.groupMappings ?? []), [c]);
  const dirty = !!c && JSON.stringify(mappings) !== JSON.stringify(c.groupMappings);
  const canEnforce = !!c && c.status === 'active' && domains.some((d) => d.verified);

  const saveMappings = () => c && update.mutate({ id: c.id, groupMappings: mappings }, { onSuccess: () => toast({ title: 'Group mappings saved', description: 'Applied at every sign-in.', tone: 'ok' }), onError: (e) => toast({ title: 'Could not save', description: e.message, tone: 'err' }) });
  const setEnforced = (v: boolean) => c && update.mutate({ id: c.id, enforced: v }, { onSuccess: () => (setEnforceConfirm(false), toast({ title: v ? 'SSO enforced' : 'SSO no longer enforced', description: v ? 'Local passwords are disabled for the verified domains.' : 'Members can use passwords again.', tone: v ? 'ok' : 'warn' })), onError: (e) => toast({ title: 'Could not change enforcement', description: e.message, tone: 'err' }) });

  return (
    <Drawer
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={c?.displayName ?? 'Connection'}
      description={c ? `${c.type.toUpperCase()} · alias ${c.alias} · created ${new Date(c.createdAt).toLocaleDateString()}` : undefined}
      width={600}
      actions={
        c && (
          <>
            <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={() => setDeleteConfirm(true)}>
              Delete
            </Button>
            <span className="grow" />
            <Button variant="secondary" size="sm" loading={test.isPending} onClick={() => test.mutate(c.id, { onSuccess: (r) => toast({ title: r.ok ? 'All checks passed' : 'Test failed', description: r.ok ? undefined : r.steps.find((s) => !s.ok)?.detail, tone: r.ok ? 'ok' : 'err' }) })}>
              Test connection
            </Button>
            <Button variant="primary" size="sm" disabled={!dirty} loading={update.isPending} onClick={saveMappings}>
              Save mappings
            </Button>
          </>
        )
      }
    >
      {c && (
        <div className="stack" style={{ gap: 20 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={statusMeta[c.status].tone}>{statusMeta[c.status].label}</Badge>
            {c.enforced && (
              <Badge tone="accent">
                <ShieldCheck size={10} /> Enforced
              </Badge>
            )}
            {c.lastTest?.loginUrl && (
              <a href={c.lastTest.loginUrl} target="_blank" rel="noreferrer" className="link-quiet xs">
                Try a sign-in <ExternalLink size={11} />
              </a>
            )}
          </div>

          <section className="stack" style={{ gap: 8 }}>
            <div className="task-h">Enforce</div>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <Switch label="Enforce single sign-on" checked={c.enforced} disabled={!canEnforce && !c.enforced} onCheckedChange={(v) => (v ? setEnforceConfirm(true) : setEnforced(false))} />
              <span className="small muted">{c.enforced ? 'Members of the verified domains must sign in through this provider; CloudTrain passwords are refused.' : canEnforce ? 'Require this provider for the verified domains. Make sure your own account signs in through it first.' : 'Needs an active connection (passing test) and at least one verified domain.'}</span>
            </div>
          </section>

          <section className="stack" style={{ gap: 8 }}>
            <div className="task-h">Provider</div>
            <dl className="summary-list summary-list-mono">
              {c.oidc && (
                <>
                  <dt>Discovery</dt>
                  <dd className="truncate">{c.oidc.discoveryUrl}</dd>
                  <dt>Client ID</dt>
                  <dd>{c.oidc.clientId}</dd>
                  <dt>Secret</dt>
                  <dd>{c.oidc.hasClientSecret ? '•••••••• set' : 'not set'}</dd>
                  <dt>Scopes</dt>
                  <dd>{c.oidc.scopes.join(' ')}</dd>
                  <dt>Role claim</dt>
                  <dd>{c.oidc.roleClaim}</dd>
                </>
              )}
              {c.saml && (
                <>
                  <dt>Metadata</dt>
                  <dd className="truncate">{c.saml.metadataUrl ?? 'uploaded XML'}</dd>
                  <dt>Entity ID</dt>
                  <dd>{c.saml.entityId ?? '—'}</dd>
                  <dt>Group attr.</dt>
                  <dd>{c.saml.groupAttribute}</dd>
                </>
              )}
              <dt>Redirect URI</dt>
              <dd className="truncate">{`${window.location.origin}/api/auth/callback`}</dd>
            </dl>
          </section>

          {c.lastTest && (
            <section className="stack" style={{ gap: 8 }}>
              <div className="task-h">
                Last test · <When iso={c.lastTest.checkedAt} />
              </div>
              <ul className="test-steps">
                {c.lastTest.steps.map((s) => (
                  <li key={s.name} className={cn('row small', !s.ok && 'text-err')} style={{ gap: 8, alignItems: 'flex-start' }}>
                    {s.ok ? <CheckCircle2 size={13} className="text-ok" style={{ marginTop: 2 }} /> : <XCircle size={13} style={{ marginTop: 2 }} />}
                    <span>
                      {s.name}
                      {s.detail && <span className="subtle"> · {s.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="stack" style={{ gap: 8 }}>
            <div className="task-h">Group → roles and teams</div>
            <p className="xs subtle">Each IdP group (or app-role value) grants CloudTrain roles and team memberships. Re-applied at every sign-in; everyone also gets {c.defaultRoles.map(roleLabel).join(', ')}.</p>
            <MappingEditor value={mappings} onChange={setMappings} teams={teams.data ?? []} />
          </section>
        </div>
      )}
      <ConfirmDialog open={enforceConfirm} onOpenChange={setEnforceConfirm} title={`Enforce ${c?.displayName}?`} description="From now on, people with a verified-domain email can only sign in through this provider." confirmLabel="Enforce" loading={update.isPending} onConfirm={() => setEnforced(true)}>
        <ul className="effects" style={{ marginBottom: 8 }}>
          <li>CloudTrain passwords stop working for {domains.filter((d) => d.verified).map((d) => d.domain).join(', ')}.</li>
          <li>Someone removed from the IdP is refused at their next sign-in.</li>
          <li>If the IdP breaks, nobody from those domains can sign in until you switch this off (platform support can too).</li>
        </ul>
      </ConfirmDialog>
      <ConfirmDialog open={deleteConfirm} onOpenChange={setDeleteConfirm} title={`Delete ${c?.displayName}?`} description={c?.enforced ? 'It is enforced: deleting it re-enables passwords for the verified domains.' : 'Existing accounts stay; they sign in with passwords until another provider is enforced.'} confirmLabel="Delete connection" danger loading={remove.isPending} onConfirm={() => c && remove.mutate(c.id, { onSuccess: () => (setDeleteConfirm(false), onClose(), toast({ title: 'Connection deleted', tone: 'neutral' })) })} />
    </Drawer>
  );
}

function MappingEditor({ value, onChange, teams }: { value: SsoGroupMapping[]; onChange: (v: SsoGroupMapping[]) => void; teams: { id: string; name: string }[] }) {
  const [group, setGroup] = useState('');
  const edit = (i: number, patch: Partial<SsoGroupMapping>) => onChange(value.map((m, k) => (k === i ? { ...m, ...patch } : m)));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {value.map((m, i) => (
        <div key={i} className="mapping">
          <div className="row-between" style={{ gap: 8 }}>
            <span className="mono small truncate">{m.group}</span>
            <Button variant="ghost" size="sm" iconOnly aria-label={`Remove mapping ${m.group}`} icon={<Trash2 size={12} />} onClick={() => onChange(value.filter((_, k) => k !== i))} />
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <span className="xs subtle" style={{ width: 44, paddingTop: 6 }}>
              roles
            </span>
            <ChipSelect label={`Roles for ${m.group}`} options={ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} value={m.roles} onChange={(roles) => edit(i, { roles })} />
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <span className="xs subtle" style={{ width: 44, paddingTop: 6 }}>
              teams
            </span>
            <ChipSelect label={`Teams for ${m.group}`} options={teams.map((t) => ({ value: t.id, label: t.name }))} value={m.teams.map((t) => t.teamId)} onChange={(ids) => edit(i, { teams: ids.map((id) => ({ teamId: id, role: (m.teams.find((t) => t.teamId === id)?.role ?? 'member') as TeamRole })) })} />
          </div>
        </div>
      ))}
      <form
        className="row"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!group.trim() || value.some((m) => m.group === group.trim())) return;
          onChange([...value, { group: group.trim(), roles: ['learner'], teams: [] }]);
          setGroup('');
        }}
      >
        <Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="IdP group or app role, e.g. CloudTrain.Manager" aria-label="New group" />
        <Button type="submit" variant="secondary" disabled={!group.trim()} icon={<Plus size={13} />}>
          Add
        </Button>
      </form>
    </div>
  );
}

/* ---------------------------------- Wizard --------------------------------- */

function AddConnectionWizard({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: SsoConnection) => void }) {
  const create = useCreateSso();
  const { toast } = useShell();
  const [step, setStep] = useState(0);
  const [type, setType] = useState<SsoType>('oidc');
  const [preset, setPreset] = useState<'entra' | 'okta' | 'google' | 'other'>('entra');
  const [displayName, setDisplayName] = useState('Microsoft Entra ID');
  const [discoveryUrl, setDiscoveryUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [roleClaim, setRoleClaim] = useState('roles');
  const [metadataMode, setMetadataMode] = useState<'url' | 'xml'>('url');
  const [metadataUrl, setMetadataUrl] = useState('');
  const [metadataXml, setMetadataXml] = useState('');
  const [groupAttribute, setGroupAttribute] = useState('groups');
  const [defaultRoles, setDefaultRoles] = useState<OrgRole[]>(['learner']);
  const [ack, setAck] = useState(false);

  const choosePreset = (p: typeof preset) => {
    setPreset(p);
    if (p === 'entra') (setType('oidc'), setDisplayName('Microsoft Entra ID'), setDiscoveryUrl('https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration'), setRoleClaim('roles'));
    if (p === 'okta') (setType('oidc'), setDisplayName('Okta'), setDiscoveryUrl('https://<org>.okta.com/.well-known/openid-configuration'), setRoleClaim('groups'));
    if (p === 'google') (setType('oidc'), setDisplayName('Google Workspace'), setDiscoveryUrl('https://accounts.google.com/.well-known/openid-configuration'), setRoleClaim('groups'));
    if (p === 'other') setDisplayName('');
  };
  const providerValid = type === 'oidc' ? discoveryUrl.includes('.well-known') && !discoveryUrl.includes('<') && clientId.trim().length > 3 && clientSecret.length > 3 : metadataMode === 'url' ? metadataUrl.startsWith('https://') : metadataXml.includes('EntityDescriptor');

  const submit = () =>
    create.mutate(
      { type, displayName: displayName.trim(), oidc: type === 'oidc' ? { discoveryUrl, clientId, clientSecret, roleClaim } : undefined, saml: type === 'saml' ? { metadataUrl: metadataMode === 'url' ? metadataUrl : undefined, metadataXml: metadataMode === 'xml' ? metadataXml : undefined, groupAttribute } : undefined, defaultRoles },
      {
        onSuccess: (c) => {
          toast({ title: `${c.displayName} added as a draft`, description: 'Test the connection, map groups, verify a domain, then enforce.', tone: 'ok' });
          onCreated(c);
          setStep(0);
          setAck(false);
        },
        onError: (e) => toast({ title: 'Could not create the connection', description: e.message, tone: 'err' }),
      },
    );

  const steps = ['Provider', 'Credentials', 'Roles', 'Review'];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add an identity provider" description="Four steps. Nothing changes for your members until you enforce the connection." width={640}>
      <ol className="stepper" style={{ marginBottom: 18 }}>
        {steps.map((s, i) => (
          <li key={s} className={cn('step', i < step && 'step-done', i === step && 'step-current')}>
            <span className="step-dot">{i < step ? <Check size={10} /> : null}</span> {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="stack" style={{ gap: 14 }}>
          <div className="preset-grid" role="radiogroup" aria-label="Provider">
            {(
              [
                ['entra', 'Microsoft Entra ID', 'OIDC · app roles'],
                ['okta', 'Okta', 'OIDC · groups claim'],
                ['google', 'Google Workspace', 'OIDC'],
                ['other', 'Other OIDC or SAML 2.0', 'discovery URL or metadata'],
              ] as const
            ).map(([id, label, hint]) => (
              <button key={id} type="button" role="radio" aria-checked={preset === id} className={cn('preset', preset === id && 'is-on')} onClick={() => choosePreset(id)}>
                <span className="small" style={{ fontWeight: 500 }}>
                  {label}
                </span>
                <span className="xs subtle">{hint}</span>
              </button>
            ))}
          </div>
          {preset === 'other' && <Segmented<SsoType> label="Protocol" value={type} onChange={setType} options={[{ value: 'oidc', label: 'OpenID Connect' }, { value: 'saml', label: 'SAML 2.0' }]} />}
          <Field label="Display name" required hint="Shown on the sign-in button: “Continue with …”.">
            {({ id }) => <Input id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}
          </Field>
        </div>
      )}

      {step === 1 && type === 'oidc' && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="callout xs">
            Register CloudTrain in your provider with redirect URI <span className="mono">{`${window.location.origin}/api/auth/callback`}</span> and a confidential client (code flow + PKCE).
          </div>
          <Field label="Discovery URL" required hint="The .well-known/openid-configuration document.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={discoveryUrl} onChange={(e) => setDiscoveryUrl(e.target.value)} className="mono" />}
          </Field>
          <div className="grid-2" style={{ gap: 12 }}>
            <Field label="Client ID" required>
              {({ id }) => <Input id={id} value={clientId} onChange={(e) => setClientId(e.target.value)} className="mono" />}
            </Field>
            <Field label="Client secret" required hint="Stored encrypted; never shown again.">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="off" />}
            </Field>
          </div>
          <Field label="Role / group claim" hint="Claim in the ID token that lists groups or app roles.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={roleClaim} onChange={(e) => setRoleClaim(e.target.value)} className="mono" />}
          </Field>
        </div>
      )}
      {step === 1 && type === 'saml' && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="callout xs">
            Service provider entity ID <span className="mono">{`${window.location.origin}/api/auth/saml`}</span> · ACS URL <span className="mono">{`${window.location.origin}/api/auth/callback`}</span>
          </div>
          <Segmented<'url' | 'xml'> label="Metadata" value={metadataMode} onChange={setMetadataMode} options={[{ value: 'url', label: 'Metadata URL' }, { value: 'xml', label: 'Paste XML' }]} />
          {metadataMode === 'url' ? (
            <Field label="IdP metadata URL" required>
              {({ id }) => <Input id={id} value={metadataUrl} onChange={(e) => setMetadataUrl(e.target.value)} className="mono" placeholder="https://…/sso/saml/metadata" />}
            </Field>
          ) : (
            <Field label="IdP metadata XML" required>
              {({ id }) => <Textarea id={id} value={metadataXml} onChange={(e) => setMetadataXml(e.target.value)} className="mono" rows={6} placeholder="<EntityDescriptor …>" />}
            </Field>
          )}
          <Field label="Group attribute" hint="SAML attribute carrying the user's groups.">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={groupAttribute} onChange={(e) => setGroupAttribute(e.target.value)} className="mono" />}
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Roles for everyone from this provider" hint="Group mappings add roles on top; set them up after the connection exists.">
            {() => <ChipSelect label="Default roles" options={ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} value={defaultRoles} onChange={(v) => setDefaultRoles(v.length ? v : ['learner'])} />}
          </Field>
          {preset === 'entra' && (
            <div className="callout xs">
              Entra app roles map one-to-one: <span className="mono">CloudTrain.Learner</span>, <span className="mono">CloudTrain.Manager</span>, <span className="mono">CloudTrain.Instructor</span>, <span className="mono">CloudTrain.Author</span>, <span className="mono">CloudTrain.OrgAdmin</span>. They are pre-filled as group mappings.
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="stack" style={{ gap: 12 }}>
          <dl className="summary-list">
            <dt>Provider</dt>
            <dd>
              {displayName} · {type.toUpperCase()}
            </dd>
            <dt>{type === 'oidc' ? 'Discovery' : 'Metadata'}</dt>
            <dd className="mono truncate">{type === 'oidc' ? discoveryUrl : metadataMode === 'url' ? metadataUrl : 'pasted XML'}</dd>
            <dt>Default roles</dt>
            <dd>{defaultRoles.map(roleLabel).join(', ')}</dd>
          </dl>
          <Checkbox label="I will test the connection and verify a domain before enforcing it" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        </div>
      )}

      <div className="dialog-actions" style={{ marginTop: 18 }}>
        {step > 0 ? (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        )}
        {step < 3 ? (
          <Button variant="primary" disabled={(step === 0 && displayName.trim().length < 2) || (step === 1 && !providerValid)} onClick={() => setStep(step + 1)}>
            Next
          </Button>
        ) : (
          <Button variant="primary" disabled={!ack} loading={create.isPending} onClick={submit}>
            Create connection
          </Button>
        )}
      </div>
      {step === 1 && !providerValid && (discoveryUrl || metadataUrl || metadataXml) && (
        <p className="xs subtle" style={{ marginTop: 8 }}>
          <Tooltip content="The discovery URL must be a real .well-known document, with client id and secret filled in.">
            <span>Fill in the provider details to continue.</span>
          </Tooltip>
        </p>
      )}
    </Dialog>
  );
}
