import { Link } from '@tanstack/react-router';
import { AlertTriangle, CalendarClock, CheckCircle2, Circle, CircleDot, Eye } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AssignmentItem, AssignmentState, AttemptOutcome, SessionPhase, UserRef } from '@/api/types';
import { initials } from '@/app/Shell';
import { Badge, Dot } from '@/components/ui';
import { cn, daysUntil, formatDate, relativeTime } from '@/lib/utils';

/* ------------------------------ assignment state ----------------------------- */

export const assignmentStateMeta: Record<AssignmentState, { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'err'; icon: ReactNode }> = {
  not_started: { label: 'Not started', tone: 'neutral', icon: <Circle size={11} /> },
  in_progress: { label: 'In progress', tone: 'accent', icon: <CircleDot size={11} /> },
  completed: { label: 'Completed', tone: 'ok', icon: <CheckCircle2 size={11} /> },
  overdue: { label: 'Overdue', tone: 'warn', icon: <AlertTriangle size={11} /> },
};

export function AssignmentStateBadge({ state }: { state: AssignmentState }) {
  const m = assignmentStateMeta[state];
  return (
    <Badge tone={m.tone}>
      {m.icon} {m.label}
    </Badge>
  );
}

/** Due date with urgency: overdue in warn, within 3 days emphasised. */
export function DueDate({ dueAt, done }: { dueAt: string | null; done?: boolean }) {
  if (!dueAt) return <span className="xs subtle">No due date</span>;
  const days = daysUntil(dueAt);
  const late = days < 0 && !done;
  const soon = !late && !done && days <= 3;
  return (
    <span className={cn('row xs tnum', late ? 'text-warn' : soon ? '' : 'subtle')} style={{ gap: 5 }} title={new Date(dueAt).toLocaleString()}>
      <CalendarClock size={11} />
      {formatDate(dueAt)}
      <span className={cn(late || soon ? '' : 'subtle')}>· {late ? `${-days}d late` : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${days}d`}</span>
    </span>
  );
}

export const itemKindLabel: Record<AssignmentItem['kind'], string> = { lab: 'Lab', path: 'Path', framework: 'Framework' };

/** Where an assignment item leads. */
export function ItemLink({ item, className }: { item: AssignmentItem; className?: string }) {
  const title = item.title ?? item.id;
  if (item.kind === 'lab')
    return (
      <Link to="/labs/$labId" params={{ labId: item.id }} className={className}>
        {title}
      </Link>
    );
  if (item.kind === 'path')
    return (
      <Link to="/catalog" search={{ path: item.id }} className={className}>
        {title}
      </Link>
    );
  return (
    <Link to="/skills" search={{ framework: item.id as 'cks' }} className={className}>
      {title}
    </Link>
  );
}

/* --------------------------------- outcomes --------------------------------- */

export const outcomeMeta: Record<AttemptOutcome, { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'err' }> = {
  passed: { label: 'Passed', tone: 'ok' },
  partial: { label: 'Partial', tone: 'warn' },
  failed: { label: 'Failed', tone: 'err' },
  abandoned: { label: 'Abandoned', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'accent' },
};

export function OutcomeBadge({ outcome }: { outcome: AttemptOutcome }) {
  const m = outcomeMeta[outcome];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

/* ---------------------------------- phases ---------------------------------- */

export const phaseMeta: Record<SessionPhase, { label: string; tone: 'ok' | 'warn' | 'err' | 'neutral' | 'accent'; pulse?: boolean }> = {
  pending: { label: 'Queued', tone: 'neutral', pulse: true },
  provisioning: { label: 'Provisioning', tone: 'warn', pulse: true },
  ready: { label: 'Working', tone: 'ok' },
  grading: { label: 'Grading', tone: 'accent', pulse: true },
  hibernated: { label: 'Idle', tone: 'neutral' },
  expired: { label: 'Ended', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'err' },
};

export function PhaseBadge({ phase }: { phase: SessionPhase }) {
  const m = phaseMeta[phase];
  return (
    <span className="row xs" style={{ gap: 6 }}>
      <Dot tone={m.tone} pulse={m.pulse} /> {m.label}
    </span>
  );
}

/* ----------------------------------- people --------------------------------- */

export function UserCell({ user, sub, size = 'md', link }: { user: UserRef; sub?: ReactNode; size?: 'sm' | 'md'; link?: ReactNode }) {
  const inner = (
    <>
      <span className={cn('avatar', size === 'md' && 'avatar-lg')} aria-hidden>
        {initials(user.name)}
      </span>
      <span className="stack" style={{ gap: 0, minWidth: 0 }}>
        <span className="small truncate" style={{ fontWeight: 500 }}>
          {user.name}
        </span>
        <span className="xs subtle truncate">{sub ?? user.email}</span>
      </span>
    </>
  );
  return link ? <>{link}</> : <span className="user-cell">{inner}</span>;
}

export function UserChip({ user }: { user: UserRef }) {
  return (
    <span className="user-chip" title={user.email}>
      <span className="avatar" aria-hidden style={{ width: 18, height: 18, fontSize: 8 }}>
        {initials(user.name)}
      </span>
      <span className="truncate">{user.name}</span>
    </span>
  );
}

export function ObservedBy({ users }: { users: UserRef[] }) {
  if (!users.length) return null;
  return (
    <Badge tone="accent" title={users.map((u) => u.name).join(', ')}>
      <Eye size={10} /> {users.length === 1 ? users[0]!.name.split(' ')[0] : `${users.length} observing`}
    </Badge>
  );
}

export function When({ iso, exact }: { iso: string | undefined; exact?: boolean }) {
  if (!iso) return <span className="subtle">—</span>;
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()} className="tnum">
      {exact ? formatDate(iso) : relativeTime(iso)}
    </time>
  );
}

export const minutesLabel = (s: number) => {
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

/** Standard "fetch failed" and "nothing here" blocks for list screens. */
export function ListState({ children }: { children: ReactNode }) {
  return <div style={{ padding: 20 }}>{children}</div>;
}
