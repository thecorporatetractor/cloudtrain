import { useEffect, useState } from 'react';
import { useOrgSettings, useUpdateSettings } from '@/api/platform';
import { RequireAccess } from '@/app/access';
import { initials } from '@/app/Shell';
import { useShell } from '@/app/shell-context';
import { Button, Card, ErrorState, Field, Input, PageSkeleton, Select, Switch } from '@/components/ui';

export function AdminSettings() {
  return (
    <RequireAccess path="/admin/settings">
      <Screen />
    </RequireAccess>
  );
}

const TIMEZONES = ['Europe/Amsterdam', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

function Screen() {
  const q = useOrgSettings();
  const update = useUpdateSettings();
  const { toast } = useShell();
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [tz, setTz] = useState('UTC');
  const [local, setLocal] = useState(true);
  const [logo, setLogo] = useState('');
  useEffect(() => {
    const o = q.data?.org;
    if (o) {
      setName(o.name);
      setMinutes(o.settings.defaultSessionMinutes);
      setTz(o.settings.timezone);
      setLocal(o.settings.allowLocalLogin);
      setLogo(o.settings.logoUrl ?? '');
    }
  }, [q.data]);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data.org;
  const dirty = name !== o.name || minutes !== o.settings.defaultSessionMinutes || tz !== o.settings.timezone || local !== o.settings.allowLocalLogin || (logo || undefined) !== o.settings.logoUrl;

  return (
    <form
      className="grid-2"
      style={{ gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 5fr)', gap: 20, alignItems: 'start' }}
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({ name: name.trim(), settings: { defaultSessionMinutes: minutes, timezone: tz, allowLocalLogin: local, logoUrl: logo || undefined } }, { onSuccess: () => toast({ title: 'Settings saved', tone: 'ok' }), onError: (err) => toast({ title: 'Could not save', description: err.message, tone: 'err' }) });
      }}
    >
      <div className="stack" style={{ gap: 20 }}>
        <Card className="stack" style={{ gap: 16 }}>
          <h2>Organisation</h2>
          <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
            <span className="org-logo" aria-hidden>
              {logo ? <img src={logo} alt="" /> : initials(name)}
            </span>
            <div className="stack grow" style={{ gap: 12 }}>
              <Field label="Name" required>
                {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
              </Field>
              <Field label="Logo URL" hint="Square, at least 128 px. Shown in the sign-in page and the navigation.">
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" />}
              </Field>
            </div>
          </div>
          <dl className="summary-list">
            <dt>Slug</dt>
            <dd className="mono">{o.slug}</dd>
            <dt>Created</dt>
            <dd>{new Date(o.createdAt).toLocaleDateString()}</dd>
            <dt>Domains</dt>
            <dd>{o.domains.map((d) => `${d.domain}${d.verified ? '' : ' (unverified)'}`).join(', ') || '—'}</dd>
          </dl>
        </Card>
        <Card className="stack" style={{ gap: 16 }}>
          <h2>Labs</h2>
          <div className="grid-2" style={{ gap: 12 }}>
            <Field label="Default session length" hint="Minutes a new lab session gets before it expires; capped by the quota.">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={15} step={15} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 60)} />}
            </Field>
            <Field label="Timezone" hint="For due dates and reports.">
              {({ id, describedBy }) => (
                <Select id={id} aria-describedby={describedBy} value={tz} onChange={(e) => setTz(e.target.value)}>
                  {[...new Set([tz, ...TIMEZONES])].map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </Card>
        <Card className="stack" style={{ gap: 12 }}>
          <h2>Sign-in</h2>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <Switch label="Allow CloudTrain passwords" checked={local} onCheckedChange={setLocal} />
            <span className="small muted">Allow password sign-in for domains without an enforced SSO connection. Switch this off once everyone comes through the identity provider.</span>
          </div>
        </Card>
      </div>
      <Card className="stack" style={{ gap: 12, position: 'sticky', top: 24 }}>
        <h2>Save</h2>
        <p className="small muted">Changes apply to everyone in {o.name} immediately and are written to the audit log.</p>
        <div className="row" style={{ gap: 8 }}>
          <Button type="submit" variant="primary" disabled={!dirty || name.trim().length < 2} loading={update.isPending}>
            Save settings
          </Button>
          <Button type="button" variant="ghost" disabled={!dirty} onClick={() => (setName(o.name), setMinutes(o.settings.defaultSessionMinutes), setTz(o.settings.timezone), setLocal(o.settings.allowLocalLogin), setLogo(o.settings.logoUrl ?? ''))}>
            Discard
          </Button>
        </div>
      </Card>
    </form>
  );
}
