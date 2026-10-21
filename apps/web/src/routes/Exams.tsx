import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, ChevronLeft, GraduationCap, History, Hourglass, Play, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiError } from '@/api/client';
import { useExams, useGrantExamRetake, useMyAttempts, useTeamExamReadiness, useVoidExamAttempt } from '@/api/exams';
import type { ExamAttemptSummary, ExamSummary, TeamExamMember } from '@/api/types';
import { can, RequireAccess } from '@/app/access';
import { FeatureLock } from '@/components/license';
import { useShell } from '@/app/shell-context';
import { alignLabel, Disclaimer, ExamDomainIcon, examDomainLabel, fmtPct, PhaseBadge, ResultBadge, RuleChips, ScoreBar } from '@/components/exams/ui';
import { Badge, Button, Card, EmptyState, ErrorState, PageSkeleton, Segmented, Stat } from '@/components/ui';
import { ConfirmDialog, Field, Input, Select } from '@/components/ui/forms';
import { useSelectedTeam } from './Team';
import { examsRoute, teamExamsRoute } from '@/router';
import { formatDate, formatMinutes, relativeTime } from '@/lib/utils';

/* --------------------------------------------------------------- catalog */

function ExamCard({ exam }: { exam: ExamSummary }) {
  const soon = exam.availability !== 'available';
  const active = exam.retake.activeAttemptId;
  return (
    <Card className={soon ? 'exam-card exam-card-soon' : 'exam-card'}>
      <div className="row xs subtle" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 5 }}>
          <ExamDomainIcon domain={exam.domain} size={12} /> {examDomainLabel[exam.domain]}
        </span>
        {exam.alignsTo.map((a) => (
          <Badge key={a} tone="outline" title="Objectives aligned to this exam; no affiliation">
            {alignLabel(a)}-aligned
          </Badge>
        ))}
        {soon ? <Badge>Coming soon</Badge> : active ? <Badge tone="accent">Attempt in progress</Badge> : null}
      </div>
      <Link to="/exams/$examId" params={{ examId: exam.id }} className="exam-card-title link-quiet">
        {exam.title}
      </Link>
      <div className="exam-facts">
        <div className="exam-fact">
          <span className="exam-fact-label">Duration</span>
          <span className="exam-fact-value tnum">{formatMinutes(exam.durationMinutes)}</span>
        </div>
        <div className="exam-fact">
          <span className="exam-fact-label">Tasks</span>
          <span className="exam-fact-value tnum">{exam.taskCount}</span>
        </div>
        <div className="exam-fact">
          <span className="exam-fact-label">Pass mark</span>
          <span className="exam-fact-value tnum">{exam.passMark}%</span>
        </div>
      </div>
      <RuleChips rules={exam.rules} environment={exam.environment} />
      {soon && exam.availabilityNote && <p className="xs subtle">{exam.availabilityNote}</p>}
      <Disclaimer text={exam.disclaimer} />
      <div className="exam-card-foot">
        <span className="xs subtle">
          {exam.lastAttempt ? (
            <span className="row" style={{ gap: 6 }}>
              Last attempt {relativeTime(exam.lastAttempt.startedAt)}
              {exam.lastAttempt.score !== undefined && <ResultBadge passed={exam.lastAttempt.passed} score={exam.lastAttempt.score} />}
            </span>
          ) : soon ? (
            'Not available yet'
          ) : (
            'Not attempted'
          )}
        </span>
        {active ? (
          <Link to="/exams/attempts/$attemptId" params={{ attemptId: active }} className="btn btn-primary btn-sm">
            <Play size={13} /> Resume
          </Link>
        ) : (
          <Link to="/exams/$examId" params={{ examId: exam.id }} className={soon ? 'btn btn-ghost btn-sm' : 'btn btn-secondary btn-sm'}>
            {soon ? 'Details' : 'Prepare'} <ArrowRight size={13} />
          </Link>
        )}
      </div>
    </Card>
  );
}

export function AttemptsTable({ attempts, showExam = true }: { attempts: ExamAttemptSummary[]; showExam?: boolean }) {
  if (!attempts.length) return <EmptyState compact icon={<History size={18} />} title="No attempts yet" description="Your exam simulation attempts and their reports show up here." />;
  return (
    <table className="table">
      <thead>
        <tr>
          {showExam && <th>Exam</th>}
          <th>Attempt</th>
          <th>Started</th>
          <th>Status</th>
          <th style={{ textAlign: 'right' }}>Score</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {attempts.map((a) => (
          <tr key={a.id}>
            {showExam && (
              <td>
                <Link to="/exams/$examId" params={{ examId: a.examId }} className="link-quiet small">
                  {a.examTitle}
                </Link>
              </td>
            )}
            <td className="tnum small">
              #{a.number}
              {!a.counted && <span className="xs subtle"> · not counted</span>}
            </td>
            <td className="small muted" title={new Date(a.startedAt).toLocaleString()}>
              {formatDate(a.startedAt)}
            </td>
            <td>
              <PhaseBadge phase={a.phase} />
            </td>
            <td style={{ textAlign: 'right' }}>{a.score !== undefined ? <ResultBadge passed={a.passed} score={a.score} /> : <span className="subtle">-</span>}</td>
            <td style={{ textAlign: 'right' }}>
              {a.phase === 'completed' ? (
                <Link to="/exams/attempts/$attemptId/results" params={{ attemptId: a.id }} className="btn btn-ghost btn-sm">
                  Report <ArrowRight size={12} />
                </Link>
              ) : a.phase === 'failed' ? null : (
                <Link to="/exams/attempts/$attemptId" params={{ attemptId: a.id }} className="btn btn-secondary btn-sm">
                  Resume
                </Link>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Exams() {
  const search = examsRoute.useSearch();
  const navigate = useNavigate({ from: '/exams' });
  const exams = useExams();
  const attempts = useMyAttempts();
  const view = search.view ?? 'catalog';
  const counts = useMemo(() => {
    const list = exams.data ?? [];
    return { available: list.filter((e) => e.availability === 'available').length, total: list.length };
  }, [exams.data]);

  return (
    <RequireAccess path="/exams">
    <div className="page">
      <header className="page-header">
        <div style={{ maxWidth: 720 }}>
          <div className="page-eyebrow">Learner</div>
          <h1>Exam simulations</h1>
          <p className="muted">Timed practical exams on real environments: tasks drawn from each objective, one timer, no hints, graded the same way as the labs. A retake draws different tasks.</p>
        </div>
        <Segmented
          label="View"
          value={view}
          onChange={(v) => void navigate({ search: v === 'attempts' ? { view: 'attempts' } : {} })}
          options={[
            { value: 'catalog', label: 'Simulations' },
            { value: 'attempts', label: `My attempts${attempts.data?.length ? ` (${attempts.data.length})` : ''}` },
          ]}
        />
      </header>

      {view === 'catalog' ? (
        exams.isPending ? (
          <PageSkeleton />
        ) : exams.isError ? (
          <ErrorState title="Exams unavailable" error={exams.error} onRetry={() => void exams.refetch()} />
        ) : (
          <>
            <p className="xs subtle" style={{ marginBottom: 14 }}>
              {counts.available} of {counts.total} simulations available · the others are waiting for their exam tasks.
            </p>
            <div className="exam-grid">
              {exams.data.map((e) => (
                <ExamCard key={e.id} exam={e} />
              ))}
            </div>
          </>
        )
      ) : attempts.isPending ? (
        <PageSkeleton />
      ) : attempts.isError ? (
        <ErrorState title="Attempts unavailable" error={attempts.error} onRetry={() => void attempts.refetch()} />
      ) : (
        <Card className="card-flush">
          <div className="card-head">
            <h2>Attempt history</h2>
            <span className="xs subtle">attempts the platform could not run are not counted against retake limits</span>
          </div>
          <AttemptsTable attempts={attempts.data} />
        </Card>
      )}
    </div>
    </RequireAccess>
  );
}

/* --------------------------------------------------------- team readiness */

const readinessLabel: Record<TeamExamMember['readiness'], string> = { ready: 'Ready', close: 'Close', 'not-ready': 'Not ready', 'not-attempted': 'Not attempted' };
const readinessTone: Record<TeamExamMember['readiness'], 'ok' | 'warn' | 'err' | 'neutral'> = { ready: 'ok', close: 'warn', 'not-ready': 'err', 'not-attempted': 'neutral' };

/** Manager/admin interventions on one member: grant a retake (assignment.manage), void a running attempt (session.control). */
function MemberActions({ examId, examTitle, member }: { examId: string; examTitle: string; member: TeamExamMember }) {
  const { me } = useSelectedTeam(undefined);
  const { toast } = useShell();
  const grant = useGrantExamRetake(examId);
  const voider = useVoidExamAttempt();
  const [confirm, setConfirm] = useState<'grant' | 'void' | null>(null);
  const [reason, setReason] = useState('');
  const mayGrant = can(me, 'assignment.manage');
  const mayVoid = can(me, 'session.control') && !!member.activeAttemptId;
  if (!mayGrant && !mayVoid) return null;
  const close = () => (setConfirm(null), setReason(''));
  return (
    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
      {mayVoid && (
        <Button size="sm" variant="ghost" onClick={() => setConfirm('void')}>
          Void attempt
        </Button>
      )}
      {mayGrant && member.attempts > 0 && (
        <Button size="sm" variant="ghost" onClick={() => setConfirm('grant')}>
          Grant retake
        </Button>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && close()}
        title={confirm === 'void' ? `Void ${member.name}'s running attempt?` : `Grant ${member.name} one more attempt?`}
        description={
          confirm === 'void'
            ? `The exam environment closes now. The attempt is not scored and does not count against ${member.name}'s retakes. This is recorded in the audit log.`
            : `${member.name} can start ${examTitle} once more, even inside the cooldown or past the 30-day limit. This is recorded in the audit log.`
        }
        confirmLabel={confirm === 'void' ? 'Void attempt' : 'Grant retake'}
        danger={confirm === 'void'}
        loading={grant.isPending || voider.isPending}
        onConfirm={() => {
          const done = (title: string) => () => (toast({ title, tone: 'ok' }), close());
          const failed = (e: Error) => toast({ title: 'Not done', description: e.message, tone: 'err' });
          if (confirm === 'void' && member.activeAttemptId) voider.mutate({ attemptId: member.activeAttemptId, reason: reason || undefined }, { onSuccess: done('Attempt voided'), onError: failed });
          if (confirm === 'grant') grant.mutate({ userId: member.userId, ...(reason ? { reason } : {}) }, { onSuccess: done('Retake granted'), onError: failed });
        }}
      >
        <Field label="Reason (audit log)">
          {({ id }) => <Input id={id} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={confirm === 'void' ? 'e.g. proctoring incident' : 'e.g. environment outage during the last attempt'} />}
        </Field>
      </ConfirmDialog>
    </div>
  );
}

export function TeamExams() {
  const search = teamExamsRoute.useSearch();
  const navigate = useNavigate({ from: '/team/exams' });
  const { teams, selected } = useSelectedTeam(search.team);
  const data = useTeamExamReadiness(selected);
  const exam = data.data?.exams.find((e) => e.examId === search.exam) ?? data.data?.exams[0];

  return (
    <RequireAccess path="/team">
      <div className="page">
        <Link to="/team" search={search.team ? { team: search.team } : {}} className="link-quiet small row" style={{ gap: 4, marginBottom: 14, display: 'inline-flex' }}>
          <ChevronLeft size={13} /> Team dashboard
        </Link>
        <header className="page-header">
          <div>
            <div className="page-eyebrow">Manager{data.data && teams.length <= 1 ? ` · ${data.data.team.name}` : ''}</div>
            <h1>Exam readiness</h1>
            {teams.length > 1 && selected && (
              <Select aria-label="Team" value={selected} onChange={(e) => void navigate({ search: { ...search, team: e.target.value } })} style={{ marginTop: 6 }}>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
            <p className="muted">Who has taken a simulation, how they scored against the pass mark, and where each person is weakest.</p>
          </div>
        </header>
        {data.isPending ? (
          <PageSkeleton />
        ) : data.isError && data.error instanceof ApiError && data.error.code === 'feature_required' ? (
          <FeatureLock feature="advanced_analytics">Each member's simulation scores against the pass mark and weakest objectives are advanced analytics. Members still see their own reports.</FeatureLock>
        ) : data.isError ? (
          <ErrorState title="Team readiness unavailable" error={data.error} onRetry={() => void data.refetch()} />
        ) : !exam ? (
          <EmptyState icon={<GraduationCap size={20} />} title="No exam simulations available yet" description="Readiness appears here once simulations are available to the team." />
        ) : (
          <>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 18 }} role="tablist" aria-label="Exam">
              {data.data.exams.map((e) => (
                <button key={e.examId} role="tab" aria-selected={e.examId === exam.examId} className={e.examId === exam.examId ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'} onClick={() => void navigate({ search: { ...search, exam: e.examId } })}>
                  {e.examTitle.replace(/ practical exam simulation$/, '')}
                </button>
              ))}
            </div>
            <div className="grid-3" style={{ marginBottom: 20 }}>
              <Card>
                <Stat label="Pass rate" value={`${Math.round(exam.passRate * 100)}%`} hint={`${exam.members.filter((m) => m.passed).length} of ${exam.members.length} passed`} tone={exam.passRate >= 0.5 ? 'ok' : 'warn'} />
              </Card>
              <Card>
                <Stat label="Average last score" value={exam.averageScore !== undefined ? fmtPct(exam.averageScore) : '-'} hint={`pass mark ${exam.passMark}%`} />
              </Card>
              <Card>
                <Stat label="Not attempted" value={exam.members.filter((m) => m.readiness === 'not-attempted').length} hint={<span className="row" style={{ gap: 4 }}><Users size={11} /> of {exam.members.length} members</span>} />
              </Card>
            </div>
            <Card className="card-flush">
              <div className="card-head">
                <h2>{exam.examTitle}</h2>
                <span className="xs subtle">best score against the pass mark ({exam.passMark}%)</span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Readiness</th>
                    <th style={{ width: '28%' }}>Best score</th>
                    <th style={{ textAlign: 'right' }}>Last</th>
                    <th style={{ textAlign: 'right' }}>Attempts</th>
                    <th>Weakest objective</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {exam.members.map((m) => (
                    <tr key={m.userId}>
                      <td className="small">
                        {m.name}
                        {m.lastAttemptAt && <div className="xs subtle">{relativeTime(m.lastAttemptAt)}</div>}
                      </td>
                      <td>
                        <Badge tone={readinessTone[m.readiness]}>{readinessLabel[m.readiness]}</Badge>
                      </td>
                      <td>
                        {m.bestScore !== undefined ? (
                          <div className="row" style={{ gap: 10 }}>
                            <div className="grow">
                              <ScoreBar value={m.bestScore} passMark={exam.passMark} />
                            </div>
                            <span className="tnum small" style={{ width: 48, textAlign: 'right' }}>
                              {fmtPct(m.bestScore)}
                            </span>
                          </div>
                        ) : (
                          <span className="subtle small">-</span>
                        )}
                      </td>
                      <td className="tnum small" style={{ textAlign: 'right' }}>
                        {m.lastScore !== undefined ? fmtPct(m.lastScore) : '-'}
                      </td>
                      <td className="tnum small" style={{ textAlign: 'right' }}>
                        {m.attempts}
                      </td>
                      <td className="small muted">
                        {m.weakestObjective ? (
                          <span title={m.weakestObjective.id}>
                            {m.weakestObjective.name ?? m.weakestObjective.id} <span className="tnum subtle">· {fmtPct(m.weakestObjective.score)}</span>
                          </span>
                        ) : (
                          <span className="row subtle" style={{ gap: 4 }}>
                            <Hourglass size={11} /> no data
                          </span>
                        )}
                      </td>
                      <td>
                        <MemberActions examId={exam.examId} examTitle={exam.examTitle} member={m} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    </RequireAccess>
  );
}
