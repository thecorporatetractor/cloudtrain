import { Link } from '@tanstack/react-router';
import { Box, Boxes, CheckCircle2, Clock, Network, RotateCcw, Router, Server, Shuffle, Target, TerminalSquare, TrendingUp, type LucideProps } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSkills } from '@/api/client';
import type { Difficulty, Domain, LabSummary, NodeDriver, NodeStatus, Recommendation } from '@/api/types';
import { Badge, Dot, Tooltip } from '@/components/ui';
import { cn, formatMinutes, titleCase } from '@/lib/utils';

/* --------------------------------- Domain ---------------------------------- */

export function DomainIcon({ domain, ...rest }: { domain: Domain } & LucideProps) {
  if (domain === 'kubernetes') return <Boxes {...rest} />;
  if (domain === 'linux') return <TerminalSquare {...rest} />;
  return <Network {...rest} />;
}

export const domainLabel: Record<Domain, string> = { kubernetes: 'Kubernetes', linux: 'Linux', networking: 'Networking' };

/* -------------------------------- Difficulty -------------------------------- */

const diffLevel: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };

export function DifficultyBadge({ difficulty, compact }: { difficulty: Difficulty; compact?: boolean }) {
  return (
    <span className="difficulty" aria-label={`Difficulty: ${difficulty}`} title={titleCase(difficulty)}>
      <span className="difficulty-bars" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('difficulty-bar', i <= diffLevel[difficulty] && 'is-on')} />
        ))}
      </span>
      {!compact && <span>{titleCase(difficulty)}</span>}
    </span>
  );
}

/* ---------------------------------- Driver --------------------------------- */

export function DriverIcon({ driver, ...rest }: { driver: NodeDriver } & LucideProps) {
  if (driver === 'container') return <Box {...rest} />;
  if (driver === 'vm') return <Server {...rest} />;
  if (driver === 'k8s-cluster') return <Boxes {...rest} />;
  return <Router {...rest} />;
}

export const driverLabel: Record<NodeDriver, string> = { container: 'Container', vm: 'Virtual machine', 'k8s-cluster': 'Kubernetes cluster', netdev: 'Network device' };

export const nodeStatusTone: Record<NodeStatus, 'ok' | 'warn' | 'err' | 'neutral'> = { ready: 'ok', provisioning: 'warn', degraded: 'err', stopped: 'neutral' };

/* ---------------------------------- Skills --------------------------------- */

export function useSkillName() {
  const { data } = useSkills();
  return (id: string): string => data?.skills.find((s) => s.id === id)?.name ?? id.split('.').pop() ?? id;
}

export function SkillTags({ ids, max = 4, size = 'sm' }: { ids: string[]; max?: number; size?: 'sm' | 'xs' }) {
  const name = useSkillName();
  const shown = ids.slice(0, max);
  const rest = ids.length - shown.length;
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {shown.map((id) => (
        <span key={id} className={cn('skill-tag', size === 'xs' && 'skill-tag-xs')} title={id}>
          {name(id)}
        </span>
      ))}
      {rest > 0 && <span className="skill-tag subtle">+{rest}</span>}
    </span>
  );
}

/* --------------------------------- Lab row --------------------------------- */

export function CompletionBadge({ completion, score }: { completion?: LabSummary['completion']; score?: number }) {
  if (completion === 'completed') return <Badge tone="ok">{score !== undefined ? `${score} / 100` : 'Completed'}</Badge>;
  if (completion === 'in-progress') return <Badge tone="accent">In progress</Badge>;
  return <Badge tone="outline">New</Badge>;
}

export function LabRow({ lab, trailing }: { lab: LabSummary; trailing?: ReactNode }) {
  return (
    <Link to="/labs/$labId" params={{ labId: lab.id }} className="lab-row">
      <span className="lab-row-icon">
        <DomainIcon domain={lab.domain} size={15} />
      </span>
      <span className="stack grow" style={{ gap: 3, minWidth: 0 }}>
        <span className="lab-row-title truncate">{lab.title}</span>
        <span className="row xs subtle" style={{ gap: 10 }}>
          <DifficultyBadge difficulty={lab.difficulty} />
          <span className="row" style={{ gap: 4 }}>
            <Clock size={11} /> {formatMinutes(lab.estimatedMinutes)}
          </span>
          <SkillTags ids={lab.skillIds} max={3} size="xs" />
        </span>
      </span>
      {trailing ?? <CompletionBadge completion={lab.completion} score={lab.bestScore} />}
    </Link>
  );
}

/* ---------------------------------- Reasons --------------------------------- */

export const reasonMeta: Record<Recommendation['reasons'][number]['kind'], { icon: ReactNode; label: string }> = {
  goal: { icon: <Target size={13} />, label: 'Goal' },
  gain: { icon: <TrendingUp size={13} />, label: 'Mastery gain' },
  prereq: { icon: <CheckCircle2 size={13} />, label: 'Prerequisites' },
  review: { icon: <RotateCcw size={13} />, label: 'Review' },
  time: { icon: <Clock size={13} />, label: 'Time' },
  variety: { icon: <Shuffle size={13} />, label: 'Variety' },
};

export function ReasonList({ reasons }: { reasons: Recommendation['reasons'] }) {
  return (
    <ul className="reasons">
      {reasons.map((r, i) => (
        <li key={i} className="reason">
          <Tooltip content={reasonMeta[r.kind].label} side="left">
            <span className="reason-icon" aria-label={reasonMeta[r.kind].label}>
              {reasonMeta[r.kind].icon}
            </span>
          </Tooltip>
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function StatusDot({ status, pulse }: { status: NodeStatus; pulse?: boolean }) {
  return <Dot tone={nodeStatusTone[status]} pulse={pulse ?? status === 'provisioning'} />;
}
