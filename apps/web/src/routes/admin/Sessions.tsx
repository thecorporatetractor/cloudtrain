import { Link } from '@tanstack/react-router';
import { Eye, MonitorPlay, Power } from 'lucide-react';
import { useState } from 'react';
import { useMe } from '@/api/client';
import { useLiveSessions, useSessionControl } from '@/api/platform';
import type { LiveSession } from '@/api/types';
import { RequireAccess, can } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { Bar } from '@/components/charts';
import { ObservedBy, PhaseBadge, UserCell, When } from '@/components/platform';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, Stat, TableSkeleton, TableWrap } from '@/components/ui';

export function AdminSessions() {
  return (
    <RequireAccess path="/admin/sessions">
      <Screen />
    </RequireAccess>
  );
}

function Screen() {
  const q = useLiveSessions();
  const me = useMe().data;
  const control = useSessionControl();
  const { toast } = useShell();
  const [target, setTarget] = useState<LiveSession | null>(null);
  const observeFrom = me?.instructedCohorts[0]?.id;

  if (q.isPending) return <TableSkeleton cols={7} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const sessions = q.data;
  const byPhase = (p: string) => sessions.filter((s) => s.phase === p).length;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="stat-row">
        <Stat label="Running" value={sessions.length} hint="across the organisation" />
        <Stat label="Working" value={byPhase('ready')} />
        <Stat label="Provisioning" value={byPhase('provisioning') + byPhase('pending')} />
        <Stat label="Idle" value={byPhase('hibernated')} hint="hibernated" />
        <Stat label="Observed" value={sessions.filter((s) => s.observedBy.length).length} />
      </div>
      {sessions.length === 0 ? (
        <EmptyState icon={<MonitorPlay size={20} />} title="No running sessions" description="Live lab environments across the organisation show up here as soon as someone starts one." />
      ) : (
        <Card className="card-flush">
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Learner</th>
                  <th scope="col">Lab</th>
                  <th scope="col">Phase</th>
                  <th scope="col">Started</th>
                  <th scope="col">Ends</th>
                  <th scope="col" style={{ width: 140 }}>
                    Checks
                  </th>
                  <th scope="col">Observers</th>
                  <th scope="col" className="sr-only">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <UserCell user={s.user} sub={s.user.title} size="sm" />
                    </td>
                    <td className="small">
                      <span className="truncate" style={{ display: 'block', maxWidth: 260 }}>
                        {s.labTitle}
                      </span>
                      <span className="xs subtle mono">{s.id}</span>
                    </td>
                    <td>
                      <PhaseBadge phase={s.phase} />
                    </td>
                    <td className="small">
                      <When iso={s.startedAt} />
                    </td>
                    <td className="small tnum">{s.expiresAt ? new Date(s.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <Bar value={s.checksTotal ? s.checksPassed / s.checksTotal : 0} thin />
                        <span className="xs tnum" style={{ width: 28, textAlign: 'right' }}>
                          {s.checksPassed}/{s.checksTotal}
                        </span>
                      </div>
                    </td>
                    <td>
                      <ObservedBy users={s.observedBy} />
                      {!s.observedBy.length && <span className="xs subtle">—</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        {can(me, 'session.observe') && observeFrom && (s.phase === 'ready' || s.phase === 'grading') && (
                          <Link to="/cohorts/$cohortId/observe/$sessionId" params={{ cohortId: observeFrom, sessionId: s.id }} className="btn btn-ghost btn-sm">
                            <Eye size={12} /> Observe
                          </Link>
                        )}
                        <Button variant="danger" size="sm" icon={<Power size={12} />} onClick={() => setTarget(s)}>
                          Terminate
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={`Terminate ${target?.user.name}'s session?`}
        description={`“${target?.labTitle}” is deleted immediately. The learner is sent back to the lab overview and the attempt is saved as abandoned with the score so far (${target?.score ?? 0}). This is written to the audit log.`}
        confirmLabel="Terminate"
        danger
        loading={control.isPending}
        onConfirm={() => target && control.mutate({ sessionId: target.id, action: 'terminate' }, { onSuccess: () => (setTarget(null), toast({ title: 'Session terminated', description: target.user.name, tone: 'warn' })), onError: (e) => toast({ title: 'Could not terminate', description: e.message, tone: 'err' }) })}
      />
    </div>
  );
}
