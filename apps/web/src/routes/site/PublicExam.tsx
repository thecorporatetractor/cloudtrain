import { Link } from '@tanstack/react-router';
import { ChevronLeft, FileCheck2, ListChecks, Lock } from 'lucide-react';
import { useMe } from '@/api/client';
import { usePublicExam } from '@/api/public';
import { alignLabel, Disclaimer, ExamDomainIcon, examDomainLabel, RuleChips } from '@/components/exams/ui';
import { Badge, Card, ErrorState, PageSkeleton, Stat } from '@/components/ui';
import { publicExamRoute } from '@/router';
import { formatMinutes } from '@/lib/utils';
import { useDocumentTitle } from '@/site/util';

/** An exam simulation, read-only: format, rules, objectives and what the report contains. No attempts, no pool. */
export function PublicExam() {
  const { examId } = publicExamRoute.useParams();
  const exam = usePublicExam(examId);
  const me = useMe();
  useDocumentTitle(exam.data?.title);
  if (exam.isPending) {
    return (
      <div className="site-container site-page">
        <PageSkeleton />
      </div>
    );
  }
  if (exam.isError || !exam.data) {
    return (
      <div className="site-container site-page">
        <ErrorState title="This exam simulation does not exist" error={exam.error} />
        <Link to="/catalog" search={{}} className="btn btn-secondary btn-md" style={{ marginTop: 16 }}>
          <ChevronLeft size={14} aria-hidden /> Back to the catalog
        </Link>
      </div>
    );
  }
  const e = exam.data;
  const soon = e.availability !== 'available';
  return (
    <div className="site-container site-page">
      <nav className="site-crumbs xs subtle" aria-label="Breadcrumb">
        <Link to="/catalog" search={{}} className="link-quiet">
          Catalog
        </Link>
        <span aria-hidden>/</span>
        <span>Exam simulation</span>
      </nav>
      <header className="site-page-head">
        <div className="stack" style={{ gap: 8 }}>
          <div className="row xs subtle" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="row" style={{ gap: 5 }}>
              <ExamDomainIcon domain={e.domain} size={12} /> {examDomainLabel[e.domain]}
            </span>
            {e.alignsTo.map((a) => (
              <Badge key={a} tone="outline" title="Objectives aligned to this exam; no affiliation">
                {alignLabel(a)}-aligned
              </Badge>
            ))}
            {soon && <Badge>Coming soon</Badge>}
          </div>
          <h1 className="site-h1">{e.title}</h1>
          {e.description && (
            <p className="muted" style={{ maxWidth: 720 }}>
              {e.description}
            </p>
          )}
          <Disclaimer text={e.disclaimer} />
        </div>
        <div className="site-page-head-action">
          {me.isSuccess ? (
            <Link to="/exams/$examId" params={{ examId: e.id }} className="btn btn-primary btn-md">
              Open in the app
            </Link>
          ) : (
            <Link to="/sign-in" search={{ returnTo: `/exams/${e.id}` }} className="btn btn-primary btn-md">
              <Lock size={12} aria-hidden /> Sign in to attempt
            </Link>
          )}
          {soon && e.availabilityNote && (
            <span className="xs subtle" style={{ maxWidth: 260, textAlign: 'right' }}>
              {e.availabilityNote}
            </span>
          )}
        </div>
      </header>

      <div className="site-exam-stats">
        <Stat label="Duration" value={formatMinutes(e.durationMinutes)} hint={e.rules.timer === 'single' ? 'one timer' : 'per task'} />
        <Stat label="Tasks" value={e.taskCount} hint={e.environment === 'shared' ? 'shared environment' : 'one environment each'} />
        <Stat label="Pass mark" value={`${e.passMark}%`} hint={e.passMarkNote ? 'platform setting' : undefined} />
        <Stat label="Retakes" value={e.retakePolicy.maxAttemptsPer30Days} hint={`per 30 days · ${e.retakePolicy.cooldownHours} h cooldown`} />
      </div>
      {e.passMarkNote && <p className="xs subtle">{e.passMarkNote}</p>}

      <div className="split split-7-5" style={{ marginTop: 28 }}>
        <section aria-labelledby="objectives">
          <div className="section-header">
            <div>
              <h2 id="objectives">Objectives and weights</h2>
              <p className="muted small">Tasks are drawn per objective from pools at least twice the draw; two attempts can be fully disjoint.</p>
            </div>
          </div>
          <Card className="card-flush">
            <table className="table">
              <thead>
                <tr>
                  <th>Objective</th>
                  <th className="tnum" style={{ textAlign: 'right' }}>
                    Weight
                  </th>
                  <th className="tnum" style={{ textAlign: 'right' }}>
                    Tasks drawn
                  </th>
                  <th className="tnum" style={{ textAlign: 'right' }}>
                    Pool
                  </th>
                </tr>
              </thead>
              <tbody>
                {e.objectives.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span className="small">{o.name ?? o.id}</span>
                      <span className="xs subtle mono" style={{ display: 'block' }}>
                        {o.id}
                      </span>
                    </td>
                    <td className="tnum" style={{ textAlign: 'right' }}>
                      {o.weight}%
                    </td>
                    <td className="tnum" style={{ textAlign: 'right' }}>
                      {o.tasks}
                    </td>
                    <td className="tnum" style={{ textAlign: 'right' }}>
                      {o.poolSize}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
        <aside className="stack" style={{ gap: 16 }}>
          <Card>
            <h3 className="row" style={{ gap: 6 }}>
              <ListChecks size={14} aria-hidden /> Rules
            </h3>
            <div style={{ marginTop: 10 }}>
              <RuleChips rules={e.rules} environment={e.environment} />
            </div>
            {e.rules.docsAllowed && (
              <p className="small muted" style={{ marginTop: 10 }}>
                Documentation: {e.rules.docsAllowed}.
              </p>
            )}
            {e.rules.notes && (
              <p className="small muted" style={{ marginTop: 6 }}>
                {e.rules.notes}
              </p>
            )}
          </Card>
          <Card>
            <h3 className="row" style={{ gap: 6 }}>
              <FileCheck2 size={14} aria-hidden /> The report includes
            </h3>
            <ul className="site-list small muted" style={{ marginTop: 10 }}>
              {e.reportIncludes.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Card>
          {e.simulationNote && (
            <Card>
              <h3>About this simulation</h3>
              <p className="small muted" style={{ marginTop: 8 }}>
                {e.simulationNote}
              </p>
            </Card>
          )}
          <Card>
            <h3>Retake policy</h3>
            <ul className="site-list small muted" style={{ marginTop: 8 }}>
              <li>{e.retakePolicy.freeRetakes} free retake(s) without waiting for the cooldown</li>
              <li>{e.retakePolicy.cooldownHours} hours between attempts, at most {e.retakePolicy.maxAttemptsPer30Days} per 30 days</li>
              <li>{e.retakePolicy.freshDraw ? 'A retake draws different tasks and new parameters' : 'Retakes may repeat tasks'}</li>
              {e.retakePolicy.notes && <li>{e.retakePolicy.notes}</li>}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
