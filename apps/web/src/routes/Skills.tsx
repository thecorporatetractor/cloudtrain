import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, ChevronLeft, Info, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { useCatalog, useSkills } from '@/api/client';
import type { FrameworkId, Skill, SkillState } from '@/api/types';
import { HeatCell, Ring } from '@/components/charts';
import { DifficultyBadge } from '@/components/domain';
import { FrameworkPicker } from '@/components/framework-picker';
import { Badge, Card, EmptyState, ErrorState, PageSkeleton, Stat } from '@/components/ui';
import { skillsRoute } from '@/router';
import { domainReadiness, frameworkReadiness } from '@/lib/readiness';
import { formatMinutes, pct, relativeTime } from '@/lib/utils';

export function Skills() {
  const search = skillsRoute.useSearch();
  const navigate = useNavigate({ from: skillsRoute.fullPath });
  const skills = useSkills(search.member);
  const catalog = useCatalog();

  const data = skills.data;
  // An unknown id in the URL (a framework that left the content) falls back to the first one.
  const framework = data?.frameworks.find((f) => f.id === search.framework) ?? data?.frameworks[0];
  const stateOf = useMemo(() => new Map(data?.states.map((s) => [s.skillId, s]) ?? []), [data]);
  // Readiness of every framework for the picker; null until a skill of it has results.
  const readinessById = useMemo(
    () =>
      new Map<FrameworkId, number | null>(
        (data?.frameworks ?? []).map((f) => {
          const r = frameworkReadiness(f, stateOf);
          return [f.id, r.practised > 0 ? r.readiness : null];
        }),
      ),
    [data, stateOf],
  );
  const skillOf = useMemo(() => new Map(data?.skills.map((s) => [s.id, s]) ?? []), [data]);

  // The same selector Home uses for its goal forecast, so the two screens agree.
  const summary = useMemo(() => (framework ? frameworkReadiness(framework, stateOf) : null), [framework, stateOf]);

  if (skills.isPending) {
    return (
      <div className="page page-wide">
        <PageSkeleton />
      </div>
    );
  }
  if (skills.isError || !data) {
    return (
      <div className="page">
        <ErrorState error={skills.error} onRetry={() => void skills.refetch()} />
      </div>
    );
  }

  const member = data.member;
  const assessed = !!summary && summary.practised > 0;
  // The practised skill with the least evidence (widest estimate); never a skill without results.
  const thinnest = summary?.perDomain.flatMap((d) => d.states).filter((st) => st.evidence > 0).sort((a, b) => b.sigma - a.sigma)[0];
  const selected = search.skill ? skillOf.get(search.skill) : undefined;
  const selectedState = search.skill ? stateOf.get(search.skill) : undefined;
  const select = (id?: string) => void navigate({ search: (prev) => ({ ...prev, skill: id === prev.skill ? undefined : id }), replace: true });

  return (
    <div className="page page-wide">
      {member && (
        <Link to="/team" className="link-quiet small row" style={{ gap: 4, marginBottom: 14, display: 'inline-flex' }}>
          <ChevronLeft size={13} /> Team
        </Link>
      )}
      <header className="page-header">
        <div>
          <div className="page-eyebrow">{member ? `Skills · ${member.name}` : 'Skills'}</div>
          <h1>{framework?.fullName}</h1>
          <p className="muted">
            {member ? `${member.name} (${member.title}): how well they know` : 'How well you know'} each skill, estimated from graded lab results. Darker is stronger; a dashed outline means there is little evidence yet.
          </p>
        </div>
        <FrameworkPicker frameworks={data.frameworks} value={framework?.id} readiness={readinessById} onChange={(v) => void navigate({ search: (prev) => ({ framework: v, ...(prev.member ? { member: prev.member } : {}) }) })} />
      </header>
      {framework && framework.coverage < 1 && (
        <p className="small subtle" style={{ marginTop: -8, marginBottom: 16 }}>
          Coverage in progress: published labs reach {pct(framework.coverage)} of this framework's objectives so far; the rest show no skills yet.
        </p>
      )}

      {framework && summary && (
        <div className="skills-layout">
          <div className="stack" style={{ gap: 20, minWidth: 0 }}>
            <Card className="skills-summary">
              <div className="row" style={{ gap: 14 }}>
                <Ring value={assessed ? summary.readiness : 0} size={52} stroke={5} label="Readiness" tone={assessed ? 'accent' : 'neutral'}>
                  <span className="ring-value" style={{ fontSize: 11 }}>
                    {assessed ? pct(summary.readiness) : '–'}
                  </span>
                </Ring>
                <Stat label="Readiness" value={assessed ? pct(summary.readiness) : 'Not assessed'} hint={assessed ? 'weighted by exam domain' : 'starts with the first validated lab'} />
              </div>
              <Stat label="Skills practised" value={`${summary.practised} / ${summary.total}`} hint={summary.practised ? `${summary.total - summary.practised} with no results yet` : 'no results yet'} />
              {assessed && thinnest && <Stat label="Least evidence" value={<span className="stat-value-sm">{skillOf.get(thinnest.skillId)?.name ?? '—'}</span>} hint="one lab would firm it up" />}
              <div className="grow" />
              <div className="heat-legend" aria-hidden>
                <span className="xs subtle">weaker</span>
                {[0.1, 0.3, 0.5, 0.7, 0.9].map((v) => (
                  <HeatCell key={v} value={v} className="heat-legend-cell" />
                ))}
                <span className="xs subtle">stronger</span>
                <span className="xs subtle" style={{ marginLeft: 10 }}>
                  <span className="heat heat-legend-cell" style={{ display: 'inline-grid', verticalAlign: 'middle' }}>
                    <span className="heat-uncertain" />
                  </span>{' '}
                  little evidence
                </span>
              </div>
            </Card>

            <Card className="card-flush">
              {/* Rows of buttons grouped by exam domain; not an ARIA grid, since there is no 2-D keyboard navigation. */}
              <div className="heatmap" aria-label={`${framework.name} skill heatmap`}>
                {framework.domains.map((d) => {
                  const { mean, states } = domainReadiness(d, stateOf);
                  const seen = states.some((st) => st.evidence > 0);
                  const headId = `heat-${d.id.replace(/[^a-z0-9]/gi, '-')}`;
                  return (
                    <div key={d.id} className="heat-row" role="group" aria-labelledby={headId}>
                      <div className="heat-rowhead">
                        <div className="small truncate" title={d.name} id={headId}>
                          {d.name}
                        </div>
                        <div className="xs subtle row" style={{ gap: 8 }}>
                          <span>{Math.round(d.weight * 100)}% of exam</span>
                          <span className="tnum">{seen ? pct(mean) : 'no data yet'}</span>
                        </div>
                      </div>
                      <div className="heat-cells">
                        {!d.skillIds.some((id) => skillOf.has(id) && stateOf.has(id)) && <span className="xs subtle" style={{ gridColumn: '1 / -1', alignSelf: 'center' }}>No labs for this objective yet.</span>}
                        {d.skillIds.map((id) => {
                          const sk = skillOf.get(id);
                          const st = stateOf.get(id);
                          if (!sk || !st) return null;
                          return (
                            <HeatCell key={id} value={st.evidence ? st.mu : 0} sigma={st.sigma} onClick={() => select(id)} selected={search.skill === id} aria-label={`${sk.name}: ${skillLabel(st)}`} title={`${sk.name} · ${skillLabel(st)}`}>
                              <span className="heat-name">{sk.name}</span>
                              <span className="heat-mu tnum">{st.evidence ? pct(st.mu) : '–'}</span>
                            </HeatCell>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
            {framework.disclaimer && <p className="xs subtle">{framework.disclaimer}</p>}
          </div>

          <aside className="skills-aside">
            {selected && selectedState ? (
              <SkillDetail skill={selected} state={selectedState} labs={catalog.data?.labs.filter((l) => l.skillIds.includes(selected.id)) ?? []} />
            ) : (
              <Card>
                <EmptyState compact icon={<Info size={18} />} title="Select a skill" description="Click any cell to see evidence, trend and the labs that train it." />
              </Card>
            )}
            <Card className="card-flush" style={{ marginTop: 16 }}>
              <div className="card-head">
                <h3>How estimates work</h3>
              </div>
              <div className="card-body stack small muted" style={{ gap: 8 }}>
                <p>Each graded check (Validate) is evidence for the skills it tests. Passes on harder labs count more, hints a little less, and an estimate becomes less certain without practice.</p>
                <p>A skill with no results yet shows no number: it is not a 0. Recommendations prefer labs you are likely, but not certain, to pass, and skills with little evidence, because those attempts tell you the most.</p>
              </div>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}

function SkillDetail({ skill, state, labs }: { skill: Skill; state: SkillState; labs: { id: string; title: string; difficulty: 'easy' | 'medium' | 'hard'; estimatedMinutes: number; completion?: string }[] }) {
  const trendIcon = state.trend === 'up' ? <TrendingUp size={13} /> : state.trend === 'down' ? <TrendingDown size={13} /> : <Minus size={13} />;
  const trendLabel = state.trend === 'up' ? 'Rising' : state.trend === 'down' ? 'Decaying' : 'Stable';
  return (
    <Card className="card-flush" aria-live="polite">
      <div className="card-head" style={{ alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 2 }}>
          <div className="xs subtle">{skill.competency}</div>
          <h3>{skill.name}</h3>
        </div>
        {state.evidence > 0 && (
          <Badge tone={state.trend === 'down' ? 'warn' : state.trend === 'up' ? 'ok' : 'neutral'}>
            {trendIcon} {trendLabel}
          </Badge>
        )}
      </div>
      <div className="card-body stack" style={{ gap: 18 }}>
        <div className="row" style={{ gap: 16 }}>
          <Ring value={state.evidence ? state.mu : 0} size={68} stroke={6} label="Mastery" tone={state.evidence ? 'accent' : 'neutral'}>
            <span className="ring-value">{state.evidence ? pct(state.mu) : '–'}</span>
          </Ring>
          <div className="stack grow" style={{ gap: 10 }}>
            <div className="row-between small">
              <span className="muted">Confidence</span>
              <span>{confidenceOf(state)}</span>
            </div>
            <div className="row-between small">
              <span className="muted">Evidence</span>
              <span className="tnum">{state.evidence} checks</span>
            </div>
            <div className="row-between small">
              <span className="muted">Last practised</span>
              <span>{state.lastPracticed ? relativeTime(state.lastPracticed) : 'never'}</span>
            </div>
          </div>
        </div>
        <div className="small muted">
          {state.evidence === 0
            ? 'No results for this skill yet, so there is no estimate. A lab below shows where you stand.'
            : `Likely between ${pct(Math.max(0, state.mu - state.sigma))} and ${pct(Math.min(1, state.mu + state.sigma))}. ${state.sigma > 0.3 ? 'Still uncertain; one more attempt would move this a lot.' : state.sigma > 0.18 ? 'Fairly certain; a review attempt would firm it up.' : 'Well established.'}`}
        </div>
        <div>
          <div className="xs subtle" style={{ marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Labs that train this
          </div>
          {labs.length === 0 ? (
            <p className="small subtle">No published lab targets this skill yet.</p>
          ) : (
            <ul className="stack" style={{ gap: 6 }}>
              {labs.map((l) => (
                <li key={l.id}>
                  <Link to="/labs/$labId" params={{ labId: l.id }} className="mini-lab">
                    <span className="small grow truncate">{l.title}</span>
                    <DifficultyBadge difficulty={l.difficulty} compact />
                    <span className="xs subtle tnum">{formatMinutes(l.estimatedMinutes)}</span>
                    <ArrowRight size={12} className="subtle" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Words, not the model's numbers. */
function confidenceOf(st: SkillState): string {
  if (!st.evidence) return 'no data yet';
  return st.sigma > 0.3 ? 'low' : st.sigma > 0.18 ? 'medium' : 'high';
}

function skillLabel(st: SkillState): string {
  return st.evidence ? `${pct(st.mu)} mastery, ${confidenceOf(st)} confidence` : 'no data yet';
}
