import { Link, useNavigate } from '@tanstack/react-router';
import { AlertTriangle, ChevronLeft, Clock, FileText, Play } from 'lucide-react';
import { useState } from 'react';
import { useExam, useStartExam } from '@/api/exams';
import { alignLabel, Disclaimer, ExamDomainIcon, examDomainLabel, RuleChips, ScoreBar } from '@/components/exams/ui';
import { Badge, Button, Card, ErrorState, PageSkeleton, Stat } from '@/components/ui';
import { examDetailRoute } from '@/router';
import { formatMinutes, relativeTime } from '@/lib/utils';
import { AttemptsTable } from '../Exams';

export function ExamDetail() {
  const { examId } = examDetailRoute.useParams();
  const exam = useExam(examId);
  const start = useStartExam(examId);
  const navigate = useNavigate();
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [ack, setAck] = useState(false);

  if (exam.isPending) {
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  }
  if (exam.isError) {
    return (
      <div className="page page-narrow">
        <ErrorState title="Exam unavailable" error={exam.error} onRetry={() => void exam.refetch()} />
      </div>
    );
  }
  const e = exam.data;
  const soon = e.availability !== 'available';
  const active = e.retake.activeAttemptId;
  const allTicked = ticked.size === e.checklist.length && ack;
  const canStart = !soon && e.retake.allowed && allTicked;
  const begin = () =>
    start.mutate(undefined, {
      onSuccess: (a) => void navigate({ to: '/exams/attempts/$attemptId', params: { attemptId: a.id } }),
    });

  return (
    <div className="page">
      <Link to="/exams" search={{}} className="link-quiet small row" style={{ gap: 4, marginBottom: 14, display: 'inline-flex' }}>
        <ChevronLeft size={13} /> Exam simulations
      </Link>
      <header className="page-header" style={{ alignItems: 'flex-start' }}>
        <div style={{ maxWidth: 760 }}>
          <div className="row xs subtle" style={{ gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <span className="row" style={{ gap: 5 }}>
              <ExamDomainIcon domain={e.domain} size={12} /> {examDomainLabel[e.domain]}
            </span>
            {e.alignsTo.map((a) => (
              <Badge key={a} tone="outline">
                {alignLabel(a)}-aligned
              </Badge>
            ))}
            <span className="row" style={{ gap: 4 }}>
              <Clock size={11} /> {formatMinutes(e.durationMinutes)}
            </span>
            {soon && <Badge>Coming soon</Badge>}
          </div>
          <h1>{e.title}</h1>
          <div style={{ marginTop: 10 }}>
            <RuleChips rules={e.rules} environment={e.environment} />
          </div>
        </div>
      </header>

      <div className="grid-home" style={{ gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 5fr)' }}>
        <div className="stack" style={{ gap: 20 }}>
          <Card>
            <div className="grid-3" style={{ gap: 16 }}>
              <Stat label="Tasks" value={e.taskCount} hint={`drawn from ${e.objectives.reduce((a, o) => a + o.poolSize, 0)} in the pools`} />
              <Stat label="Duration" value={formatMinutes(e.durationMinutes)} hint="one timer" />
              <Stat label="Pass mark" value={`${e.passMark}%`} hint="weighted by objective" />
            </div>
            {e.passMarkNote && <p className="xs subtle" style={{ marginTop: 14 }}>{e.passMarkNote}</p>}
            {e.description && <p className="small muted" style={{ marginTop: 12 }}>{e.description}</p>}
            {e.simulationNote && <p className="small muted" style={{ marginTop: 12 }}>{e.simulationNote}</p>}
          </Card>

          <Card className="card-flush">
            <div className="card-head">
              <h2>Blueprint</h2>
              <span className="xs subtle">tasks per attempt and share of the score</span>
            </div>
            <div className="card-body stack" style={{ gap: 14 }}>
              {e.objectives.map((o) => (
                <div key={o.id} className="exam-objective-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="small truncate">{o.name ?? o.id}</div>
                    <div className="xs subtle mono">
                      {o.id} · {o.tasks} of {o.poolSize} tasks
                    </div>
                  </div>
                  <ScoreBar value={o.weight} label={`${o.weight}% of the score`} />
                  <span className="tnum small" style={{ textAlign: 'right' }}>
                    {o.weight}%
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h2 style={{ marginBottom: 10 }}>Rules</h2>
            <ul className="stack small muted" style={{ gap: 6, paddingLeft: 18, margin: 0 }}>
              <li>Hints: none. Validation: none during the exam; every task is graded after the exam ends.</li>
              <li>Order: {e.rules.anyOrder ? 'any order' : 'in order'}{e.rules.flagForReview ? ', with flags for review' : ''}.</li>
              <li>Scoring: {e.rules.partialCredit === 'per-check' ? 'partial credit per check within each task' : 'a task scores only when all its checks pass'}.</li>
              {e.rules.docsAllowed && <li>Documentation: {e.rules.docsAllowed}.</li>}
              {e.rules.rebootBeforeGrade && <li>Machines are rebooted before grading; configuration that does not persist scores zero.</li>}
              {e.rules.idempotencyRerun && <li>Saved automation is re-run after the exam and must report no changes.</li>}
              {e.rules.notes && <li>{e.rules.notes.charAt(0).toUpperCase() + e.rules.notes.slice(1)}</li>}
              <li>
                Retakes: {e.retakePolicy.freeRetakes} free, then a {e.retakePolicy.cooldownHours} hour cooldown; at most {e.retakePolicy.maxAttemptsPer30Days} attempts in 30 days.
                {e.retakePolicy.freshDraw ? ' A retake draws different tasks and new parameters.' : ''}
              </li>
            </ul>
            {e.reportIncludes.length > 0 && (
              <>
                <h3 style={{ marginTop: 16, marginBottom: 8 }} className="row">
                  <FileText size={13} /> Your report includes
                </h3>
                <ul className="stack small muted" style={{ gap: 4, paddingLeft: 18, margin: 0 }}>
                  {e.reportIncludes.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <Card>
            <h2 style={{ marginBottom: 6 }}>{active ? 'Attempt in progress' : 'Before you start'}</h2>
            {active ? (
              <>
                <p className="small muted" style={{ marginBottom: 14 }}>
                  Your attempt is still running. The timer does not stop while you are away.
                </p>
                <Link to="/exams/attempts/$attemptId" params={{ attemptId: active }} className="btn btn-primary btn-lg" style={{ width: '100%' }}>
                  <Play size={14} /> Resume attempt
                </Link>
              </>
            ) : (
              <>
                <p className="xs subtle" style={{ marginBottom: 10 }}>
                  Tick each item to confirm you have read it.
                </p>
                <ul className="exam-checklist">
                  {e.checklist.map((c, i) => (
                    <li key={i}>
                      <label>
                        <input
                          type="checkbox"
                          checked={ticked.has(i)}
                          disabled={soon}
                          onChange={(ev) =>
                            setTicked((s) => {
                              const n = new Set(s);
                              if (ev.target.checked) n.add(i);
                              else n.delete(i);
                              return n;
                            })
                          }
                        />
                        <span>{c}</span>
                      </label>
                    </li>
                  ))}
                  <li>
                    <label>
                      <input type="checkbox" checked={ack} disabled={soon} onChange={(ev) => setAck(ev.target.checked)} />
                      <span>I understand this is a practice simulation: {e.disclaimer.split('. ').slice(-1)[0]}</span>
                    </label>
                  </li>
                </ul>
                {!e.retake.allowed && (
                  <p className="small row text-warn" style={{ gap: 6, marginTop: 12 }}>
                    <AlertTriangle size={13} /> {e.retake.reason}
                    {e.retake.nextAllowedAt && <span className="subtle"> Next attempt {relativeTime(e.retake.nextAllowedAt)}.</span>}
                  </p>
                )}
                {soon && <p className="small subtle" style={{ marginTop: 12 }}>{e.availabilityNote ?? 'This simulation is not available yet.'}</p>}
                {start.isError && (
                  <p className="small text-err" style={{ marginTop: 12 }}>
                    {start.error.message}
                  </p>
                )}
                <Button variant="primary" size="lg" style={{ width: '100%', marginTop: 14 }} icon={<Play size={14} />} disabled={!canStart} loading={start.isPending} onClick={begin}>
                  Start exam
                </Button>
                <p className="xs subtle" style={{ marginTop: 8, textAlign: 'center' }}>
                  {e.retake.attemptsTotal === 0 ? 'First attempt' : `Attempt ${e.retake.attemptsTotal + 1}`} · {e.retake.freeRetakesLeft} free retake{e.retake.freeRetakesLeft === 1 ? '' : 's'} left ·{' '}
                  {e.retake.attemptsLast30Days}/{e.retakePolicy.maxAttemptsPer30Days} in 30 days
                </p>
              </>
            )}
          </Card>

          <Card className="card-flush">
            <div className="card-head">
              <h2>Your attempts</h2>
              {e.bestScore !== undefined && <span className="xs subtle">best {e.bestScore}%</span>}
            </div>
            <AttemptsTable attempts={e.attempts} showExam={false} />
          </Card>

          <Disclaimer text={e.disclaimer} />
        </div>
      </div>
    </div>
  );
}
