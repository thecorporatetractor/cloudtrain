import { Link } from '@tanstack/react-router';
import { ArrowRight, CalendarDays, CheckCircle2, ClipboardList, Compass, Flame, Info, Lightbulb, Play, RotateCcw, Route, Sparkles, Trophy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useCatalog, useHome, useSkills } from '@/api/client';
import type { Activity, ColdStart, Framework, GoalForecast, LabSummary, Recommendation, ResumeItem } from '@/api/types';
import { Bar, Delta, Ring } from '@/components/charts';
import { DifficultyBadge, DomainIcon, ReasonList, domainLabel } from '@/components/domain';
import { AssignmentStateBadge, DueDate, ItemLink } from '@/components/platform';
import { Badge, Card, ErrorState, PageSkeleton, Stat } from '@/components/ui';
import { dateFor, planOf, usePlanPrefs, type Plan, type PlanPrefs } from '@/lib/plan';
import { formatDate, formatMinutes, pct, relativeTime } from '@/lib/utils';

export function Home() {
  const home = useHome();
  const catalog = useCatalog();
  const skills = useSkills();
  const [prefs, setPrefs] = usePlanPrefs();

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

  const { learner, recommendations, goal, activity, masteryByDomain, assignmentsDue, resume, coldStart } = home.data;
  const labOf = (id: string) => catalog.data.labs.find((l) => l.id === id);
  const frameworks = skills.data?.frameworks;
  const framework = frameworks?.find((f) => f.id === goal.frameworkId);
  const fwName = framework?.name ?? goal.frameworkId.toUpperCase();
  const plan = planOf(goal, prefs);
  const [top, ...others] = recommendations;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const weeklyTarget = plan.weeklyTarget ?? (coldStart ? undefined : plan.weeklyNeeded || undefined);
  const targetMet = weeklyTarget !== undefined && learner.minutesThisWeek >= weeklyTarget;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">{learner.team}</div>
          <h1>
            {greeting}, {learner.name.split(' ')[0]}
          </h1>
          <p className="muted">{coldStart ? `We don't know your level yet. A short baseline turns the defaults below into your own numbers.` : `${pct(goal.readiness)} ready for ${fwName}, aiming for ${formatDate(plan.targetDate)}.`}</p>
        </div>
        <div className="row" style={{ gap: 24 }}>
          <Stat
            label="Streak"
            value={
              <span className="row" style={{ gap: 6 }}>
                <Flame size={18} className="subtle" />
                {learner.streakDays}d
              </span>
            }
            hint="days with a graded lab"
          />
          <Stat
            label="This week"
            value={formatMinutes(learner.minutesThisWeek)}
            tone={targetMet ? 'ok' : undefined}
            hint={weeklyTarget === undefined ? 'counts once you validate' : targetMet ? `weekly target ${formatMinutes(weeklyTarget)} met` : `of ${formatMinutes(weeklyTarget)} weekly target`}
          />
        </div>
      </header>

      <div className="grid-home">
        <div className="stack" style={{ gap: 20 }}>
          {resume && <ResumeCard resume={resume} lab={labOf(resume.labId)} />}

          {coldStart ? (
            <>
              <BaselineCard cold={coldStart} labOf={labOf} framework={framework} fwName={fwName} />
              <WeekPlan cold={coldStart} labOf={labOf} />
            </>
          ) : (
            <>
              {top && (
                <section aria-labelledby="next-lab">
                  <div className="section-header">
                    <div>
                      <h2 id="next-lab">Next best lab</h2>
                      <p className="muted small">The biggest step toward {fwName} at a level you are likely to pass.</p>
                    </div>
                  </div>
                  <HeroRecommendation rec={top} lab={labOf(top.labId)} framework={framework} frameworks={frameworks} />
                </section>
              )}
              {others.length > 0 && (
                <section aria-label="Alternatives" className="grid-2">
                  {others.map((r) => (
                    <RecommendationCard key={r.labId} rec={r} lab={labOf(r.labId)} framework={framework} />
                  ))}
                </section>
              )}
            </>
          )}

          {activity.length > 0 && (
            <section aria-labelledby="activity">
              <Card className="card-flush">
                <div className="card-head">
                  <h2 id="activity">Recent activity</h2>
                  <Link to="/history" className="link-quiet small">
                    History <ArrowRight size={12} />
                  </Link>
                </div>
                <ul className="activity">
                  {activity.map((a) => (
                    <ActivityRow key={a.id} a={a} labTitle={a.labId ? labOf(a.labId)?.title : undefined} />
                  ))}
                </ul>
              </Card>
            </section>
          )}
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

          <GoalCard goal={goal} plan={plan} prefs={prefs} setPrefs={setPrefs} framework={framework} fwName={fwName} cold={!!coldStart} labOf={labOf} />

          {coldStart ? (
            <ReadinessNote goal={goal} open />
          ) : (
            <Card className="card-flush">
              <div className="card-head">
                <h2>Skill mastery</h2>
                <span className="subtle xs">average of the skills you have practised</span>
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
                      {m.practicedSkills ? pct(m.mastery) : '–'}
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

/** "+3%", "+0.4%": readiness change, never a bare 0. */
function gainLabel(v: number | undefined): string {
  const p = (v ?? 0) * 100;
  if (p <= 0) return '+0%';
  return p < 1 ? `+${p.toFixed(1)}%` : `+${Math.round(p)}%`;
}

function domainName(framework: Framework | undefined, id: string): string {
  return framework?.domains.find((d) => d.id === id)?.name ?? id.split(':')[1]?.replace(/-/g, ' ') ?? id;
}

/** Goal-framework domains in full; other frameworks once each, by name ("also CKAD"). */
function examTags(lab: LabSummary, framework: Framework | undefined, frameworks: Framework[] | undefined): { goal: string[]; also: string[] } {
  const goal: string[] = [];
  const also = new Set<string>();
  for (const tag of lab.frameworks ?? []) {
    const fw = tag.split(':')[0]!;
    if (framework && fw === framework.id) goal.push(domainName(framework, tag));
    else also.add(frameworks?.find((f) => f.id === fw)?.name ?? fw.toUpperCase());
  }
  return { goal: Array.from(new Set(goal)), also: Array.from(also) };
}

function LabMeta({ lab, children }: { lab: LabSummary; children?: ReactNode }) {
  return (
    <div className="meta-row xs subtle">
      <span className="row" style={{ gap: 5 }}>
        <DomainIcon domain={lab.domain} size={12} /> {domainLabel[lab.domain]}
      </span>
      <DifficultyBadge difficulty={lab.difficulty} />
      <span>{formatMinutes(lab.estimatedMinutes)}</span>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------- resume */

function ResumeCard({ resume, lab }: { resume: ResumeItem; lab: LabSummary | undefined }) {
  if (!lab) return null;
  const live = !!resume.sessionId;
  const when = relativeTime(resume.startedAt);
  return (
    <section aria-labelledby="resume">
      <Card className="resume-card">
        <div className="stack grow" style={{ gap: 8, minWidth: 0 }}>
          <div id="resume" className="row xs subtle" style={{ gap: 6 }}>
            <RotateCcw size={12} /> Pick up where you left off
          </div>
          <h3 className="resume-title">{lab.title}</h3>
          <LabMeta lab={lab} />
          <p className="small muted">
            {resume.attempts > 1 ? `Opened ${resume.attempts} times, last ${when}` : `Started ${when}`} · {resume.checksPassed} of {resume.checksTotal} checks passed
            {resume.validations === 0 ? ', not validated yet' : ''}. {live ? 'Your environment is still running.' : 'The old environment has closed; resuming starts a fresh one.'}
          </p>
        </div>
        <div className="resume-actions">
          <Link to="/labs/$labId/work" params={{ labId: lab.id }} search={live ? { s: resume.sessionId } : {}} className="btn btn-primary btn-lg">
            <Play size={14} /> Resume lab
          </Link>
          <Link to="/labs/$labId" params={{ labId: lab.id }} className="btn btn-ghost">
            Details
          </Link>
        </div>
      </Card>
    </section>
  );
}

/* --------------------------------------------------------------- cold start */

function BaselineCard({ cold, labOf, framework, fwName }: { cold: ColdStart; labOf: (id: string) => LabSummary | undefined; framework: Framework | undefined; fwName: string }) {
  const labs = cold.baselineLabIds.map(labOf).filter((l): l is LabSummary => !!l);
  if (!labs.length) return null;
  return (
    <section aria-labelledby="baseline">
      <Card className="hero-cold">
        <div className="row xs subtle" style={{ gap: 6, marginBottom: 8 }}>
          <Compass size={12} /> Baseline
        </div>
        <h2 id="baseline" className="hero-title">
          Start with a {cold.baselineMinutes}-minute baseline
        </h2>
        <p className="muted small" style={{ marginTop: 6, maxWidth: 620 }}>
          {labs.length === 1 ? 'One short lab' : `${labs.length} short labs`} across the most heavily weighted {fwName} domains. Your results replace the defaults on this page with real estimates, and the plan adjusts to them.
        </p>
        <ol className="baseline-list">
          {labs.map((l, i) => {
            const tag = l.frameworks?.find((t) => framework && t.startsWith(`${framework.id}:`));
            return (
              <li key={l.id}>
                <Link to="/labs/$labId" params={{ labId: l.id }} className="baseline-row">
                  <span className="baseline-step tnum">{i + 1}</span>
                  <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
                    <span className="small truncate">{l.title}</span>
                    <span className="xs subtle">
                      {tag ? `${fwName} · ${domainName(framework, tag)}` : domainLabel[l.domain]} · {formatMinutes(l.estimatedMinutes)}
                    </span>
                  </span>
                  <ArrowRight size={13} className="subtle" />
                </Link>
              </li>
            );
          })}
        </ol>
        <div className="row" style={{ gap: 10, marginTop: 16 }}>
          <Link to="/labs/$labId/work" params={{ labId: labs[0]!.id }} search={{}} className="btn btn-primary btn-lg">
            <Play size={14} /> Start baseline
          </Link>
          <span className="xs subtle">No score to beat: it only tells the plan where to begin.</span>
        </div>
      </Card>
    </section>
  );
}

function WeekPlan({ cold, labOf }: { cold: ColdStart; labOf: (id: string) => LabSummary | undefined }) {
  if (!cold.plan.length) return null;
  const total = cold.plan.reduce((a, p) => a + p.minutes, 0);
  return (
    <section aria-labelledby="week-plan">
      <Card className="card-flush">
        <div className="card-head">
          <h2 id="week-plan" className="row" style={{ gap: 8 }}>
            <CalendarDays size={15} className="subtle" /> Your first week
          </h2>
          <span className="subtle xs">{formatMinutes(total)} over {cold.plan.length} days</span>
        </div>
        <ol className="week-plan">
          {cold.plan.map((p) => {
            const lab = p.labId ? labOf(p.labId) : undefined;
            return (
              <li key={p.day} className="week-day">
                <span className="week-day-n xs subtle tnum">Day {p.day}</span>
                {lab ? (
                  <Link to="/labs/$labId" params={{ labId: lab.id }} className="small grow truncate link-strong">
                    {p.title}
                  </Link>
                ) : (
                  <span className="small grow truncate">{p.title}</span>
                )}
                <span className="xs subtle tnum">{formatMinutes(p.minutes)}</span>
              </li>
            );
          })}
        </ol>
      </Card>
    </section>
  );
}

function ReadinessNote({ goal, open }: { goal: GoalForecast; open?: boolean }) {
  const readyAt = pct(goal.readyAt ?? 0.75);
  const hours = Math.round((goal.minutesToReady ?? 0) / 60);
  return (
    <details className="card readiness-note" open={open}>
      <summary className="row small" style={{ gap: 8 }}>
        <Info size={14} className="subtle" /> How readiness is calculated
      </summary>
      <div className="stack small muted" style={{ gap: 8, marginTop: 10 }}>
        <p>Readiness is the exam-weighted average of your mastery of the skills each exam domain covers. A skill counts as 0 until a graded check (Validate) tells us something about it.</p>
        <p>Every result updates the estimate: passes on harder labs count more, hints count a little less, and estimates fade slowly without practice. We call {readyAt} exam-ready.</p>
        <p>
          The time plan is a planning estimate of about 40 hours of labs from zero to {readyAt}
          {goal.readiness > 0 ? ` (about ${hours} h left for you)` : ''}. It firms up as your results come in. Practice time runs from opening a lab to your last Validate.
        </p>
      </div>
    </details>
  );
}

/* --------------------------------------------------------------- goal card */

function GoalCard({ goal, plan, prefs, setPrefs, framework, fwName, cold, labOf }: { goal: GoalForecast; plan: Plan; prefs: PlanPrefs; setPrefs: (p: PlanPrefs) => void; framework: Framework | undefined; fwName: string; cold: boolean; labOf: (id: string) => LabSummary | undefined }) {
  const [editing, setEditing] = useState(false);
  const prior = goal.confidence !== 'estimate';
  const assessed = goal.perDomain.some((d) => (d.practisedSkills ?? (d.readiness > 0 ? 1 : 0)) > 0);
  const onPace = !prior && goal.weeklyMinutes >= plan.weeklyNeeded;
  const later = plan.tooTight ? dateFor(plan.minutesToReady, 45) : undefined;
  const targetIsPlan = plan.weeklyTarget === plan.weeklyNeeded;
  return (
    <Card className="card-flush">
      <div className="card-head">
        <h2>Goal: {fwName}</h2>
        <Link to="/skills" search={{ framework: goal.frameworkId }} className="link-quiet small">
          Skills <ArrowRight size={12} />
        </Link>
      </div>
      <div className="card-body stack" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 18, alignItems: 'center' }}>
          <Ring value={goal.readiness} size={68} stroke={6} label="Readiness" tone={assessed ? 'accent' : 'neutral'}>
            <span className="ring-value">{assessed ? pct(goal.readiness) : '–'}</span>
          </Ring>
          <div className="stack" style={{ gap: 3 }}>
            <strong className="small">{assessed ? `${pct(goal.readiness)} ready` : 'Not assessed yet'}</strong>
            <span className="xs muted">{assessed ? `${pct(goal.readyAt ?? 0.75)} counts as exam-ready` : 'Readiness starts with your first validated lab.'}</span>
          </div>
        </div>

        <div className="plan-box stack" style={{ gap: 8 }}>
          {plan.minutesToReady === 0 ? (
            <p className="small">You are at exam-ready level. Keep skills fresh with short reviews before {formatDate(plan.targetDate)}.</p>
          ) : (
            <p className="small">
              To be ready by <strong>{formatDate(plan.targetDate)}</strong> you'd need about <strong>{plan.dailyNeeded} min a day</strong> ({formatMinutes(plan.weeklyNeeded)} a week).
            </p>
          )}
          {!plan.dateChosen && <p className="xs muted">No exam date set: {formatDate(plan.targetDate)} is a placeholder.</p>}
          {!prior && plan.minutesToReady > 0 && (
            <p className="xs muted row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {onPace ? <Badge tone="ok">On pace</Badge> : <Badge tone="warn">Below pace</Badge>}
              <span>
                Your last four weeks: {formatMinutes(goal.weeklyMinutes)} a week{onPace ? `, ready around ${formatDate(goal.forecastReadyDate)}` : ''}.
              </span>
            </p>
          )}
          {prior && !cold && <p className="xs muted">Too few graded sessions ({goal.sessions ?? 0}) to forecast from your own pace yet.</p>}
          {later && <p className="xs muted">That is a lot to sustain. At about 45 min a day you would be ready by {formatDate(later)}; consider moving your exam.</p>}
          {editing ? (
            <form
              className="row"
              style={{ gap: 8, flexWrap: 'wrap' }}
              onSubmit={(e) => {
                e.preventDefault();
                const v = new FormData(e.currentTarget).get('date');
                if (typeof v === 'string' && v) setPrefs({ ...prefs, targetDate: v });
                setEditing(false);
              }}
            >
              <label className="xs muted row" style={{ gap: 6 }}>
                Exam date
                <input className="input" style={{ width: 150 }} type="date" name="date" defaultValue={plan.targetDate} min={new Date().toISOString().slice(0, 10)} required />
              </label>
              <button type="submit" className="btn btn-sm btn-secondary">
                Save
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          ) : (
            plan.minutesToReady > 0 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {!targetIsPlan && (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setPrefs({ ...prefs, weeklyTarget: plan.weeklyNeeded })}>
                    Set {formatMinutes(plan.weeklyNeeded)}/week as my target
                  </button>
                )}
                {later && (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setPrefs({ ...prefs, targetDate: later })}>
                    Move to {formatDate(later)}
                  </button>
                )}
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>
                  {plan.dateChosen ? 'Change date' : 'Set exam date'}
                </button>
              </div>
            )
          )}
          {targetIsPlan && <p className="xs subtle">Weekly target set to {formatMinutes(plan.weeklyNeeded)}; it shows at the top of the page.</p>}
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <div className="row-between xs subtle">
            <span>Exam domains, most to gain first</span>
            <span>weight</span>
          </div>
          <ul className="domain-readiness">
            {goal.perDomain.map((d) => {
              const fd = framework?.domains.find((x) => x.id === d.domainId);
              const weight = d.weight ?? fd?.weight ?? 0;
              const started = (d.practisedSkills ?? (d.readiness > 0 ? 1 : 0)) > 0;
              const lab = d.labId ? labOf(d.labId) : undefined;
              const body = (
                <>
                  <div className="row-between small" style={{ gap: 10 }}>
                    <span className="truncate">{fd?.name ?? d.domainId}</span>
                    <span className="row" style={{ gap: 8, flex: 'none' }}>
                      {d.delta7d !== 0 && <Delta value={d.delta7d} />}
                      <span className={started ? 'tnum' : 'xs subtle'} style={{ minWidth: 34, textAlign: 'right' }}>
                        {started ? pct(d.readiness) : 'not started'}
                      </span>
                      <span className="xs subtle tnum" style={{ width: 30, textAlign: 'right' }}>
                        {Math.round(weight * 100)}%
                      </span>
                    </span>
                  </div>
                  <Bar value={d.readiness} delta={d.delta7d} tone={d.readiness < 0.45 ? 'neutral' : 'accent'} thin />
                  {lab && (
                    <span className="xs subtle truncate domain-next">
                      Next: {lab.title} · {formatMinutes(lab.estimatedMinutes)}
                    </span>
                  )}
                </>
              );
              return (
                <li key={d.domainId}>
                  {lab ? (
                    <Link to="/labs/$labId" params={{ labId: lab.id }} className="domain-row domain-row-link">
                      {body}
                    </Link>
                  ) : (
                    <div className="domain-row">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        {!cold && <ReadinessNote goal={goal} />}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------- recommendations */

function SuccessStat({ rec }: { rec: Recommendation }) {
  if (rec.confidence === 'prior') return <Stat label="Chance to pass" value="No data yet" hint="your first attempt sets it" />;
  const s = rec.predictedSuccess;
  return <Stat label="Chance to pass" value={pct(s)} hint={s < 0.6 ? 'a stretch for you' : s > 0.8 ? 'comfortable' : 'right in your learning zone'} />;
}

function HeroRecommendation({ rec, lab, framework, frameworks }: { rec: Recommendation; lab: LabSummary | undefined; framework: Framework | undefined; frameworks: Framework[] | undefined }) {
  if (!lab) return null;
  const fwName = framework?.name ?? '';
  const covers = rec.goalDomainIds?.length ?? 0;
  const tags = { goal: (rec.goalDomainIds ?? []).map((id) => domainName(framework, id)), also: examTags(lab, framework, frameworks).also };
  return (
    <Card className="hero">
      <div className="hero-main">
        <div style={{ marginBottom: 10 }}>
          <LabMeta lab={lab}>
            {tags.goal.map((t) => (
              <span key={t}>
                {fwName} · {t}
              </span>
            ))}
            {tags.also.length > 0 && <span>also {tags.also.join(', ')}</span>}
          </LabMeta>
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
            <Play size={14} /> Start lab
          </Link>
          <Link to="/labs/$labId" params={{ labId: lab.id }} className="btn btn-ghost btn-lg">
            Details
          </Link>
        </div>
      </div>
      <div className="hero-side">
        <Stat label={`${fwName} readiness`} value={gainLabel(rec.readinessGain)} hint="if you pass" />
        <SuccessStat rec={rec} />
        {framework && <Stat label="Covers" value={`${covers} of ${framework.domains.length}`} hint={`${fwName} domains`} />}
      </div>
    </Card>
  );
}

function RecommendationCard({ rec, lab, framework }: { rec: Recommendation; lab: LabSummary | undefined; framework: Framework | undefined }) {
  if (!lab) return null;
  const fwName = framework?.name ?? '';
  const domains = (rec.goalDomainIds ?? []).map((id) => domainName(framework, id));
  // The goal reason is what the domain chip already says; show the next one.
  const why = rec.reasons.filter((r) => r.kind !== 'goal' && r.kind !== 'prereq').slice(0, 1);
  return (
    <Link to="/labs/$labId" params={{ labId: lab.id }} className="card card-interactive stack" style={{ gap: 10 }}>
      <LabMeta lab={lab} />
      <h3 style={{ lineHeight: 1.35 }}>{lab.title}</h3>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {domains.length ? (
          domains.slice(0, 2).map((d) => (
            <Badge key={d} tone="outline">
              {d}
            </Badge>
          ))
        ) : (
          <Badge tone="outline">Outside {fwName}</Badge>
        )}
      </div>
      {rec.buildsOn && (
        <div className="xs muted row" style={{ gap: 6 }}>
          <Route size={12} /> Builds on {rec.buildsOn.title}
        </div>
      )}
      {why.length > 0 && <ReasonList reasons={why} />}
      <div className="row-between xs subtle" style={{ marginTop: 'auto', paddingTop: 6 }}>
        <span>{(rec.readinessGain ?? 0) > 0 ? `${gainLabel(rec.readinessGain)} ${fwName} readiness` : ''}</span>
        <span>{rec.confidence === 'prior' ? 'no data yet' : `${pct(rec.predictedSuccess)} to pass`}</span>
      </div>
    </Link>
  );
}

/* ---------------------------------------------------------------- activity */

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
        {labTitle && a.labId && !a.text.includes(labTitle) && (
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

