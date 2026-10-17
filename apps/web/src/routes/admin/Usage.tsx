import { useEffect, useState } from 'react';
import { useQuotas, useUpdateQuotas, useUsage } from '@/api/platform';
import type { Quotas } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { Bar, Columns } from '@/components/charts';
import { Button, Card, ErrorState, Field, Input, Meter, PageSkeleton, Segmented, Stat } from '@/components/ui';
import { pct } from '@/lib/utils';

export function AdminUsage() {
  return (
    <RequireAccess path="/admin/usage">
      <Screen />
    </RequireAccess>
  );
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function Screen() {
  const [days, setDays] = useState<'14' | '30' | '90'>('30');
  const range = { from: iso(new Date(Date.now() - (Number(days) - 1) * 86_400_000)), to: iso(new Date()) };
  const q = useUsage(range);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const u = q.data;
  const share = u.quotas.monthlyLabHours ? u.labHoursThisMonth / u.quotas.monthlyLabHours : 0;
  const maxTeam = Math.max(1, ...u.byTeam.map((t) => t.labHours));
  const maxLab = Math.max(1, ...u.byLab.map((l) => l.sessions));
  // Group by week when the range is long, so the columns stay readable.
  const series = Number(days) > 45 ? bucketWeeks(u.byDay) : u.byDay.map((d) => ({ label: d.date.slice(5), value: d.labHours }));

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row-between">
        <div className="stat-row" style={{ marginBottom: 0 }}>
          <Stat label="Lab hours" value={Math.round(u.labHours)} hint={`last ${days} days`} />
          <Stat label="Sessions" value={u.sessions} hint={`${u.activeUsers} active people`} />
          <Stat label="Running now" value={u.concurrentNow} hint={`of ${u.quotas.maxConcurrentSessions}`} />
          <Stat label="Month to date" value={`${pct(share)}`} hint={`${Math.round(u.labHoursThisMonth)} of ${u.quotas.monthlyLabHours} h`} tone={share > 0.85 ? 'warn' : undefined} />
        </div>
        <Segmented<'14' | '30' | '90'> label="Range" size="sm" value={days} onChange={setDays} options={[{ value: '14', label: '14 d' }, { value: '30', label: '30 d' }, { value: '90', label: '90 d' }]} />
      </div>

      <div className="split split-7-5" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 20 }}>
          <Card className="card-flush">
            <div className="card-head">
              <h2>Lab hours</h2>
              <span className="xs subtle">{Number(days) > 45 ? 'per week' : 'per day'}</span>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <Columns values={series} height={160} format={(v) => `${v.toFixed(1)} h`} label="Lab hours over time" />
            </div>
          </Card>
          <div className="grid-2" style={{ gap: 20 }}>
            <Card className="card-flush">
              <div className="card-head">
                <h2>By team</h2>
                <span className="xs subtle">month to date</span>
              </div>
              <ul className="domain-readiness" style={{ padding: '14px 20px 16px' }}>
                {u.byTeam
                  .sort((a, b) => b.labHours - a.labHours)
                  .map((t) => (
                    <li key={t.teamId} className="stack" style={{ gap: 5 }}>
                      <div className="row-between small">
                        <span className="truncate">{t.name}</span>
                        <span className="tnum">{t.labHours.toFixed(1)} h</span>
                      </div>
                      <Bar value={t.labHours / maxTeam} thin />
                    </li>
                  ))}
              </ul>
            </Card>
            <Card className="card-flush">
              <div className="card-head">
                <h2>Most run labs</h2>
                <span className="xs subtle">sessions</span>
              </div>
              <ul className="domain-readiness" style={{ padding: '14px 20px 16px' }}>
                {u.byLab.map((l) => (
                  <li key={l.labId} className="stack" style={{ gap: 5 }}>
                    <div className="row-between small">
                      <span className="truncate" title={l.title}>
                        {l.title}
                      </span>
                      <span className="tnum">{l.sessions}</span>
                    </div>
                    <Bar value={l.sessions / maxLab} thin tone="neutral" />
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
        <QuotaForm current={u.quotas} usedHours={u.labHoursThisMonth} running={u.concurrentNow} />
      </div>
    </div>
  );
}

function bucketWeeks(days: { date: string; labHours: number }[]) {
  const out: { label: string; value: number }[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    out.push({ label: chunk[0]!.date.slice(5), value: Math.round(chunk.reduce((s, d) => s + d.labHours, 0) * 10) / 10 });
  }
  return out;
}

function QuotaForm({ current, usedHours, running }: { current: Quotas; usedHours: number; running: number }) {
  const quotas = useQuotas();
  const update = useUpdateQuotas();
  const { toast } = useShell();
  const [form, setForm] = useState<Quotas>(current);
  useEffect(() => {
    if (quotas.data) setForm(quotas.data);
  }, [quotas.data]);
  const base = quotas.data ?? current;
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const num = (k: keyof Quotas) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: Math.max(0, Number(e.target.value) || 0) }));

  return (
    <Card className="card-flush" style={{ position: 'sticky', top: 24 }}>
      <div className="card-head">
        <h2>Quotas</h2>
        <span className="xs subtle">enforced by the gateway</span>
      </div>
      <form
        className="card-body stack"
        style={{ gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate(form, { onSuccess: () => toast({ title: 'Quotas saved', description: 'Written to the audit log.', tone: 'ok' }), onError: (err) => toast({ title: 'Could not save', description: err.message, tone: 'err' }) });
        }}
      >
        <div className="stack" style={{ gap: 5 }}>
          <div className="row-between small">
            <span>Lab hours this month</span>
            <span className="tnum">
              {Math.round(usedHours)} / {base.monthlyLabHours}
            </span>
          </div>
          <Meter value={base.monthlyLabHours ? usedHours / base.monthlyLabHours : 0} tone={usedHours / Math.max(1, base.monthlyLabHours) > 0.85 ? 'warn' : 'accent'} label="Monthly lab hours used" />
        </div>
        <div className="stack" style={{ gap: 5 }}>
          <div className="row-between small">
            <span>Concurrent sessions now</span>
            <span className="tnum">
              {running} / {base.maxConcurrentSessions}
            </span>
          </div>
          <Meter value={base.maxConcurrentSessions ? running / base.maxConcurrentSessions : 0} label="Concurrent sessions" />
        </div>
        <Field label="Monthly lab hours" hint="New sessions are refused once the month's hours are used; running ones finish.">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={0} value={form.monthlyLabHours} onChange={num('monthlyLabHours')} />}
        </Field>
        <Field label="Max concurrent sessions" hint="Across the whole organisation.">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} value={form.maxConcurrentSessions} onChange={num('maxConcurrentSessions')} />}
        </Field>
        <Field label="Max session length (minutes)" hint="Instructors can extend within this cap.">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={15} step={15} value={form.maxSessionMinutes} onChange={num('maxSessionMinutes')} />}
        </Field>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" disabled={!dirty} onClick={() => setForm(base)}>
            Reset
          </Button>
          <Button variant="primary" type="submit" disabled={!dirty} loading={update.isPending}>
            Save quotas
          </Button>
        </div>
      </form>
    </Card>
  );
}
