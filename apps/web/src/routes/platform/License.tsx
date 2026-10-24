import { AlertTriangle, CheckCircle2, KeyRound, Lock, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { ApiError } from '@/api/client';
import { useLicense, useLicenseActions } from '@/api/license';
import type { LicenseState, LicenseStatus } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { Badge, Button, Card, ConfirmDialog, ErrorState, Field, Meter, PageSkeleton, Stat, TableWrap, Textarea } from '@/components/ui';

export function PlatformLicense() {
  return (
    <RequireAccess path="/platform/license">
      <Screen />
    </RequireAccess>
  );
}

const STATE: Record<LicenseState, { label: string; tone: 'ok' | 'warn' | 'err' | 'neutral' | 'accent' }> = {
  none: { label: 'Community edition', tone: 'neutral' },
  valid: { label: 'Licensed', tone: 'ok' },
  expiring: { label: 'Expiring soon', tone: 'warn' },
  grace: { label: 'Expired, in grace period', tone: 'warn' },
  expired: { label: 'Expired', tone: 'err' },
  not_yet_valid: { label: 'Not yet valid', tone: 'warn' },
  invalid: { label: 'Invalid', tone: 'err' },
  ignored: { label: 'Not used (hosted)', tone: 'neutral' },
};

const SOURCE: Record<LicenseStatus['source'], string> = {
  env: 'CT_LICENSE_KEY',
  file: 'CT_LICENSE_FILE',
  upload: 'Uploaded here',
  dev: 'CT_DEV_LICENSE (development)',
  none: 'None',
};

const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : '');

function Screen() {
  const q = useLicense();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const meta = s.source === 'dev' ? { label: 'Development license', tone: 'accent' as const } : STATE[s.state];
  const l = s.license;
  const available = s.catalog.filter((f) => f.status === 'available').map((f) => f.id);
  const warn = ['expiring', 'grace', 'expired', 'invalid', 'not_yet_valid'].includes(s.state) || s.seats.over;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className={warn ? 'callout row' : 'row'} style={{ gap: 10, alignItems: 'flex-start' }}>
        {warn ? <AlertTriangle size={14} className="text-warn" style={{ marginTop: 3 }} /> : <ShieldCheck size={14} className="subtle" style={{ marginTop: 3 }} />}
        <span className="small">
          <Badge tone={meta.tone}>{meta.label}</Badge> {s.message}
        </span>
      </div>

      <div className="stat-row">
        <Stat label="Edition" value={s.edition === 'hosted' ? 'Hosted' : 'Self-hosted'} hint={l ? `${l.edition} license` : 'no license'} />
        <Stat label="Valid until" value={l ? day(l.expiresAt) : '—'} hint={s.daysLeft !== undefined && l ? (s.daysLeft >= 0 ? `${s.daysLeft} days left` : `grace until ${day(s.graceEndsAt)}`) : undefined} tone={s.state === 'expired' || s.state === 'invalid' ? 'err' : s.state === 'expiring' || s.state === 'grace' ? 'warn' : undefined} />
        <Stat label="Premium features" value={`${available.filter((f) => s.activeFeatures.includes(f)).length}/${available.length}`} hint="in force now" />
        <Stat label="Active members" value={s.seats.licensed ? `${s.seats.used}/${s.seats.licensed}` : s.seats.used} hint={s.seats.licensed ? 'licensed seats' : 'no seat limit'} tone={s.seats.over ? 'warn' : undefined} />
      </div>

      <div className="split split-7-5" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 20 }}>
          <Card className="card-flush">
            <div className="card-head">
              <h2 className="row" style={{ gap: 8 }}>
                <KeyRound size={14} className="subtle" /> Premium features
              </h2>
            </div>
            <TableWrap compact>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    <th scope="col">What it covers</th>
                    <th scope="col" style={{ width: 96 }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.catalog.map((f) => {
                    const on = s.activeFeatures.includes(f.id);
                    return (
                      <tr key={f.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{f.name}</div>
                          <div className="mono subtle small">{f.id}</div>
                        </td>
                        <td className="small muted">{f.description}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {f.status === 'reserved' ? (
                            <Badge tone="outline" title={on ? 'Licensed; not built yet' : 'Not built yet'}>
                              Reserved
                            </Badge>
                          ) : on ? (
                            <Badge tone="ok">
                              <CheckCircle2 size={11} /> On
                            </Badge>
                          ) : (
                            <Badge>
                              <Lock size={11} /> Off
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </Card>
          <p className="small muted">
            Every lab, local accounts, teams, assignments, cohorts, exam simulations and the basic dashboards are part of the community edition and always on. When a license lapses, premium features switch off after the grace period; nothing is deleted.
          </p>
        </div>

        <div className="stack" style={{ gap: 20 }}>
          {l && (
            <Card>
              <h2 style={{ marginBottom: 10 }}>
                License
              </h2>
              <dl className="summary-list">
                <dt>Licensee</dt>
                <dd>
                  {l.licensee.name}
                  {l.licensee.email ? <div className="muted small">{l.licensee.email}</div> : null}
                </dd>
                <dt>License id</dt>
                <dd className="mono">{l.licenseId}</dd>
                <dt>Valid</dt>
                <dd>
                  {day(l.notBefore)} to {day(l.expiresAt)}
                </dd>
                <dt>Grace period</dt>
                <dd>
                  {s.graceDays} days, until {day(s.graceEndsAt)}
                </dd>
                <dt>Seats</dt>
                <dd>{l.seats || 'Unlimited'}</dd>
                <dt>Signing key</dt>
                <dd className="mono">{l.kid}</dd>
                <dt>Source</dt>
                <dd>
                  {SOURCE[s.source]}
                  {s.installedBy ? <span className="muted"> · by {s.installedBy}</span> : null}
                  {s.installedAt ? <span className="muted"> · {day(s.installedAt)}</span> : null}
                </dd>
              </dl>
              {s.seats.licensed > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Meter value={Math.min(1, s.seats.used / s.seats.licensed)} tone={s.seats.over ? 'warn' : 'accent'} label={`${s.seats.used} of ${s.seats.licensed} seats`} />
                </div>
              )}
            </Card>
          )}
          {s.error && (
            <div className="callout row" style={{ gap: 10 }}>
              <AlertTriangle size={14} className="text-err" />
              <span className="small">{s.error}</span>
            </div>
          )}
          <InstallCard status={s} />
          <Card>
            <h2 style={{ marginBottom: 8 }}>
              Accepted signing keys
            </h2>
            <ul className="stack small" style={{ gap: 4, margin: 0, paddingLeft: 16 }}>
              {s.keys.map((k) => (
                <li key={k.kid}>
                  <span className="mono">{k.kid}</span>
                  {k.label ? <span className="muted"> · {k.label}</span> : null}
                  {k.retiredAt ? <span className="text-warn"> · retired {day(k.retiredAt)}</span> : null}
                </li>
              ))}
            </ul>
            <p className="small muted" style={{ marginTop: 8 }}>
              Verified offline against these public keys; this server never contacts CloudTrain about its license.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function InstallCard({ status: s }: { status: LicenseStatus }) {
  const { install, remove } = useLicenseActions();
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const err = install.error instanceof ApiError ? install.error.message : install.error ? 'Could not install the license.' : undefined;

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    void f.text().then(setText);
    e.target.value = '';
  };

  if (!s.uploadAllowed) {
    return (
      <Card>
        <h2 style={{ marginBottom: 6 }}>
          Install a license
        </h2>
        <p className="small muted">
          {s.source === 'none' ? 'Uploading needs the platform database.' : `This gateway reads its license from ${SOURCE[s.source]}; change it there and restart. The environment always wins over an upload.`}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 style={{ marginBottom: 10 }}>
        {s.license ? 'Replace the license' : 'Install a license'}
      </h2>
      <form
        className="stack"
        style={{ gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          install.mutate(text, { onSuccess: () => setText('') });
        }}
      >
        <Field label="License key" hint="Paste the license file or token you received. It is verified here, offline." error={err}>
          {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} rows={5} className="mono small" value={text} onChange={(e) => setText(e.target.value)} placeholder="# CloudTrain license key …" spellCheck={false} />}
        </Field>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button type="submit" variant="primary" icon={<KeyRound size={14} />} loading={install.isPending} disabled={!text.trim()}>
            Install
          </Button>
          <Button type="button" variant="ghost" icon={<Upload size={14} />} onClick={() => file.current?.click()}>
            Choose file
          </Button>
          <input ref={file} type="file" accept=".txt,.lic,.license,text/plain" hidden onChange={onFile} />
          {s.source === 'upload' && (
            <Button type="button" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfirm(true)} style={{ marginLeft: 'auto' }}>
              Remove
            </Button>
          )}
        </div>
      </form>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Remove the license?"
        description="This server returns to the community edition: premium features switch off for every organisation. Nothing is deleted, and installing a license turns them back on."
        confirmLabel="Remove license"
        danger
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => setConfirm(false) })}
      />
    </Card>
  );
}
