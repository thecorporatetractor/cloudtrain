import { Link } from '@tanstack/react-router';
import * as Collapsible from '@radix-ui/react-collapsible';
import { Check, ChevronDown, ChevronLeft, CircleDashed, Loader2, Minus, Rocket, ShieldCheck, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useDraft, useDraftAction } from '@/api/client';
import type { GateStatus, VerificationGate } from '@/api/types';
import { RequireAccess } from '@/app/access';
import { useShell } from '@/app/shell-context';
import { DifficultyBadge, DomainIcon, DriverIcon, SkillTags, domainLabel } from '@/components/domain';
import { Prose } from '@/components/prose';
import { Badge, Button, Card, ErrorState, PageSkeleton } from '@/components/ui';
import { TopologyCanvas } from '@/components/workspace/Topology';
import { studioDraftRoute } from '@/router';
import { cn, formatDuration, formatMinutes, relativeTime } from '@/lib/utils';
import { STAGES } from './Studio';

export function StudioDraft() {
  return (
    <RequireAccess path="/studio">
      <StudioDraftScreen />
    </RequireAccess>
  );
}

function StudioDraftScreen() {
  const { draftId } = studioDraftRoute.useParams();
  const draft = useDraft(draftId);
  const act = useDraftAction(draftId);
  const { toast } = useShell();

  if (draft.isPending) {
    return (
      <div className="page">
        <PageSkeleton />
      </div>
    );
  }
  if (draft.isError) {
    return (
      <div className="page page-narrow">
        <ErrorState title="Draft unavailable" error={draft.error} onRetry={() => void draft.refetch()} />
      </div>
    );
  }
  const d = draft.data;
  const spec = d.spec;
  const stageIdx = STAGES.findIndex((s) => s.id === d.stage);
  const failed = d.gates.filter((g) => g.status === 'failed');
  const passed = d.gates.filter((g) => g.status === 'passed').length;
  const canVerify = d.stage === 'spec' || (d.stage === 'verify' && failed.length > 0);
  const canPublish = d.stage === 'review';

  return (
    <div className="page">
      <Link to="/studio" className="link-quiet small row" style={{ gap: 4, marginBottom: 14, display: 'inline-flex' }}>
        <ChevronLeft size={13} /> Scenario Studio
      </Link>
      <header className="page-header" style={{ alignItems: 'flex-start' }}>
        <div style={{ maxWidth: 720 }}>
          <div className="row xs subtle" style={{ gap: 10, marginBottom: 8 }}>
            {spec && (
              <>
                <span className="row" style={{ gap: 5 }}>
                  <DomainIcon domain={spec.metadata.domain} size={12} /> {domainLabel[spec.metadata.domain]}
                </span>
                <DifficultyBadge difficulty={spec.metadata.difficulty} />
                <span>{formatMinutes(spec.metadata.estimatedMinutes)}</span>
              </>
            )}
            <span>
              {d.author} · {relativeTime(d.createdAt)}
            </span>
          </div>
          <h1>{d.title}</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {canVerify && (
            <Button variant={failed.length ? 'secondary' : 'primary'} icon={<ShieldCheck size={14} />} loading={act.isPending} onClick={() => act.mutate('verify', { onSuccess: () => toast({ title: 'Verification started', description: 'Seven gates run on the verifier pool.', tone: 'neutral' }) })}>
              {failed.length ? 'Re-run verification' : 'Run verification'}
            </Button>
          )}
          {canPublish && (
            <Button variant="primary" icon={<Rocket size={14} />} loading={act.isPending} onClick={() => act.mutate('publish', { onSuccess: (r) => toast({ title: 'Published to pilot', description: `${r.pilot?.cohort} · ${r.pilot?.learners} learners`, tone: 'ok' }) })}>
              Publish to pilot
            </Button>
          )}
        </div>
      </header>

      <ol className="stepper" aria-label="Pipeline">
        {STAGES.map((s, i) => {
          const state = i < stageIdx ? 'done' : i === stageIdx ? 'current' : 'todo';
          return (
            <li key={s.id} className={cn('step', `step-${state}`, s.id === 'verify' && state === 'current' && failed.length > 0 && 'step-failed')}>
              <span className="step-dot">{state === 'done' ? <Check size={11} /> : s.id === 'verify' && state === 'current' && failed.length ? <X size={11} /> : null}</span>
              <span className="step-label">{s.label}</span>
              {s.id === 'verify' && (
                <span className="xs subtle tnum">
                  {passed}/{d.gates.length}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="split split-7-5">
        <div className="stack" style={{ gap: 20 }}>
          <Card className="card-flush">
            <div className="card-head">
              <h2>Verification gates</h2>
              <span className="subtle xs">{d.stage === 'verify' && d.gates.some((g) => g.status === 'running') ? 'running on verifier pool vp-2' : d.stage === 'spec' ? 'not run yet' : `${passed} of ${d.gates.length} passed`}</span>
            </div>
            <ol className="gates">
              {d.gates.map((g) => (
                <GateRow key={g.id} gate={g} />
              ))}
            </ol>
          </Card>

          {d.diff && (
            <Card className="card-flush">
              <div className="card-head">
                <h2>Review changes</h2>
                <span className="subtle xs">
                  +{d.diff.filter((l) => l.kind === 'add').length} −{d.diff.filter((l) => l.kind === 'del').length}
                </span>
              </div>
              <pre className="diff" aria-label="Unified diff of the lab spec">
                {d.diff.map((l, i) => (
                  <div key={i} className={cn('diff-line', `diff-${l.kind}`)}>
                    <span className="diff-sign" aria-hidden>
                      {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
                    </span>
                    {l.text}
                  </div>
                ))}
              </pre>
            </Card>
          )}

          {d.pilot && (
            <Card className="row" style={{ gap: 14 }}>
              <span className="state-icon" style={{ margin: 0 }}>
                <Rocket size={18} />
              </span>
              <div className="stack grow" style={{ gap: 2 }}>
                <div className="small" style={{ fontWeight: 500 }}>
                  In pilot with {d.pilot.cohort}
                </div>
                <div className="xs subtle">
                  {d.pilot.learners} learners · started {relativeTime(d.pilot.startedAt)} · difficulty will be calibrated from their attempts before general publication
                </div>
              </div>
              <Badge tone="ok">Pilot</Badge>
            </Card>
          )}
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <Card className="card-flush">
            <div className="card-head">
              <h2>Generated spec</h2>
              {spec && <span className="subtle xs mono">{spec.metadata.id}</span>}
            </div>
            {spec ? (
              <div className="card-body stack" style={{ gap: 18 }}>
                <div>
                  <div className="xs subtle" style={{ marginBottom: 6 }}>
                    Prompt
                  </div>
                  <p className="small muted" style={{ fontStyle: 'italic' }}>
                    “{d.prompt}”
                  </p>
                </div>
                <div>
                  <div className="xs subtle" style={{ marginBottom: 6 }}>
                    Task statement
                  </div>
                  <Prose text={spec.spec.description} className="small" />
                </div>
                <div>
                  <div className="xs subtle" style={{ marginBottom: 6 }}>
                    Topology
                  </div>
                  <div style={{ height: 210, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                    <TopologyCanvas topology={spec.spec.topology} readOnly compact />
                  </div>
                  <ul className="node-list" style={{ borderTop: 0 }}>
                    {spec.spec.topology.nodes.map((n) => (
                      <li key={n.name} className="node-list-row" style={{ padding: '6px 0' }}>
                        <DriverIcon driver={n.driver} size={13} className="muted" />
                        <span className="mono xs grow">{n.name}</span>
                        <span className="xs subtle">{n.image}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="xs subtle" style={{ marginBottom: 6 }}>
                    Checks ({spec.spec.checks.length})
                  </div>
                  <ul className="stack" style={{ gap: 8 }}>
                    {spec.spec.checks.map((c) => (
                      <li key={c.id} className="stack" style={{ gap: 3 }}>
                        <span className="row small" style={{ gap: 8 }}>
                          <span className="mono xs muted">{c.type}</span>
                          <span className="grow">{c.description}</span>
                          <span className="xs subtle tnum">×{c.weight ?? 1}</span>
                        </span>
                        <SkillTags ids={c.skills} size="xs" />
                      </li>
                    ))}
                  </ul>
                </div>
                {spec.spec.hints && spec.spec.hints.length > 0 && (
                  <div>
                    <div className="xs subtle" style={{ marginBottom: 6 }}>
                      Hints ({spec.spec.hints.length})
                    </div>
                    {spec.spec.hints.map((h, i) => (
                      <div key={i} className="small">
                        <strong>{h.title}</strong> <span className="subtle xs">−{h.cost ?? 1}</span>
                        <div className="muted">{h.body}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="card-body small muted">The planner has not produced a spec yet.</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

const gateIcon: Record<GateStatus, ReactNode> = {
  pending: <CircleDashed size={13} />,
  running: <Loader2 size={13} className="spin" />,
  passed: <Check size={13} />,
  failed: <X size={13} />,
  skipped: <Minus size={13} />,
};

function GateRow({ gate }: { gate: VerificationGate }) {
  const hasItems = gate.items.length > 0;
  return (
    <li className={cn('gate', `gate-${gate.status}`)}>
      <Collapsible.Root defaultOpen={gate.status === 'failed'}>
        <div className="gate-head">
          <span className="gate-icon" aria-hidden>
            {gateIcon[gate.status]}
          </span>
          <span className="stack grow" style={{ gap: 2, minWidth: 0 }}>
            <span className="row small" style={{ gap: 8 }}>
              <span style={{ fontWeight: 500 }}>{gate.name}</span>
              <span className={cn('xs', gate.status === 'failed' ? 'text-err' : gate.status === 'passed' ? 'text-ok' : 'subtle')}>{gate.status}</span>
            </span>
            <span className="xs subtle">{gate.description}</span>
          </span>
          {gate.durationSec !== undefined && <span className="xs subtle tnum">{formatDuration(gate.durationSec)}</span>}
          {hasItems && (
            <Collapsible.Trigger asChild>
              <button className="btn btn-ghost btn-sm btn-icon gate-toggle" aria-label="Toggle details">
                <ChevronDown size={14} />
              </button>
            </Collapsible.Trigger>
          )}
        </div>
        {hasItems && (
          <Collapsible.Content>
            <ul className="gate-items">
              {gate.items.map((it, i) => (
                <li key={i} className="gate-item">
                  <span className={cn('gate-item-icon', `gate-${it.status}`)}>{gateIcon[it.status]}</span>
                  <span className="mono xs">{it.label}</span>
                  {it.detail && <span className="xs muted">— {it.detail}</span>}
                </li>
              ))}
            </ul>
          </Collapsible.Content>
        )}
      </Collapsible.Root>
    </li>
  );
}
