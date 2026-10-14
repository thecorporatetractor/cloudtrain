import { Link } from '@tanstack/react-router';
import { ArrowRight, CheckCircle2, ClipboardList, Flame, Lightbulb, Play, Route, Sparkles, Trophy } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCatalog, useHome, useSkills } from '@/api/client';
import type { Activity, LabSummary, Recommendation } from '@/api/types';
import { Bar, Delta, Ring } from '@/components/charts';
import { DifficultyBadge, DomainIcon, ReasonList, domainLabel } from '@/components/domain';
import { AssignmentStateBadge, DueDate, ItemLink } from '@/components/platform';
import { Badge, Card, ErrorState, PageSkeleton, Stat } from '@/components/ui';
import { frameworkDomainLabel } from '@/lib/readiness';
import { daysUntil, formatDate, formatMinutes, pct, relativeTime } from '@/lib/utils';

export function Home() {
  const home = useHome();
  const catalog = useCatalog();
  const skills = useSkills();

  if (home.isPending || catalog.isPending) {
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  }
  if (home.isError || catalog.isError) {
    return (
      <div className="page">
        <ErrorState error={home.error ?? catalog.error} onRetry={() => void (home.refetch(), catalog.refetch())} />
      </div>
    );
  }

  const { learner, recommendations, goal, activity, masteryByDomain, assignmentsDue } = home.data;
  const labOf = (id: string) => catalog.data.labs.find((l) => l.id === id);
  const framework = skills.data?.frameworks.find((f) => f.id === goal.frameworkId);
  const [top, ...others] = recommendations;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">{learner.team}</div>
          <h1>
            {greeting}, {learner.name.split(' ')[0]}
          </h1>
          <p className="muted">
            {learner.minutesThisWeek} minutes this week · {learner.streakDays}-day streak · {pct(goal.readiness)} ready for {framework?.name ?? goal.frameworkId.toUpperCase()}
          </p>
        </div>
        <div className="row" style={{ gap: 24 }}>
          <Stat label="Streak" value={<span className="row" style={{ gap: 6 }}><Flame size={18} className="subtle" />{learner.streakDays}d</span>} />
          <Stat label="This week" value={formatMinutes(learner.minutesThisWeek)} hint={`target ${formatMinutes(goal.weeklyMinutes)}`} />
        </div>
      </header>

      <div className="grid-home">
        <div className="stack" style={{ gap: 20 }}>
          <section aria-labelledby="next-lab">
            <div className="section-header">
              <div>
                <h2 id="next-lab">Next best lab</h2>
                <p className="muted small">Chosen to maximise expected mastery gain toward your goal, at a predicted success of 60–80%.</p>
              </div>
            </div>
            {top && <HeroRecommendation rec={top} lab={labOf(top.labId)} />}
          </section>

          {others.length > 0 && (
            <section aria-label="More recommendations" className="grid-2">
              {others.map((r) => (
                <RecommendationCard key={r.labId} rec={r} lab={labOf(r.labId)} />
              ))}
            </section>
          )}

          <section aria-labelledby="activity">
            <Card className="card-flush">
              <div className="card-head">
                <h2 id="activity">Recent activity</h2>
                <span className="subtle xs">Last 7 days</span>
              </div>
              <ul className="activity">
                {activity.map((a) => (
                  <ActivityRow key={a.id} a={a} labTitle={a.labId ? labOf(a.labId)?.title : undefined} />
                ))}
              </ul>
            </Card>
          </section>
        </div>

        <div className="stack" style={{ gap: 20 }}>
          {assignmentsDue && assignmentsDue.length > 0 && (
            <Card className="card-flush">
              <div className="card-head">
                <h2 className="row" style={{ gap: 8 }}>
                  <ClipboardList size={15} className="subtle" /> Assignments due
                </h2>
                <Link to="/assignments" className="link-quiet small">
                  All <ArrowRight size={12} />
                </Link>
              </div>
              <ul className="due-list">
                {assignmentsDue.map((a) => (
                  <li key={a.id} className="due-row">
                    <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                      <ItemLink item={a.item} className="small truncate link-strong" />
                      <DueDate dueAt={a.dueAt} />
                    </span>
                    <AssignmentStateBadge state={a.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="card-flush">
            <div className="card-head">
              <h2>Goal: {framework?.name ?? goal.frameworkId.toUpperCase()}</h2>
              <Link to="/skills" search={{ framework: goal.frameworkId }} className="link-quiet small">
                Skills <ArrowRight size={12} />
              </Link>
            </div>
            <div className="card-body stack" style={{ gap: 18 }}>
              <div className="row" style={{ gap: 18 }}>
                <Ring value={goal.readiness} size={76} stroke={6} label="Readiness">
                  <span className="ring-value">{pct(goal.readiness)}</span>
                </Ring>
                <div className="stack" style={{ gap: 4 }}>
                  <div className="small">
                    Forecast ready <strong>{formatDate(goal.forecastReadyDate)}</strong>
                  </div>
                  <div className="small muted">
                    Exam booked {formatDate(goal.targetDate)} · {daysUntil(goal.targetDate)} days left
                  </div>
                  <div className="row xs" style={{ marginTop: 2 }}>
                    {new Date(goal.forecastReadyDate) <= new Date(goal.targetDate) ? <Badge tone="ok">On track at {formatMinutes(goal.weeklyMinutes)}/week</Badge> : <Badge tone="warn">Behind by {daysUntil(goal.forecastReadyDate) - daysUntil(goal.targetDate)} days</Badge>}
                  </div>
                </div>
              </div>
              <ul className="domain-readiness">
                {goal.perDomain.map((d) => {
                  const fd = framework?.domains.find((x) => x.id === d.domainId);
                  return (
                    <li key={d.domainId} className="stack" style={{ gap: 5 }}>
                      <div className="row-between small">
                        <span className="truncate">
                          {fd?.name ?? d.domainId}
                          {fd && <span className="subtle xs"> · {Math.round(fd.weight * 100)}%</span>}
                        </span>
                        <span className="row" style={{ gap: 8 }}>
                          <Delta value={d.delta7d} />
                          <span className="tnum" style={{ width: 34, textAlign: 'right' }}>
                            {pct(d.readiness)}
                          </span>
                        </span>
                      </div>
                      <Bar value={d.readiness} delta={d.delta7d} tone={d.readiness < 0.45 ? 'neutral' : 'accent'} thin />
                    </li>
                  );
                })}
              </ul>
            </div>
          </Card>

          <Card className="card-flush">
            <div className="card-head">
              <h2>Skill mastery</h2>
              <span className="subtle xs">μ across practised skills</span>
            </div>
            <div className="card-body stack" style={{ gap: 14 }}>
              {masteryByDomain.map((m) => (
                <Link key={m.domain} to="/catalog" search={{ domain: m.domain }} className="mastery-row">
                  <span className="mastery-icon">
                    <DomainIcon domain={m.domain} size={15} />
                  </span>
                  <span className="stack grow" style={{ gap: 5 }}>
                    <span className="row-between small">
                      <span>{domainLabel[m.domain]}</span>
                      <span className="subtle xs">
                        {m.practicedSkills} of {m.skills} skills practised
                      </span>
                    </span>
                    <Bar value={m.mastery} thin />
                  </span>
                  <span className="tnum small" style={{ width: 34, textAlign: 'right' }}>
                    {pct(m.mastery)}
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function HeroRecommendation({ rec, lab }: { rec: Recommendation; lab: LabSummary | undefined }) {
  const frameworks = useSkills().data?.frameworks;
  if (!lab) return null;
  const resume = lab.completion === 'in-progress';
  return (
    <Card className="hero">
      <div className="hero-main">
        <div className="meta-row xs subtle" style={{ marginBottom: 10 }}>
          <span className="row" style={{ gap: 5 }}>
            <DomainIcon domain={lab.domain} size={12} /> {domainLabel[lab.domain]}
          </span>
          <DifficultyBadge difficulty={lab.difficulty} />
          <span>{formatMinutes(lab.estimatedMinutes)}</span>
          {lab.frameworks?.map((f) => (
            <span key={f} title={f}>
              {frameworkDomainLabel(f, frameworks)}
            </span>
          ))}
        </div>
        <h3 className="hero-title">{lab.title}</h3>
        <div className="hero-why">
          <div className="row xs subtle" style={{ gap: 6, marginBottom: 8 }}>
            <Sparkles size={12} /> Why this lab
          </div>
          <ReasonList reasons={rec.reasons} />
        </div>
        <div className="row" style={{ gap: 10, marginTop: 18 }}>
          <Link to="/labs/$labId/work" params={{ labId: lab.id }} search={{}} className="btn btn-primary btn-lg">
            <Play size={14} /> {resume ? 'Resume lab' : 'Start lab'}
          </Link>
          <Link to="/labs/$labId" params={{ labId: lab.id }} className="btn btn-ghost btn-lg">
            Details
          </Link>
        </div>
      </div>
      <div className="hero-side">
        <Stat label="Predicted success" value={pct(rec.predictedSuccess)} hint="productive range 60–80%" />
        <Stat label="Expected gain" value={`+${rec.expectedGain}`} hint="skill points" />
        <Stat label="Match" value={pct(rec.score)} hint="recommendation score" />
      </div>
    </Card>
  );
}

function RecommendationCard({ rec, lab }: { rec: Recommendation; lab: LabSummary | undefined }) {
  if (!lab) return null;
  return (
    <Link to="/labs/$labId" params={{ labId: lab.id }} className="card card-interactive stack" style={{ gap: 10 }}>
      <div className="row xs subtle" style={{ gap: 10 }}>
        <span className="row" style={{ gap: 5 }}>
          <DomainIcon domain={lab.domain} size={12} /> {domainLabel[lab.domain]}
        </span>
        <DifficultyBadge difficulty={lab.difficulty} />
        <span>{formatMinutes(lab.estimatedMinutes)}</span>
      </div>
      <h3 style={{ lineHeight: 1.35 }}>{lab.title}</h3>
      <ReasonList reasons={rec.reasons.slice(0, 2)} />
      <div className="row-between xs subtle" style={{ marginTop: 'auto', paddingTop: 6 }}>
        <span>Success {pct(rec.predictedSuccess)}</span>
        <span>+{rec.expectedGain} points</span>
      </div>
    </Link>
  );
}

const activityIcon: Record<Activity['kind'], ReactNode> = {
  lab_completed: <Trophy size={13} />,
  lab_started: <Play size={13} />,
  check_passed: <CheckCircle2 size={13} />,
  hint_used: <Lightbulb size={13} />,
  skill_up: <Sparkles size={13} />,
  path_completed: <Route size={13} />,
};

function ActivityRow({ a, labTitle }: { a: Activity; labTitle?: string }) {
  return (
    <li className="activity-row">
      <span className="activity-icon">{activityIcon[a.kind]}</span>
      <span className="stack grow" style={{ gap: 1, minWidth: 0 }}>
        <span className="small">{a.text}</span>
        {labTitle && a.labId && (
          <Link to="/labs/$labId" params={{ labId: a.labId }} className="xs subtle truncate link-quiet">
            {labTitle}
          </Link>
        )}
      </span>
      <time className="xs subtle tnum" dateTime={a.at}>
        {relativeTime(a.at)}
      </time>
    </li>
  );
}
