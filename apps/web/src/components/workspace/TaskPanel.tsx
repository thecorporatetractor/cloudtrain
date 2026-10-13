import * as Collapsible from '@radix-ui/react-collapsible';
import { Check, ChevronDown, CircleDashed, Lightbulb, Loader2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CheckResult, Lab, LabSession } from '@/api/types';
import { SkillTags } from '@/components/domain';
import { Prose } from '@/components/prose';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Props {
  lab: Lab;
  session: LabSession | undefined;
  validating: boolean;
  onRevealHint: (index: number) => void;
  revealing: boolean;
}

const resultIcon: Record<CheckResult['status'], ReactNode> = {
  pass: <Check size={12} />,
  fail: <X size={12} />,
  error: <X size={12} />,
  pending: <CircleDashed size={12} />,
};

export function TaskPanel({ lab, session, validating, onRevealHint, revealing }: Props) {
  const { spec } = lab;
  const results = new Map(session?.results.map((r) => [r.checkId, r]) ?? []);
  const passed = spec.checks.filter((c) => results.get(c.id)?.status === 'pass').length;
  const totalWeight = spec.checks.reduce((a, c) => a + (c.weight ?? 1), 0);

  return (
    <div className="task">
      <section className="task-section">
        <h2 className="task-h">Task</h2>
        <Prose text={spec.description} className="small" />
      </section>

      {spec.objectives && spec.objectives.length > 0 && (
        <section className="task-section">
          <h2 className="task-h">Objectives</h2>
          <ol className="objectives">
            {spec.objectives.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ol>
        </section>
      )}

      <section className="task-section" aria-live="polite">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <h2 className="task-h" style={{ margin: 0 }}>
            Checks
          </h2>
          <span className="xs subtle tnum">
            {passed} / {spec.checks.length} passing
          </span>
        </div>
        <ul className="checks">
          {spec.checks.map((c) => {
            const r = results.get(c.id);
            const status = validating ? 'running' : (r?.status ?? 'pending');
            return (
              <li key={c.id} className={cn('check', `check-${status}`)}>
                <Collapsible.Root>
                  <Collapsible.Trigger asChild>
                    <button className="check-head" aria-label={`${c.description}: ${status}`}>
                      <span className="check-icon" aria-hidden>
                        {status === 'running' ? <Loader2 size={12} className="spin" /> : resultIcon[status]}
                      </span>
                      <span className="check-desc grow">{c.description}</span>
                      <span className="xs subtle tnum" title="weight">
                        {Math.round(((c.weight ?? 1) / totalWeight) * 100)}%
                      </span>
                      <ChevronDown size={13} className="check-chev subtle" aria-hidden />
                    </button>
                  </Collapsible.Trigger>
                  <Collapsible.Content>
                    <div className="check-detail">
                      <div className="row xs subtle" style={{ gap: 8 }}>
                        <span className="mono">{c.id}</span>
                        <span>·</span>
                        <span className="mono">{c.type}</span>
                        {r?.durationMs !== undefined && (
                          <>
                            <span>·</span>
                            <span className="tnum">{r.durationMs} ms</span>
                          </>
                        )}
                      </div>
                      {r?.message && r.status !== 'pending' && <div className={cn('xs', r.status === 'pass' ? 'text-ok' : 'text-err')}>{r.message}</div>}
                      {r?.observed && <pre className="check-observed">{r.observed}</pre>}
                      <SkillTags ids={c.skills} size="xs" />
                    </div>
                  </Collapsible.Content>
                </Collapsible.Root>
              </li>
            );
          })}
        </ul>
      </section>

      {spec.hints && spec.hints.length > 0 && (
        <section className="task-section">
          <div className="row-between" style={{ marginBottom: 8 }}>
            <h2 className="task-h" style={{ margin: 0 }}>
              Hints
            </h2>
            <span className="xs subtle">each costs points</span>
          </div>
          <ul className="hints">
            {spec.hints.map((h, i) => {
              const revealed = session?.revealedHints.includes(i) ?? false;
              const locked = i > 0 && !(session?.revealedHints.includes(i - 1) ?? false);
              return (
                <li key={i} className={cn('hint', revealed && 'is-revealed')}>
                  <div className="row-between" style={{ gap: 8 }}>
                    <span className="row small" style={{ gap: 7, minWidth: 0 }}>
                      <Lightbulb size={13} className={revealed ? 'text-warn' : 'subtle'} />
                      <span className={cn('truncate', !revealed && 'muted')}>
                        {revealed ? h.title : `Hint ${i + 1}`}
                      </span>
                    </span>
                    {revealed ? (
                      <Badge tone="neutral">−{(h.cost ?? 1) * 4} pts</Badge>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={locked || !session || revealing} onClick={() => onRevealHint(i)} title={locked ? 'Reveal the previous hint first' : undefined}>
                        Reveal · −{(h.cost ?? 1) * 4}
                      </Button>
                    )}
                  </div>
                  {revealed && (
                    <div className="hint-body">
                      <Prose text={h.body} className="small" />
                      {h.command && <code className="hint-cmd">{h.command}</code>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
