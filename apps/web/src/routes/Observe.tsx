import { Link, useNavigate } from '@tanstack/react-router';
import { AlertTriangle, ChevronLeft, Eye, Lightbulb, Power, RotateCcw, TimerReset } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLab } from '@/api/client';
import { useCohortBoard, useObserveRegistration, useSessionControl } from '@/api/platform';
import { RequireAccess } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { Bar } from '@/components/charts';
import { PhaseBadge, When } from '@/components/platform';
import { Badge, Button, ConfirmDialog, Dot, ErrorState, PageSkeleton, Tooltip } from '@/components/ui';
import { ObserveTerminal, type ObserveState } from '@/components/workspace/ObserveTerminal';
import { Timer } from '@/components/workspace/Timer';
import { cn } from '@/lib/utils';
import { observeRoute } from '@/router';

export function Observe() {
  return (
    <RequireAccess path="/cohorts">
      <ObserveScreen />
    </RequireAccess>
  );
}

function ObserveScreen() {
  const { cohortId, sessionId } = observeRoute.useParams();
  const navigate = useNavigate();
  const board = useCohortBoard(cohortId, true);
  const row = board.data?.rows.find((r) => r.session?.id === sessionId);
  const lab = useLab(row?.session?.labId ?? '');
  const control = useSessionControl();
  const registration = useObserveRegistration();
  const { toast } = useShell();
  const [state, setState] = useState<ObserveState>('connecting');
  const [detail, setDetail] = useState<string | undefined>();
  const [pending, setPending] = useState<'extend' | 'reset' | 'terminate' | null>(null);

  // Mock mode: tell the mock who is watching so the learner's banner and the board reflect it.
  useEffect(() => {
    void registration.start(sessionId);
    return () => void registration.stop(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (board.isPending) {
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  }
  if (board.isError) {
    return (
      <div className="page">
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      </div>
    );
  }
  if (!row || !row.session) {
    return (
      <div className="page page-narrow">
        <ErrorState title="This session has ended" error="The learner's session is no longer running." />
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <Link to="/cohorts/$cohortId" params={{ cohortId }} className="btn btn-secondary btn-md">
            Back to the board
          </Link>
        </div>
      </div>
    );
  }
  const s = row.session;
  const entry = lab.data?.spec.topology.entry ?? lab.data?.spec.topology.nodes[0]?.name ?? 'workstation';
  const learner = row.user.name.split(' ')[0]!.toLowerCase();

  const run = () => {
    if (!pending) return;
    const action = pending;
    control.mutate(
      { sessionId, action, minutes: 30 },
      {
        onSuccess: () => {
          setPending(null);
          toast({ title: action === 'extend' ? 'Extended by 30 minutes' : action === 'reset' ? 'Environment resetting' : 'Session terminated', tone: action === 'terminate' ? 'warn' : 'ok' });
          if (action === 'terminate') void navigate({ to: '/cohorts/$cohortId', params: { cohortId } });
        },
        onError: (e) => toast({ title: 'Action failed', description: e.message, tone: 'err' }),
      },
    );
  };

  return (
    <div className="ws observe">
      <header className="ws-header observe-header">
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <Tooltip content="Back to the board">
            <Link to="/cohorts/$cohortId" params={{ cohortId }} className="btn btn-ghost btn-sm btn-icon" aria-label="Back to the board">
              <ChevronLeft size={15} />
            </Link>
          </Tooltip>
          <span className="observe-pill">
            <Eye size={13} /> Observing
            <Dot tone={state === 'live' ? 'ok' : state === 'connecting' ? 'warn' : 'neutral'} pulse={state === 'connecting'} />
          </span>
          <h1 className="ws-title truncate">
            {row.user.name} · {s.labTitle}
          </h1>
          <Badge tone="outline">read-only</Badge>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="ws-stat tnum" title="Score">
            <span className="subtle">score</span> {s.score}
          </span>
          <span className="ws-stat tnum" title="Checks passing">
            <span className="subtle">checks</span> {s.checksPassed}/{s.checksTotal}
          </span>
          <Timer startedAt={s.startedAt} deadlineMinutes={s.expiresAt ? Math.round((new Date(s.expiresAt).getTime() - new Date(s.startedAt).getTime()) / 60_000) : 60} />
          <span className="vdivider" style={{ height: 18, margin: '0 4px' }} />
          <Button variant="secondary" size="sm" icon={<TimerReset size={13} />} onClick={() => setPending('extend')}>
            Extend
          </Button>
          <Button variant="secondary" size="sm" icon={<RotateCcw size={13} />} onClick={() => setPending('reset')}>
            Reset
          </Button>
          <Button variant="danger" size="sm" icon={<Power size={13} />} onClick={() => setPending('terminate')}>
            Terminate
          </Button>
        </div>
      </header>

      <div className="observe-banner" role="status">
        <span className="row small" style={{ gap: 8 }}>
          <Eye size={13} />
          <strong>{row.user.name} sees a banner that you are watching.</strong>
          <span className="muted">Keystrokes are not sent; this view and its duration are written to the audit log.</span>
        </span>
        <span className={cn('xs', state === 'error' ? 'text-err' : 'subtle')}>{state === 'connecting' ? 'Connecting to the learner’s terminal…' : state === 'live' ? 'Live' : state === 'ended' ? 'The learner’s shell ended' : (detail ?? 'Unavailable')}</span>
      </div>

      <div className="observe-body">
        <aside className="observe-side">
          <div className="task-h">Session</div>
          <dl className="summary-list">
            <dt>Phase</dt>
            <dd>
              <PhaseBadge phase={s.phase} />
            </dd>
            <dt>Started</dt>
            <dd>
              <When iso={s.startedAt} />
            </dd>
            <dt>On task</dt>
            <dd>{s.minutesOnTask} min</dd>
            <dt>Validates</dt>
            <dd>{s.validations}</dd>
            <dt>Hints</dt>
            <dd className={cn(s.hintsUsed >= 3 && 'text-warn')}>
              <Lightbulb size={11} /> {s.hintsUsed}
            </dd>
          </dl>
          {s.stuck && (
            <div className="observe-stuck">
              <AlertTriangle size={13} className="text-warn" />
              <span className="small">{s.stuckReason ?? 'No progress for a while'}</span>
            </div>
          )}
          <div className="task-h" style={{ marginTop: 18 }}>
            Checks · {s.checksPassed}/{s.checksTotal}
          </div>
          <Bar value={s.checksTotal ? s.checksPassed / s.checksTotal : 0} />
          {lab.data && (
            <ul className="checks" style={{ marginTop: 10 }}>
              {lab.data.spec.checks.map((c, i) => (
                <li key={c.id} className={cn('check', i < s.checksPassed ? 'check-pass' : 'check-fail')}>
                  <div className="check-head" style={{ cursor: 'default' }}>
                    <span className="check-icon" aria-hidden>
                      {i < s.checksPassed ? '✓' : '·'}
                    </span>
                    <span className="check-desc">{c.description}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="xs subtle" style={{ marginTop: 16 }}>
            Node <span className="mono">{entry}</span> · session <span className="mono">{sessionId}</span>
          </p>
        </aside>
        <div className="observe-term">
          <ObserveTerminal
            sessionId={sessionId}
            learner={learner}
            node={entry}
            onState={(st, d) => {
              setState(st);
              setDetail(d);
            }}
          />
        </div>
      </div>

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending === 'extend' ? 'Extend this session by 30 minutes?' : pending === 'reset' ? `Reset ${row.user.name.split(' ')[0]}'s environment?` : `Terminate ${row.user.name.split(' ')[0]}'s session?`}
        description={pending === 'extend' ? 'The deadline moves 30 minutes later; the learner sees the new time.' : pending === 'reset' ? 'The environment is rebuilt from scratch and this terminal reconnects when it is ready. Passed checks stay recorded.' : 'The environment is deleted now and the learner returns to the lab overview. The attempt is saved as abandoned with the score so far.'}
        confirmLabel={pending === 'extend' ? 'Extend 30 min' : pending === 'reset' ? 'Reset environment' : 'Terminate'}
        danger={pending !== 'extend'}
        loading={control.isPending}
        onConfirm={run}
      />
    </div>
  );
}
