import { Link } from '@tanstack/react-router';
import { ChevronLeft, Clock, Lightbulb, Play, Tag } from 'lucide-react';
import { useCatalog, useLab, useSkills } from '@/api/client';
import { DifficultyBadge, DomainIcon, DriverIcon, SkillTags, domainLabel, driverLabel } from '@/components/domain';
import { Prose } from '@/components/prose';
import { Badge, Card, ErrorState, PageSkeleton, Stat } from '@/components/ui';
import { TopologyCanvas } from '@/components/workspace/Topology';
import { labRoute } from '@/router';
import { personalize } from '@/lib/personalize';
import { frameworkDomainLabel } from '@/lib/readiness';
import { formatMinutes, titleCase } from '@/lib/utils';

export function LabOverview() {
  const { labId } = labRoute.useParams();
  const lab = useLab(labId);
  const catalog = useCatalog();
  const skills = useSkills();

  if (lab.isPending) {
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  }
  if (lab.isError) {
    return (
      <div className="page page-narrow">
        <ErrorState title="Lab unavailable" error={lab.error} onRetry={() => void lab.refetch()} />
      </div>
    );
  }
  // Params are drawn per attempt; until then they read as ‹name›.
  const { metadata, spec } = personalize(lab.data);
  const summary = catalog.data?.labs.find((l) => l.id === metadata.id);
  const resume = summary?.completion === 'in-progress';
  const hintCost = (spec.hints ?? []).reduce((a, h) => a + (h.cost ?? 1), 0);
  const skillIds = Array.from(new Set(spec.checks.flatMap((c) => c.skills)));

  return (
    <div className="page">
      <Link to="/catalog" search={{ domain: metadata.domain }} className="link-quiet small row" style={{ gap: 4, marginBottom: 14, display: 'inline-flex' }}>
        <ChevronLeft size={13} /> {domainLabel[metadata.domain]}
      </Link>
      <header className="page-header" style={{ alignItems: 'flex-start' }}>
        <div style={{ maxWidth: 720 }}>
          <div className="row xs subtle" style={{ gap: 10, marginBottom: 8 }}>
            <span className="row" style={{ gap: 5 }}>
              <DomainIcon domain={metadata.domain} size={12} /> {domainLabel[metadata.domain]}
            </span>
            <DifficultyBadge difficulty={metadata.difficulty} />
            <span className="row" style={{ gap: 4 }}>
              <Clock size={11} /> {formatMinutes(metadata.estimatedMinutes)}
            </span>
            <span className="mono">
              {metadata.id}
              {metadata.version ? ` · v${metadata.version}` : ''}
            </span>
          </div>
          <h1>{metadata.title}</h1>
          <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {metadata.frameworks?.map((f) => (
              <Badge key={f} tone="outline" title={f}>
                {frameworkDomainLabel(f, skills.data?.frameworks)}
              </Badge>
            ))}
            {metadata.tags?.map((t) => (
              <Badge key={t}>
                <Tag size={10} /> {t}
              </Badge>
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {summary?.completion === 'completed' && <Badge tone="ok">Best {summary.bestScore} / 100</Badge>}
          <Link to="/labs/$labId/work" params={{ labId: metadata.id }} search={{}} className="btn btn-primary btn-lg">
            <Play size={14} /> {resume ? 'Resume lab' : 'Start lab'}
          </Link>
        </div>
      </header>

      <div className="split split-8-4">
        <div className="stack" style={{ gap: 20 }}>
          <Card>
            <h2 style={{ marginBottom: 12 }}>Scenario</h2>
            <Prose text={spec.description} />
            {spec.objectives && spec.objectives.length > 0 && (
              <>
                <h3 style={{ marginTop: 20, marginBottom: 8 }}>Objectives</h3>
                <ol className="objectives">
                  {spec.objectives.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ol>
              </>
            )}
          </Card>

          <Card className="card-flush">
            <div className="card-head">
              <h2>Topology</h2>
              <span className="subtle xs">
                {spec.topology.nodes.length} nodes · {spec.topology.links?.length ?? 0} links · entry on {spec.topology.entry ?? spec.topology.nodes[0]?.name}
              </span>
            </div>
            <div style={{ height: 230 }}>
              <TopologyCanvas topology={spec.topology} readOnly />
            </div>
          </Card>

          <Card className="card-flush">
            <div className="card-head">
              <h2>Checks</h2>
              <span className="subtle xs">
                {spec.checks.length} checks · graded out-of-band · weights shown
              </span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Type</th>
                  <th>Skills</th>
                  <th style={{ textAlign: 'right' }}>Weight</th>
                </tr>
              </thead>
              <tbody>
                {spec.checks.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="small">{c.description}</div>
                      <div className="xs subtle mono">{c.id}</div>
                    </td>
                    <td className="mono xs muted">{c.type}</td>
                    <td>
                      <SkillTags ids={c.skills} size="xs" />
                    </td>
                    <td className="tnum" style={{ textAlign: 'right' }}>
                      {c.weight ?? 1}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <Card className="card-flush">
            <div className="card-head">
              <h2>Nodes</h2>
              <span className="subtle xs">isolated VPC per session</span>
            </div>
            <ul className="node-list" style={{ borderTop: 0 }}>
              {spec.topology.nodes.map((n) => (
                <li key={n.name} className="node-list-row">
                  <DriverIcon driver={n.driver} size={14} className="muted" />
                  <span className="mono small grow truncate">{n.name}</span>
                  <span className="xs subtle">
                    {driverLabel[n.driver]}
                    {n.cluster?.nodes ? ` · ${n.cluster.nodes.length} nodes` : n.cluster?.mode ? ` · ${n.cluster.mode}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="grid-2" style={{ gap: 18 }}>
              <Stat label="Hints" value={spec.hints?.length ?? 0} hint={hintCost ? `up to −${hintCost * 4} points` : 'none'} />
              <Stat label="Skills" value={skillIds.length} hint={titleCase(metadata.domain)} />
            </div>
            <div style={{ marginTop: 16 }}>
              <SkillTags ids={skillIds} max={8} />
            </div>
            {spec.hints && spec.hints.length > 0 && (
              <p className="xs subtle row" style={{ gap: 6, marginTop: 14 }}>
                <Lightbulb size={12} /> Hints cost points; the first is usually cheap.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
