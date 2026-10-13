import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Info, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { useCatalog, useSkills } from '@/api/client';
import type { FrameworkId, Skill, SkillState } from '@/api/types';
import { HeatCell, Ring } from '@/components/charts';
import { DifficultyBadge } from '@/components/domain';
import { Badge, Card, EmptyState, ErrorState, PageSkeleton, Segmented, Stat } from '@/components/ui';
import { skillsRoute } from '@/router';
import { formatMinutes, pct, relativeTime } from '@/lib/utils';

export function Skills() {
  const search = skillsRoute.useSearch();
  const navigate = useNavigate({ from: skillsRoute.fullPath });
  const skills = useSkills();
  const catalog = useCatalog();

  const data = skills.data;
  const framework = data?.frameworks.find((f) => f.id === search.framework);
  const stateOf = useMemo(() => new Map(data?.states.map((s) => [s.skillId, s]) ?? []), [data]);
  const skillOf = useMemo(() => new Map(data?.skills.map((s) => [s.id, s]) ?? []), [data]);

  const summary = useMemo(() => {
    if (!framework) return null;
    let weighted = 0;
    let practised = 0;
    let total = 0;
    let maxSigma: SkillState | undefined;
    for (const d of framework.domains) {
      const states = d.skillIds.map((id) => stateOf.get(id)).filter((x): x is SkillState => !!x);
      const mean = states.length ? states.reduce((a, s) => a + s.mu, 0) / states.length : 0;
      weighted += mean * d.weight;
      total += states.length;
      practised += states.filter((s) => s.evidence > 0).length;
      for (const s of states) if (!maxSigma || s.sigma > maxSigma.sigma) maxSigma = s;
    }
    return { readiness: weighted, practised, total, maxSigma };
  }, [framework, stateOf]);

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

  const selected = search.skill ? skillOf.get(search.skill) : undefined;
  const selectedState = search.skill ? stateOf.get(search.skill) : undefined;
  const select = (id?: string) => void navigate({ search: (prev) => ({ ...prev, skill: id === prev.skill ? undefined : id }), replace: true });

  return (
    <div className="page page-wide">
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Skills</div>
          <h1>{framework?.fullName}</h1>
          <p className="muted">Per-skill mastery estimate (μ) with uncertainty (σ). Darker is stronger; a dashed ring means the estimate is still uncertain.</p>
        </div>
        <Segmented<FrameworkId> label="Framework" value={search.framework} onChange={(v) => void navigate({ search: { framework: v } })} options={data.frameworks.map((f) => ({ value: f.id, label: f.name, title: f.fullName }))} />
      </header>

      {framework && summary && (
        <div className="skills-layout">
          <div className="stack" style={{ gap: 20, minWidth: 0 }}>
            <Card className="row" style={{ gap: 40, padding: '18px 24px' }}>
              <div className="row" style={{ gap: 14 }}>
                <Ring value={summary.readiness} size={52} stroke={5} label="Weighted readiness">
                  <span className="ring-value" style={{ fontSize: 11 }}>
                    {pct(summary.readiness)}
                  </span>
                </Ring>
                <Stat label="Weighted readiness" value={pct(summary.readiness)} hint="exam-weight × mean μ" />
              </div>
              <Stat label="Skills practised" value={`${summary.practised} / ${summary.total}`} hint={`${summary.total - summary.practised} with no evidence`} />
              <Stat label="Most uncertain" value={<span className="stat-value-sm">{summary.maxSigma ? (skillOf.get(summary.maxSigma.skillId)?.name ?? '—') : '—'}</span>} hint={summary.maxSigma ? `σ ${summary.maxSigma.sigma.toFixed(2)} · one lab would sharpen it` : undefined} />
              <div className="grow" />
              <div className="heat-legend" aria-hidden>
                <span className="xs subtle">0</span>
                {[0.1, 0.3, 0.5, 0.7, 0.9].map((v) => (
                  <HeatCell key={v} value={v} className="heat-legend-cell" />
                ))}
                <span className="xs subtle">1</span>
                <span className="xs subtle" style={{ marginLeft: 10 }}>
                  <span className="heat heat-legend-cell" style={{ display: 'inline-grid', verticalAlign: 'middle' }}>
                    <span className="heat-uncertain" />
                  </span>{' '}
                  uncertain
                </span>
              </div>
            </Card>

            <Card className="card-flush">
              <div className="heatmap" role="grid" aria-label={`${framework.name} skill heatmap`}>
                {framework.domains.map((d) => {
                  const states = d.skillIds.map((id) => stateOf.get(id)).filter((x): x is SkillState => !!x);
                  const mean = states.length ? states.reduce((a, s) => a + s.mu, 0) / states.length : 0;
                  return (
                    <div key={d.id} className="heat-row" role="row">
                      <div className="heat-rowhead" role="rowheader">
                        <div className="small truncate" title={d.name}>
                          {d.name}
                        </div>
                        <div className="xs subtle row" style={{ gap: 8 }}>
                          <span>{Math.round(d.weight * 100)}% of exam</span>
                          <span className="tnum">μ {mean.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="heat-cells" role="presentation">
                        {d.skillIds.map((id) => {
                          const sk = skillOf.get(id);
                          const st = stateOf.get(id);
                          if (!sk || !st) return null;
                          return (
                            <HeatCell key={id} value={st.mu} sigma={st.sigma} onClick={() => select(id)} selected={search.skill === id} aria-label={`${sk.name}: mastery ${pct(st.mu)}, uncertainty ${st.sigma.toFixed(2)}`} title={`${sk.name} · μ ${st.mu.toFixed(2)} σ ${st.sigma.toFixed(2)}`}>
                              <span className="heat-name">{sk.name}</span>
                              <span className="heat-mu tnum">{st.evidence ? st.mu.toFixed(2) : '·'}</span>
                            </HeatCell>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
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
                <p>Each graded check is evidence for its tagged skills. Mastery μ moves like a rating; σ shrinks with evidence and grows with time since practice.</p>
                <p>Recommendations prefer labs where you are 60–80% likely to succeed and where σ is high, because those attempts teach the model (and you) the most.</p>
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
          <div className="xs subtle mono">{skill.id}</div>
        </div>
        <Badge tone={state.trend === 'down' ? 'warn' : state.trend === 'up' ? 'ok' : 'neutral'}>
          {trendIcon} {trendLabel}
        </Badge>
      </div>
      <div className="card-body stack" style={{ gap: 18 }}>
        <div className="row" style={{ gap: 16 }}>
          <Ring value={state.mu} size={68} stroke={6} label="Mastery">
            <span className="ring-value">{state.mu.toFixed(2)}</span>
          </Ring>
          <div className="stack grow" style={{ gap: 10 }}>
            <div className="row-between small">
              <span className="muted">Uncertainty σ</span>
              <span className="tnum">{state.sigma.toFixed(2)}</span>
            </div>
            <div className="meter meter-thin">
              <div className="meter-fill meter-neutral" style={{ width: `${Math.min(1, state.sigma / 0.5) * 100}%` }} />
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
          Credible range {Math.max(0, state.mu - state.sigma).toFixed(2)} – {Math.min(1, state.mu + state.sigma).toFixed(2)}.{' '}
          {state.sigma > 0.3 ? 'Too uncertain to count toward readiness; one attempt would move this a lot.' : state.sigma > 0.18 ? 'Moderately certain; a review attempt would tighten it.' : 'Well established.'}
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

