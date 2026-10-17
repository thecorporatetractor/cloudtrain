import { Link } from '@tanstack/react-router';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useCatalog } from '@/api/client';
import { useAttempt, useExam, useExamReport } from '@/api/exams';
import type { ExamTaskScore } from '@/api/types';
import { Ring } from '@/components/charts';
import { SkillTags } from '@/components/domain';
import { Disclaimer, fmtPct, OutcomeBadge, ScoreBar } from '@/components/exams/ui';
import { Badge, Card, EmptyState, ErrorState, PageSkeleton, Stat } from '@/components/ui';
import { examResultsRoute } from '@/router';
import { formatDate, formatDuration } from '@/lib/utils';
import { RequireAccess } from '@/app/access';

function TaskRow({ t }: { t: ExamTaskScore }) {
  const [open, setOpen] = useState(t.outcome !== 'pass');
  const failed = t.checks.filter((c) => !c.passed).length;
  return (
    <>
      <tr>
        <td>
          <button className="exam-expand" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span className="tnum subtle small">{t.index}.</span>
            <span className="small">{t.title}</span>
          </button>
        </td>
        <td className="xs subtle mono">{t.objective}</td>
        <td className="tnum small" style={{ textAlign: 'right' }}>
          {fmtPct(t.weight)}
        </td>
        <td>
          <OutcomeBadge outcome={t.outcome} />
        </td>
        <td className="tnum small" style={{ textAlign: 'right' }}>
          {fmtPct(t.score)}
        </td>
        <td className="tnum xs subtle" style={{ textAlign: 'right' }}>
          {t.timeSpentSec !== undefined ? formatDuration(t.timeSpentSec) : '-'}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ paddingTop: 0 }}>
            <ul className="exam-check-list" aria-label={`Checks of task ${t.index}: ${failed} not satisfied`}>
              {t.checks.map((c) => (
                <li key={c.id}>
                  {c.passed ? <CheckCircle2 size={14} className="text-ok" aria-label="passed" /> : <XCircle size={14} className="text-err" aria-label="not passed" />}
                  <span className="grow">
                    {c.description ?? c.id}
                    <span className="xs subtle"> · {c.message}</span>
                    {c.failedAfterReboot && (
                      <Badge tone="warn" style={{ marginLeft: 6 }}>
                        <RotateCcw size={10} /> lost on reboot
                      </Badge>
                    )}
                    {c.failedOnRerun && (
                      <Badge tone="warn" style={{ marginLeft: 6 }}>
                        <RefreshCw size={10} /> failed on re-run
                      </Badge>
                    )}
                  </span>
                  <SkillTags ids={c.skills} max={2} size="xs" />
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function ExamResultsScreen() {
  const { attemptId } = examResultsRoute.useParams();
  const attempt = useAttempt(attemptId);
  const report = useExamReport(attemptId, attempt.data?.reportReady ?? false);
  const exam = useExam(attempt.data?.examId ?? '');
  const catalog = useCatalog();
  const labTitle = (id: string) => catalog.data?.labs.find((l) => l.id === id)?.title ?? id;

  if (attempt.isPending || (attempt.data?.reportReady && report.isPending)) {
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  }
  if (attempt.isError) {
    return (
      <div className="page page-narrow">
        <ErrorState title="Attempt unavailable" error={attempt.error} onRetry={() => void attempt.refetch()} />
      </div>
    );
  }
  if (!attempt.data.reportReady || !report.data) {
    return (
      <div className="page page-narrow">
        <EmptyState
          icon={<Clock size={20} />}
          title={attempt.data.phase === 'failed' ? 'This attempt was not scored' : 'The report is not ready yet'}
          description={attempt.data.message}
          action={
            <Link to="/exams/attempts/$attemptId" params={{ attemptId }} className="btn btn-secondary btn-md">
              Back to the attempt
            </Link>
          }
        />
      </div>
    );
  }
  const r = report.data;
  const passTasks = r.tasks.filter((t) => t.outcome === 'pass').length;
  const retake = exam.data?.retake;

  return (
    <div className="page">
      <Link to="/exams/$examId" params={{ examId: r.examId }} className="link-quiet small row" style={{ gap: 4, marginBottom: 14, display: 'inline-flex' }}>
        <ChevronLeft size={13} /> {r.examTitle}
      </Link>
      <header className="page-header">
        <div>
          <div className="page-eyebrow">
            Score report · attempt {attempt.data.number} · {formatDate(r.gradedAt)}
          </div>
          <h1>{r.examTitle}</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link to="/exams" search={{ view: 'attempts' }} className="btn btn-ghost btn-md">
            All attempts
          </Link>
          {retake?.allowed ? (
            <Link to="/exams/$examId" params={{ examId: r.examId }} className="btn btn-primary btn-md">
              Retake <ArrowRight size={13} />
            </Link>
          ) : retake ? (
            <span className="xs subtle" title={retake.reason}>
              Retake {retake.nextAllowedAt ? `from ${formatDate(retake.nextAllowedAt)}` : 'not available'}
            </span>
          ) : null}
        </div>
      </header>

      <Card className="exam-hero" style={{ marginBottom: 20 }}>
        <Ring value={r.score / 100} size={104} stroke={8} tone={r.passed ? 'ok' : 'err'} label={`Score ${fmtPct(r.score)}`}>
          <span className="tnum" style={{ fontSize: 22, fontWeight: 700 }}>
            {fmtPct(r.score)}
          </span>
        </Ring>
        <div className="stack" style={{ gap: 6 }}>
          <div className={r.passed ? 'exam-verdict exam-verdict-pass' : 'exam-verdict exam-verdict-fail'}>{r.passed ? 'Passed' : 'Not passed'}</div>
          <div className="small muted">
            {fmtPct(r.score)} against a pass mark of {r.passMark}% · {passTasks} of {r.tasks.length} tasks fully solved · {r.partialCredit === 'per-check' ? 'partial credit per check' : 'all-or-nothing per task'}
          </div>
          <div style={{ maxWidth: 520, marginTop: 6 }}>
            <ScoreBar value={r.score} passMark={r.passMark} />
          </div>
        </div>
        <div className="grid-2" style={{ gap: 18 }}>
          <Stat label="Time used" value={r.minutesUsed !== undefined ? `${r.minutesUsed} min` : '-'} hint={`of ${r.durationMinutes} min`} />
          <Stat label="Grading" value={r.passes.length} hint={r.passes.join(' · ')} />
        </div>
      </Card>

      <div className="split split-7-5">
        <div className="stack" style={{ gap: 20 }}>
          <Card className="card-flush">
            <div className="card-head">
              <h2>By objective</h2>
              <span className="xs subtle">line = pass mark</span>
            </div>
            <div className="card-body stack" style={{ gap: 14 }}>
              {r.objectives.map((o) => (
                <div key={o.id} className="exam-objective-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="small truncate">{o.name ?? o.id}</div>
                    <div className="xs subtle">
                      {o.weight}% of the score · {o.tasks} task{o.tasks === 1 ? '' : 's'}
                    </div>
                  </div>
                  <ScoreBar value={o.score} passMark={r.passMark} />
                  <span className="tnum small" style={{ textAlign: 'right' }}>
                    {fmtPct(o.score)}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="card-flush">
            <div className="card-head">
              <h2>By task</h2>
              <span className="xs subtle">messages never reveal expected values</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Objective</th>
                  <th style={{ textAlign: 'right' }}>Weight</th>
                  <th>Outcome</th>
                  <th style={{ textAlign: 'right' }}>Score</th>
                  <th style={{ textAlign: 'right' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {r.tasks.map((t) => (
                  <TaskRow key={t.index} t={t} />
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="stack" style={{ gap: 20 }}>
          {r.recommendations.length > 0 && (
            <Card>
              <h2 style={{ marginBottom: 10 }}>Practise next</h2>
              <div className="stack" style={{ gap: 12 }}>
                {r.recommendations.map((rec) => {
                  const o = r.objectives.find((x) => x.id === rec.objective);
                  return (
                    <div key={rec.objective}>
                      <div className="small">
                        {o?.name ?? rec.objective} <span className="tnum subtle">· {o ? fmtPct(o.score) : ''}</span>
                      </div>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        {rec.labIds.map((id) => (
                          <Link key={id} to="/labs/$labId" params={{ labId: id }} className="btn btn-secondary btn-sm" title={id}>
                            {labTitle(id)}
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card>
            <h2 style={{ marginBottom: 4 }}>Skill evidence</h2>
            <p className="xs subtle" style={{ marginBottom: 12 }}>
              Every graded check updated your skill model, exactly like lab checks.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Skill</th>
                  <th style={{ textAlign: 'right' }}>Passed</th>
                  <th style={{ textAlign: 'right' }}>Failed</th>
                </tr>
              </thead>
              <tbody>
                {r.skills.map((s) => (
                  <tr key={s.skillId}>
                    <td>
                      <SkillTags ids={[s.skillId]} size="xs" />
                    </td>
                    <td className="tnum small text-ok" style={{ textAlign: 'right' }}>
                      {s.passed}
                    </td>
                    <td className="tnum small" style={{ textAlign: 'right', color: s.failed ? 'var(--err)' : undefined }}>
                      {s.failed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Disclaimer text={r.disclaimer} />
        </div>
      </div>
    </div>
  );
}

/** Exam screens need lab.run (ROUTE_ACCESS '/exams'); the gateway enforces it too. */
export function ExamResults() {
  return (
    <RequireAccess path="/exams">
      <ExamResultsScreen />
    </RequireAccess>
  );
}
