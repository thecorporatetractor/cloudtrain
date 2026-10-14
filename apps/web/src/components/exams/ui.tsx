import { Boxes, Clock, Flag, GraduationCap, Layers, Network, RefreshCw, RotateCcw, Server, ShieldCheck, Terminal, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ExamAttemptPhase, ExamDomain, ExamRules, ExamTaskScore, ExamSummary } from '@/api/types';
import { Badge } from '@/components/ui';
import { cn, formatDuration } from '@/lib/utils';
import './exams.css';

export const examDomainLabel: Record<ExamDomain, string> = {
  kubernetes: 'Kubernetes',
  linux: 'Linux',
  containers: 'Containers',
  iac: 'Infrastructure as code',
  automation: 'Automation',
  networking: 'Networking',
  'cross-domain': 'Cross-domain',
};

export function ExamDomainIcon({ domain, size = 14 }: { domain: ExamDomain; size?: number }) {
  const Icon = { kubernetes: Boxes, linux: Terminal, containers: Layers, iac: Workflow, automation: RefreshCw, networking: Network, 'cross-domain': GraduationCap }[domain] ?? GraduationCap;
  return <Icon size={size} aria-hidden />;
}

/** "cka:storage" -> "CKA"; display only (titles never name exams). */
export const alignLabel = (id: string) => id.replace(/-aligned$/, '').toUpperCase();

export const phaseMeta: Record<ExamAttemptPhase, { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'err' }> = {
  preparing: { label: 'Preparing', tone: 'neutral' },
  'in-progress': { label: 'In progress', tone: 'accent' },
  grading: { label: 'Grading', tone: 'warn' },
  completed: { label: 'Graded', tone: 'ok' },
  failed: { label: 'Not scored', tone: 'neutral' },
};

export function PhaseBadge({ phase }: { phase: ExamAttemptPhase }) {
  const m = phaseMeta[phase];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function ResultBadge({ passed, score }: { passed?: boolean; score?: number }) {
  if (passed === undefined) return null;
  return (
    <Badge tone={passed ? 'ok' : 'err'} className="tnum">
      {passed ? 'Pass' : 'Fail'}
      {score !== undefined ? ` · ${fmtPct(score)}` : ''}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: ExamTaskScore['outcome'] }) {
  return <Badge tone={outcome === 'pass' ? 'ok' : outcome === 'partial' ? 'warn' : 'err'}>{outcome === 'pass' ? 'Pass' : outcome === 'partial' ? 'Partial' : 'Fail'}</Badge>;
}

export const fmtPct = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}%`;

/** Rule chips: what makes this exam different from a lab. */
export function RuleChips({ rules, environment }: { rules: ExamRules; environment: ExamSummary['environment'] }) {
  const chips: { icon: ReactNode; text: string; title: string }[] = [
    { icon: <Clock size={11} />, text: 'One timer', title: 'A single timer for the whole exam; it starts when your environment is ready' },
    { icon: <ShieldCheck size={11} />, text: 'No hints', title: 'No hints, no validate button; graded once at the end' },
    { icon: <Server size={11} />, text: environment === 'shared' ? 'Shared environment' : 'Environment per task', title: environment === 'shared' ? 'All tasks share one environment' : 'Each task gets its own environment' },
  ];
  if (rules.flagForReview) chips.push({ icon: <Flag size={11} />, text: 'Flag for review', title: 'Flag tasks to come back to them' });
  if (rules.rebootBeforeGrade) chips.push({ icon: <RotateCcw size={11} />, text: 'Reboot before grading', title: 'Machines are rebooted before grading; only persistent configuration scores' });
  if (rules.idempotencyRerun) chips.push({ icon: <RefreshCw size={11} />, text: 'Idempotency re-run', title: 'Saved automation is re-run after the exam and must report no changes' });
  return (
    <div className="exam-chips">
      {chips.map((c) => (
        <span key={c.text} className="exam-chip" title={c.title}>
          {c.icon} {c.text}
        </span>
      ))}
    </div>
  );
}

/** Horizontal score bar with the pass mark drawn on it. */
export function ScoreBar({ value, passMark, label }: { value: number; passMark?: number; label?: string }) {
  const tone = passMark === undefined ? 'neutral' : value >= passMark ? 'ok' : value >= passMark - 10 ? 'warn' : 'err';
  return (
    <div className="exam-bar" role="img" aria-label={label ?? `${fmtPct(value)}${passMark !== undefined ? `, pass mark ${passMark}%` : ''}`}>
      <div className={cn('exam-bar-fill', `exam-bar-${tone}`)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      {passMark !== undefined && <div className="exam-bar-mark" style={{ left: `${passMark}%` }} title={`Pass mark ${passMark}%`} />}
    </div>
  );
}

/** Server-anchored clock: `serverTime` vs the local clock gives the offset, so a wrong local clock does not move the deadline. */
export function useServerClock(serverTime: string | undefined) {
  const offset = useMemo(() => (serverTime ? Date.parse(serverTime) - Date.now() : 0), [serverTime]);
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(id);
  }, [offset]);
  return now;
}

export function ExamTimer({ deadline, now, durationMinutes }: { deadline?: string; now: number; durationMinutes: number }) {
  if (!deadline) {
    return (
      <span className="exam-timer tnum" aria-label="Timer not started">
        <Clock size={14} aria-hidden /> {formatDuration(durationMinutes * 60)}
      </span>
    );
  }
  const remaining = Math.max(0, (Date.parse(deadline) - now) / 1000);
  const tone = remaining <= 5 * 60 ? 'err' : remaining <= 15 * 60 ? 'warn' : undefined;
  return (
    <span className={cn('exam-timer tnum', tone && `exam-timer-${tone}`)} role="timer" aria-live="off" aria-label={`Time remaining ${formatDuration(remaining)}`} title={`Ends at ${new Date(deadline).toLocaleTimeString()}`}>
      <Clock size={14} aria-hidden /> {formatDuration(remaining)}
    </span>
  );
}

export function Disclaimer({ text }: { text: string }) {
  return (
    <p className="exam-disclaimer xs subtle">
      <ShieldCheck size={12} aria-hidden /> {text}
    </p>
  );
}
