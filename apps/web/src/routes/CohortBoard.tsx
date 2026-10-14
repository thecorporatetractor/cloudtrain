import { Link } from '@tanstack/react-router';
import { AlertTriangle, ChevronLeft, Eye, Lightbulb, Megaphone, MoreHorizontal, Power, RefreshCw, RotateCcw, TimerReset } from 'lucide-react';
import { useState } from 'react';
import { useBroadcast, useCohortBoard, useSessionControl } from '@/api/platform';
import type { CohortBoardRow } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { Bar } from '@/components/charts';
import { ObservedBy, OutcomeBadge, PhaseBadge, UserCell, When } from '@/components/platform';
import { Badge, Button, Card, ConfirmDialog, Dialog, Dropdown, EmptyState, ErrorState, Field, PageSkeleton, Segmented, Stat, TableWrap, Textarea, Tooltip } from '@/components/ui';
import { cn, formatDate, relativeTime } from '@/lib/utils';
import { cohortBoardRoute } from '@/router';

export function CohortBoard() {
  return (
    <RequireAccess path="/cohorts">
      <BoardScreen />
    </RequireAccess>
  );
}

type Control = { sessionId: string; who: string; action: 'extend' | 'reset' | 'terminate' } | null;

function BoardScreen() {
  const { cohortId } = cohortBoardRoute.useParams();
  const [live, setLive] = useState(true);
  const q = useCohortBoard(cohortId, live);
  const control = useSessionControl();
  const { toast } = useShell();
  const [pending, setPending] = useState<Control>(null);
  const [broadcast, setBroadcast] = useState(false);

  if (q.isPending) {
    return (
      <div className="page page-wide">
        <PageSkeleton />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="page">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }
  const { cohort, rows } = q.data;
  const active = rows.filter((r) => r.session && r.session.phase !== 'expired' && r.session.phase !== 'failed');
  const stuck = active.filter((r) => r.session?.stuck);
  const observed = active.filter((r) => r.session && r.session.observedBy.length > 0);

  const runControl = () => {
    if (!pending) return;
    const { sessionId, action, who } = pending;
    control.mutate(
      { sessionId, action, minutes: 30 },
      {
        onSuccess: (r) => {
          setPending(null);
          toast({ title: action === 'extend' ? `Extended ${who}'s session by 30 min` : action === 'reset' ? `${who}'s environment is resetting` : `${who}'s session was terminated`, description: r.expiresAt ? `New deadline ${new Date(r.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Recorded in the audit log', tone: action === 'terminate' ? 'warn' : 'ok' });
        },
        onError: (e) => toast({ title: 'Action failed', description: e.message, tone: 'err' }),
      },
    );
  };

  return (
    <div className="page page-wide">
      <Link to="/cohorts" className="link-quiet small" style={{ marginBottom: 14 }}>
        <ChevronLeft size={13} /> Cohorts
      </Link>
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Live board · {formatDate(cohort.startsAt)} – {formatDate(cohort.endsAt)}</div>
          <h1>{cohort.name}</h1>
          <p className="muted">
            {rows.length} learners · {active.length} in a lab right now · {stuck.length} may be stuck · updated {relativeTime(q.data.generatedAt)}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Segmented<'live' | 'paused'> label="Refresh" size="sm" value={live ? 'live' : 'paused'} onChange={(v) => setLive(v === 'live')} options={[{ value: 'live', label: (<span className="row" style={{ gap: 6 }}><RefreshCw size={11} className={cn(q.isFetching && 'spin')} /> Live</span>) }, { value: 'paused', label: 'Paused' }]} />
          <Button variant="secondary" icon={<Megaphone size={14} />} onClick={() => setBroadcast(true)}>
            Broadcast
          </Button>
        </div>
      </header>

      <div className="stat-row" style={{ marginBottom: 20 }}>
        <Stat label="In a lab" value={active.length} hint={`of ${rows.length}`} />
        <Stat label="Stuck" value={stuck.length} tone={stuck.length ? 'warn' : undefined} hint="no progress or many hints" />
        <Stat label="Observed" value={observed.length} hint="shadow terminals open" />
        <Stat label="Path progress" value={`${Math.round((rows.reduce((s, r) => s + r.progress.labsPassed, 0) / Math.max(1, rows.reduce((s, r) => s + r.progress.labsTotal, 0))) * 100)}%`} hint={`${cohort.labIds.length} labs`} />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No learners in this cohort yet" description="Add people from the admin Users page or when creating the cohort." />
      ) : (
        <Card className="card-flush">
          <TableWrap>
            <table className="table board">
              <thead>
                <tr>
                  <th scope="col">Learner</th>
                  <th scope="col">Session</th>
                  <th scope="col">Phase</th>
                  <th scope="col" style={{ width: 150 }}>
                    Checks
                  </th>
                  <th scope="col">On task</th>
                  <th scope="col">Hints</th>
                  <th scope="col">Signal</th>
                  <th scope="col" style={{ width: 120 }}>
                    Path
                  </th>
                  <th scope="col" className="sr-only">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <BoardRow key={r.user.id} r={r} cohortId={cohortId} onControl={(action) => r.session && setPending({ sessionId: r.session.id, who: r.user.name.split(' ')[0]!, action })} />
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.action === 'extend' ? `Extend ${pending.who}'s session by 30 minutes?` : pending?.action === 'reset' ? `Reset ${pending?.who}'s environment?` : `Terminate ${pending?.who}'s session?`}
        description={pending?.action === 'extend' ? 'The deadline moves 30 minutes later. The learner sees the new time in their workspace.' : pending?.action === 'reset' ? 'The lab environment is rebuilt from scratch. Their terminal history and any changes in the environment are lost; checks already passed stay recorded.' : 'The environment is deleted right away and the learner is sent back to the lab overview. Their attempt is saved as abandoned with the score so far.'}
        confirmLabel={pending?.action === 'extend' ? 'Extend 30 min' : pending?.action === 'reset' ? 'Reset environment' : 'Terminate'}
        danger={pending?.action !== 'extend'}
        loading={control.isPending}
        onConfirm={runControl}
      />
      <BroadcastDialog open={broadcast} onOpenChange={setBroadcast} cohortId={cohortId} learners={active.length} />
    </div>
  );
}

function BoardRow({ r, cohortId, onControl }: { r: CohortBoardRow; cohortId: string; onControl: (a: 'extend' | 'reset' | 'terminate') => void }) {
  const s = r.session;
  const canObserve = s && (s.phase === 'ready' || s.phase === 'grading' || s.phase === 'hibernated');
  return (
    <tr className={cn(s?.stuck && 'board-row-stuck')}>
      <td>
        <UserCell user={r.user} sub={r.user.title} size="sm" />
      </td>
      <td className="small">
        {s ? (
          <div className="stack" style={{ gap: 1, minWidth: 0 }}>
            <span className="truncate" style={{ maxWidth: 240 }}>
              {s.labTitle}
            </span>
            <span className="xs subtle">
              started <When iso={s.startedAt} />
              {s.expiresAt ? ` · ends ${new Date(s.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          </div>
        ) : r.lastAttempt ? (
          <div className="stack" style={{ gap: 1 }}>
            <span className="subtle">Not in a lab</span>
            <span className="xs subtle row" style={{ gap: 6 }}>
              last: {r.lastAttempt.labTitle.slice(0, 28)}
              {r.lastAttempt.labTitle.length > 28 ? '…' : ''} <OutcomeBadge outcome={r.lastAttempt.outcome} />
            </span>
          </div>
        ) : (
          <span className="subtle">No activity yet</span>
        )}
      </td>
      <td>{s ? <PhaseBadge phase={s.phase} /> : <span className="subtle xs">—</span>}</td>
      <td>
        {s ? (
          <div className="row" style={{ gap: 8 }}>
            <Bar value={s.checksTotal ? s.checksPassed / s.checksTotal : 0} thin tone={s.checksPassed === s.checksTotal ? 'ok' : 'accent'} />
            <span className="xs tnum" style={{ width: 30, textAlign: 'right' }}>
              {s.checksPassed}/{s.checksTotal}
            </span>
          </div>
        ) : (
          <span className="subtle xs">—</span>
        )}
      </td>
      <td className="small tnum">{s ? `${s.minutesOnTask} min` : '—'}</td>
      <td className="small tnum">
        {s ? (
          <span className={cn('row', s.hintsUsed >= 3 && 'text-warn')} style={{ gap: 4 }}>
            <Lightbulb size={11} /> {s.hintsUsed}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td>
        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {s?.stuck && (
            <Tooltip content={s.stuckReason ?? 'No progress for a while'}>
              <span>
                <Badge tone="warn">
                  <AlertTriangle size={10} /> Stuck
                </Badge>
              </span>
            </Tooltip>
          )}
          {s && <ObservedBy users={s.observedBy} />}
          {s && !s.stuck && s.observedBy.length === 0 && <span className="xs subtle">on track</span>}
        </span>
      </td>
      <td>
        <div className="row" style={{ gap: 8 }}>
          <Bar value={r.progress.labsTotal ? r.progress.labsPassed / r.progress.labsTotal : 0} thin tone="neutral" />
          <span className="xs tnum subtle" style={{ width: 26, textAlign: 'right' }}>
            {r.progress.labsPassed}/{r.progress.labsTotal}
          </span>
        </div>
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {s && (
          <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
            {canObserve ? (
              <Link to="/cohorts/$cohortId/observe/$sessionId" params={{ cohortId, sessionId: s.id }} className="btn btn-secondary btn-sm">
                <Eye size={12} /> Observe
              </Link>
            ) : (
              <Button variant="secondary" size="sm" disabled icon={<Eye size={12} />} title="Available once the environment is ready">
                Observe
              </Button>
            )}
            <Dropdown.Root>
              <Dropdown.Trigger asChild>
                <Button variant="ghost" size="sm" iconOnly aria-label={`Session actions for ${r.user.name}`} icon={<MoreHorizontal size={14} />} />
              </Dropdown.Trigger>
              <Dropdown.Content align="end">
                <Dropdown.Label>Session</Dropdown.Label>
                <Dropdown.Item onSelect={() => onControl('extend')}>
                  <TimerReset size={13} /> Extend 30 min
                </Dropdown.Item>
                <Dropdown.Item onSelect={() => onControl('reset')}>
                  <RotateCcw size={13} /> Reset environment
                </Dropdown.Item>
                <Dropdown.Separator />
                <Dropdown.Item className="menu-item-danger" onSelect={() => onControl('terminate')}>
                  <Power size={13} /> Terminate
                </Dropdown.Item>
              </Dropdown.Content>
            </Dropdown.Root>
          </span>
        )}
      </td>
    </tr>
  );
}

function BroadcastDialog({ open, onOpenChange, cohortId, learners }: { open: boolean; onOpenChange: (o: boolean) => void; cohortId: string; learners: number }) {
  const send = useBroadcast(cohortId);
  const { toast } = useShell();
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState<'info' | 'hint'>('hint');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Broadcast to the cohort" description={`Shown in the workspace of the ${learners} learners currently in a lab, and in the audit log.`}>
      <div className="stack" style={{ gap: 12 }}>
        <Segmented<'info' | 'hint'> label="Kind" size="sm" value={kind} onChange={setKind} options={[{ value: 'hint', label: (<span className="row" style={{ gap: 6 }}><Lightbulb size={11} /> Hint</span>) }, { value: 'info', label: (<span className="row" style={{ gap: 6 }}><Megaphone size={11} /> Announcement</span>) }]} />
        <Field label="Message" required>
          {({ id }) => <Textarea id={id} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={kind === 'hint' ? 'e.g. Remember that a default-deny policy selects every pod with podSelector: {}' : 'e.g. We regroup in the main room at 15:00'} autoFocus />}
        </Field>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={message.trim().length < 3}
            loading={send.isPending}
            onClick={() =>
              send.mutate(
                { message: message.trim(), kind },
                {
                  onSuccess: () => {
                    toast({ title: 'Broadcast sent', description: `${learners} learners`, tone: 'ok' });
                    setMessage('');
                    onOpenChange(false);
                  },
                  onError: (e) => toast({ title: 'Could not send', description: e.message, tone: 'err' }),
                },
              )
            }
          >
            Send
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
