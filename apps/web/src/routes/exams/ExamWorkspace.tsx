import { Link, useNavigate } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, Flag, Loader2, Lock, Plus, Send, TerminalSquare } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel, Separator } from 'react-resizable-panels';
import { PersistedGroup } from '@/components/ui/panels';
import { useAttempt, useFlagTask, useSubmitExam } from '@/api/exams';
import type { ExamAttemptState, ExamTaskView, ExamTerminalTarget } from '@/api/types';
import { ExamTerminal } from '@/components/exams/ExamTerminal';
import { Disclaimer, ExamTimer, PhaseBadge, useServerClock } from '@/components/exams/ui';
import { Prose } from '@/components/prose';
import { Badge, Button, Dialog, ErrorState, Meter, Skeleton, Tooltip } from '@/components/ui';
import { examAttemptRoute } from '@/router';
import { cn } from '@/lib/utils';
import { RequireAccess } from '@/app/access';

/** Tasks the candidate has opened, per attempt (navigator aid only; survives a reload). */
function useVisited(attemptId: string) {
  const key = `ct.exam.visited.${attemptId}`;
  const [visited, setVisited] = useState<Set<number>>(() => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(key) ?? '[]') as number[]);
    } catch {
      return new Set();
    }
  });
  const visit = (i: number) =>
    setVisited((v) => {
      if (v.has(i)) return v;
      const n = new Set(v).add(i);
      try {
        sessionStorage.setItem(key, JSON.stringify([...n]));
      } catch {
        /* private mode */
      }
      return n;
    });
  return { visited, visit };
}

function Navigator({ tasks, current, visited, onSelect }: { tasks: ExamTaskView[]; current: number; visited: Set<number>; onSelect: (i: number) => void }) {
  const flagged = tasks.filter((t) => t.flagged).length;
  return (
    <nav className="exam-nav" aria-label="Tasks">
      {tasks.map((t) => (
        <Tooltip key={t.index} content={`${t.index}. ${t.title}${t.flagged ? ' (flagged)' : ''}`}>
          <button
            className={cn('exam-nav-item', t.index === current && 'is-current', visited.has(t.index) && 'is-visited', t.flagged && 'is-flagged')}
            aria-current={t.index === current ? 'step' : undefined}
            aria-label={`Task ${t.index}${t.flagged ? ', flagged' : ''}${visited.has(t.index) ? ', opened' : ''}`}
            onClick={() => onSelect(t.index)}
          >
            {t.index}
            {t.flagged && <Flag size={10} className="exam-nav-flag" aria-hidden />}
          </button>
        </Tooltip>
      ))}
      <span className="exam-nav-legend xs subtle">
        <span>{visited.size}/{tasks.length} opened</span>
        <span className="row" style={{ gap: 4 }}>
          <Flag size={11} className="text-warn" /> {flagged} flagged
        </span>
      </span>
    </nav>
  );
}

function TaskPane({ task, total, flagEnabled, onFlag, onMove, flagging }: { task: ExamTaskView; total: number; flagEnabled: boolean; onFlag: (f: boolean) => void; onMove: (d: -1 | 1) => void; flagging: boolean }) {
  return (
    <div className="exam-task">
      <div className="exam-task-head">
        <div>
          <div className="exam-task-num">
            Task {task.index} of {total}
          </div>
          <h2 className="exam-task-title">{task.title}</h2>
        </div>
        {flagEnabled && (
          <Button variant={task.flagged ? 'secondary' : 'ghost'} size="sm" icon={<Flag size={13} className={task.flagged ? 'text-warn' : undefined} />} aria-pressed={task.flagged} loading={flagging} onClick={() => onFlag(!task.flagged)}>
            {task.flagged ? 'Flagged' : 'Flag for review'}
          </Button>
        )}
      </div>
      <div className="exam-task-meta">
        <Badge tone="outline" title={task.objective}>
          {task.objectiveName ?? task.objective}
        </Badge>
        <Badge className="tnum">{task.weight}% of the score</Badge>
        {task.contexts.map((c) => (
          <Badge key={c} tone="accent" className="mono">
            {c}
          </Badge>
        ))}
      </div>
      <Prose text={task.statement} />
      <div className="exam-task-pager">
        <Button variant="secondary" size="sm" icon={<ArrowLeft size={13} />} disabled={task.index <= 1} onClick={() => onMove(-1)}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={task.index >= total} onClick={() => onMove(1)}>
          Next <ArrowRight size={13} />
        </Button>
      </div>
    </div>
  );
}

interface Tab {
  key: string;
  target: ExamTerminalTarget;
  n: number;
}

function Terminals({ attempt, closed }: { attempt: ExamAttemptState; closed: boolean }) {
  const entry = attempt.terminals.find((t) => t.entry) ?? attempt.terminals[0];
  const [tabs, setTabs] = useState<Tab[]>(() => (entry ? [{ key: `${entry.id}#1`, target: entry, n: 1 }] : []));
  const [active, setActive] = useState(tabs[0]?.key ?? '');
  const contexts = useMemo(() => Array.from(new Set(attempt.tasks.flatMap((t) => t.contexts))), [attempt.tasks]);
  const hosts = useMemo(() => Array.from(new Set(attempt.terminals.map((t) => t.node))), [attempt.terminals]);
  const open = (target: ExamTerminalTarget) => {
    const n = Math.max(0, ...tabs.filter((t) => t.target.id === target.id).map((t) => t.n)) + 1;
    const tab = { key: `${target.id}#${n}`, target, n };
    setTabs((t) => [...t, tab]);
    setActive(tab.key);
  };
  return (
    <div className="exam-terms">
      <div className="exam-terms-tabs" role="tablist" aria-label="Terminals">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={t.key === active} className={cn('exam-terms-tab', t.key === active && 'is-active')} onClick={() => setActive(t.key)}>
            <TerminalSquare size={12} /> <span className="mono">{t.target.node}</span>
            {t.n > 1 && <span className="subtle">{t.n}</span>}
          </button>
        ))}
        {!closed &&
          attempt.terminals.map((target) => (
            <Tooltip key={target.id} content={`New terminal: ${target.label}`}>
              <button className="exam-terms-tab" aria-label={`New terminal on ${target.node}`} onClick={() => open(target)}>
                <Plus size={12} /> {attempt.terminals.length > 1 ? <span className="mono">{target.node}</span> : null}
              </button>
            </Tooltip>
          ))}
        <span className="grow" />
        {entry && <span className="xs subtle" style={{ alignSelf: 'center', paddingRight: 6 }}>{entry.label}</span>}
      </div>
      <div className="exam-terms-body">
        {tabs.map((t) => (
          <ExamTerminal key={t.key} attemptId={attempt.id} target={t.target} active={t.key === active} contexts={contexts} hosts={hosts} closed={closed} />
        ))}
        {tabs.length === 0 && <div className="exam-state small subtle">No terminal is available.</div>}
      </div>
    </div>
  );
}

function StateCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="exam-state" role="status" aria-live="polite">
      <div className="exam-state-card">{children}</div>
    </div>
  );
}

function ExamWorkspaceScreen() {
  const { attemptId } = examAttemptRoute.useParams();
  const attempt = useAttempt(attemptId);
  const flag = useFlagTask(attemptId);
  const submit = useSubmitExam(attemptId);
  const navigate = useNavigate();
  const now = useServerClock(attempt.data?.serverTime);
  const { visited, visit } = useVisited(attemptId);
  const [current, setCurrent] = useState(1);
  const [confirm, setConfirm] = useState(false);
  const autoSubmitted = useRef(false);

  const a = attempt.data;
  const timeUp = !!a?.deadline && a.phase === 'in-progress' && now >= Date.parse(a.deadline);

  useEffect(() => {
    if (a?.phase === 'in-progress' && a.tasks.length) visit(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, a?.phase, a?.tasks.length]);

  // Auto-submit at time-out (the orchestrator freezes and grades at the deadline anyway).
  useEffect(() => {
    if (timeUp && !autoSubmitted.current) {
      autoSubmitted.current = true;
      submit.mutate();
    }
  }, [timeUp, submit]);

  if (attempt.isPending) {
    return (
      <div className="exam-ws">
        <div className="exam-ws-header">
          <Skeleton w={320} h={16} />
        </div>
        <div className="exam-ws-body" style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 1 }}>
          <Skeleton h="100%" style={{ borderRadius: 0 }} />
          <Skeleton h="100%" style={{ borderRadius: 0 }} />
        </div>
      </div>
    );
  }
  if (attempt.isError || !a) {
    return (
      <div className="page page-narrow">
        <ErrorState title="Attempt unavailable" error={attempt.error} onRetry={() => void attempt.refetch()} />
      </div>
    );
  }

  const task = a.tasks.find((t) => t.index === current) ?? a.tasks[0];
  const flaggedTasks = a.tasks.filter((t) => t.flagged);
  const unopened = a.tasks.filter((t) => !visited.has(t.index));
  const closed = a.phase !== 'in-progress' || timeUp;

  const header = (
    <header className="exam-ws-header">
      <div className="row" style={{ gap: 10, minWidth: 0 }}>
        <Tooltip content={a.phase === 'in-progress' ? 'Leave (the timer keeps running)' : 'Back to the exam'}>
          <Link to="/exams/$examId" params={{ examId: a.examId }} className="btn btn-ghost btn-sm btn-icon" aria-label="Back to the exam page">
            <ChevronLeft size={15} />
          </Link>
        </Tooltip>
        <h1 className="exam-ws-title truncate">{a.examTitle}</h1>
        <PhaseBadge phase={a.phase} />
        <span className="xs subtle">Attempt {a.number}</span>
      </div>
      <div className="row" style={{ gap: 10 }}>
        <ExamTimer deadline={a.deadline} now={now} durationMinutes={a.durationMinutes} />
        {a.phase === 'in-progress' && (
          <Button variant="primary" size="sm" icon={<Send size={13} />} disabled={timeUp} loading={submit.isPending} onClick={() => setConfirm(true)}>
            Submit exam
          </Button>
        )}
      </div>
    </header>
  );

  if (a.phase === 'preparing') {
    return (
      <div className="exam-ws">
        {header}
        <StateCard>
          <div className="row" style={{ gap: 8 }}>
            <Loader2 size={16} className="spin subtle" aria-hidden />
            <h2>Preparing your exam environment</h2>
          </div>
          <p className="small muted">{a.message}</p>
          <Meter value={a.preparingProgress ?? 0} label="Environment readiness" />
          <ul className="stack small muted" style={{ gap: 4, paddingLeft: 18, margin: 0 }}>
            <li>{a.durationMinutes} minutes start counting once the environment is ready; you do not lose time now.</li>
            <li>No hints and no validate button: everything is graded once, at the end.</li>
            {a.rules.docsAllowed && <li>Documentation: {a.rules.docsAllowed}.</li>}
          </ul>
          <Disclaimer text={a.disclaimer} />
        </StateCard>
      </div>
    );
  }

  if (a.phase === 'failed') {
    return (
      <div className="exam-ws">
        {header}
        <StateCard>
          <div className="row" style={{ gap: 8 }}>
            <AlertTriangle size={16} className="text-warn" />
            <h2>This attempt could not run</h2>
          </div>
          <p className="small muted">{a.message}</p>
          <div className="row" style={{ gap: 8 }}>
            <Link to="/exams/$examId" params={{ examId: a.examId }} className="btn btn-primary btn-sm">
              Back to the exam
            </Link>
          </div>
        </StateCard>
      </div>
    );
  }

  if (a.phase === 'grading' || a.phase === 'completed') {
    return (
      <div className="exam-ws">
        {header}
        <StateCard>
          <div className="row" style={{ gap: 8 }}>
            {a.phase === 'grading' ? <Loader2 size={16} className="spin subtle" aria-hidden /> : <CheckCircle2 size={16} className="text-ok" />}
            <h2>{a.phase === 'grading' ? (a.submittedAt ? 'Submitted. Grading your work' : 'Time is up. Grading your work') : 'Your exam has been graded'}</h2>
          </div>
          <p className="small muted">{a.message}</p>
          {a.phase === 'grading' && (
            <ul className="stack small muted" style={{ gap: 4, paddingLeft: 18, margin: 0 }}>
              <li className="row" style={{ gap: 6 }}>
                <Lock size={12} /> The environment is closed; your terminals were disconnected.
              </li>
              {a.rules.idempotencyRerun && <li>Your saved automation is being run again.</li>}
              {a.rules.rebootBeforeGrade && <li>Machines are being rebooted before the final grading pass.</li>}
            </ul>
          )}
          {a.phase === 'completed' && (
            <div className="row" style={{ gap: 8 }}>
              <Button variant="primary" onClick={() => void navigate({ to: '/exams/attempts/$attemptId/results', params: { attemptId } })}>
                View results <ArrowRight size={13} />
              </Button>
            </div>
          )}
        </StateCard>
      </div>
    );
  }

  return (
    <div className="exam-ws">
      {header}
      <Navigator tasks={a.tasks} current={task?.index ?? 1} visited={visited} onSelect={setCurrent} />
      <div className="exam-ws-body">
        <PersistedGroup orientation="horizontal" storageId="ct.exam.h">
          <Panel id="task" minSize="22%" defaultSize="34%" maxSize="55%">
            {task && (
              <TaskPane
                task={task}
                total={a.tasks.length}
                flagEnabled={a.rules.flagForReview}
                flagging={flag.isPending && flag.variables?.index === task.index}
                onFlag={(f) => flag.mutate({ index: task.index, flagged: f })}
                onMove={(d) => setCurrent((c) => Math.min(a.tasks.length, Math.max(1, c + d)))}
              />
            )}
          </Panel>
          <Separator className="splitter splitter-v" />
          <Panel id="terminals" minSize="35%" style={{ position: 'relative' }}>
            <Terminals attempt={a} closed={closed} />
            {timeUp && (
              <div className="exam-overlay" role="alertdialog" aria-label="Time is up">
                <div className="exam-state-card">
                  <div className="row" style={{ gap: 8 }}>
                    <Lock size={16} />
                    <h2>Time is up</h2>
                  </div>
                  <p className="small muted">Your work has been submitted automatically and the environment is closing. Grading starts in a moment.</p>
                  <Loader2 size={16} className="spin subtle" aria-hidden />
                </div>
              </div>
            )}
          </Panel>
        </PersistedGroup>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm} title="Submit your exam?" description="Submitting ends the exam for good: the environment closes and your work is graded. You cannot come back to it.">
        <div className="stack" style={{ gap: 10 }}>
          {flaggedTasks.length > 0 && (
            <p className="small row" style={{ gap: 6 }}>
              <Flag size={13} className="text-warn" /> {flaggedTasks.length} flagged for review: {flaggedTasks.map((t) => t.index).join(', ')}
            </p>
          )}
          {unopened.length > 0 && (
            <p className="small row" style={{ gap: 6 }}>
              <AlertTriangle size={13} className="text-warn" /> {unopened.length} not opened yet: {unopened.map((t) => t.index).join(', ')}
            </p>
          )}
          {a.deadline && (
            <p className="small muted">
              Time left: <ExamTimer deadline={a.deadline} now={now} durationMinutes={a.durationMinutes} />
            </p>
          )}
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep working
            </Button>
            <Button
              variant="danger"
              icon={<Send size={13} />}
              loading={submit.isPending}
              onClick={() =>
                submit.mutate(undefined, {
                  onSuccess: () => setConfirm(false),
                })
              }
            >
              Submit and end the exam
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/** Exam screens need lab.run (ROUTE_ACCESS '/exams'); the gateway enforces it too. */
export function ExamWorkspace() {
  return (
    <RequireAccess path="/exams">
      <ExamWorkspaceScreen />
    </RequireAccess>
  );
}
