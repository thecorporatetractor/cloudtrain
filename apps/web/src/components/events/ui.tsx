import { Droplet, Snowflake, Trophy, Users } from 'lucide-react';
import { useMemo } from 'react';
import type { CtfEventStatus, CtfScoreboard, CtfScoreRow, CtfSolve } from '@/api/types';
import { Badge, EmptyState } from '@/components/ui';
import { formatDuration } from '@/lib/utils';
import { cn } from '@/lib/utils';
import './events.css';

export { useServerClock } from '@/components/exams/ui';

const STATUS: Record<CtfEventStatus, { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  upcoming: { label: 'Upcoming', tone: 'accent' },
  running: { label: 'Live', tone: 'ok' },
  ended: { label: 'Ended', tone: 'neutral' },
};

export function EventStatusBadge({ status }: { status: CtfEventStatus }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

/** "Starts in", "ends in" or "ended", against the server clock. */
export function EventCountdown({ startsAt, endsAt, now }: { startsAt: string; endsAt: string; now: number }) {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (now < start) return <span className="event-countdown tnum">starts in {formatDuration((start - now) / 1000)}</span>;
  if (now < end) {
    const left = (end - now) / 1000;
    return (
      <span className={cn('event-countdown tnum', left <= 300 ? 'text-err' : left <= 900 ? 'text-warn' : undefined)} role="timer" aria-live="off" aria-label={`Event ends in ${formatDuration(left)}`}>
        ends in {formatDuration(left)}
      </span>
    );
  }
  return <span className="event-countdown subtle">ended {new Date(end).toLocaleString()}</span>;
}

export function eventWindow(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const sameDay = s.toDateString() === e.toDateString();
  const t = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `${s.toLocaleDateString()} ${t(s)}-${t(e)}` : `${s.toLocaleString()} - ${e.toLocaleString()}`;
}

/* --------------------------------------------------------------- table */

export function ScoreTable({ board, compact }: { board: CtfScoreboard; compact?: boolean }) {
  if (!board.rows.length) return <EmptyState icon={<Trophy size={20} />} title="No entrants yet" description="Teams and players appear here once they join." />;
  const team = board.mode === 'team';
  return (
    <div className="table-wrap">
      <table className="table score-table">
        <caption className="sr-only">
          {board.title} scoreboard{board.frozen ? ', frozen' : ''}: rank, {team ? 'team' : 'player'}, points, solves, last solve
        </caption>
        <thead>
          <tr>
            <th scope="col" className="tnum">
              #
            </th>
            <th scope="col">{team ? 'Team' : 'Player'}</th>
            <th scope="col" className="tnum">
              Points
            </th>
            <th scope="col" className="tnum">
              Solves
            </th>
            {!compact && <th scope="col">Last solve</th>}
          </tr>
        </thead>
        <tbody>
          {board.rows.map((r) => (
            <ScoreRow key={r.id} r={r} team={team} mine={r.id === board.mine} compact={compact} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoreRow({ r, team, mine, compact }: { r: CtfScoreRow; team: boolean; mine: boolean; compact?: boolean }) {
  return (
    <tr className={cn(mine && 'score-row-mine', r.rank <= 3 && r.points > 0 && `score-row-top${r.rank}`)} aria-current={mine ? 'true' : undefined}>
      <td className="tnum score-rank">{r.rank}</td>
      <td>
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <span className="small row" style={{ gap: 6 }}>
            <span className="truncate" style={{ fontWeight: 500 }}>
              {r.name}
            </span>
            {mine && <Badge tone="accent">{team ? 'your team' : 'you'}</Badge>}
            {r.firstBloods > 0 && (
              <span className="first-blood" title={`${r.firstBloods} first blood${r.firstBloods === 1 ? '' : 's'}`} aria-label={`${r.firstBloods} first bloods`}>
                <Droplet size={11} aria-hidden /> {r.firstBloods}
              </span>
            )}
          </span>
          {team && !compact && (
            <span className="xs subtle row truncate" style={{ gap: 4 }}>
              <Users size={11} aria-hidden /> {r.members.map((m) => m.name).join(', ') || 'no members'}
            </span>
          )}
        </div>
      </td>
      <td className="tnum small" style={{ fontWeight: 600 }}>
        {r.points}
      </td>
      <td className="tnum small">{r.solves}</td>
      {!compact && <td className="small subtle">{r.lastSolveAt ? new Date(r.lastSolveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>}
    </tr>
  );
}

/* ------------------------------------------------------------ timeline */

const SERIES = 6;

/** Cumulative points per entrant over the event (step lines), top entrants. */
export function SolveTimeline({ board, now }: { board: CtfScoreboard; now: number }) {
  const W = 640;
  const H = 220;
  const pad = { l: 40, r: 12, t: 12, b: 26 };
  const start = Date.parse(board.startsAt);
  const end = Math.min(Date.parse(board.endsAt), Math.max(start + 60_000, board.frozen && board.frozenAt ? Date.parse(board.frozenAt) : now));
  const series = board.timeline.slice(0, SERIES);
  const max = Math.max(10, ...series.flatMap((s) => s.points.map((p) => p.total)));
  const x = (t: number) => pad.l + ((Math.min(Math.max(t, start), end) - start) / Math.max(1, end - start)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = useMemo(() => [0, 0.5, 1].map((f) => Math.round(max * f)), [max]);
  if (!series.length) return <p className="small subtle">No solves yet.</p>;
  return (
    <figure className="timeline" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Points over time for the top ${series.length}: ${series.map((s) => `${s.name} ${s.points.at(-1)?.total ?? 0}`).join(', ')}`} className="timeline-svg">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="timeline-grid" />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="timeline-axis">
              {v}
            </text>
          </g>
        ))}
        <text x={pad.l} y={H - 6} className="timeline-axis">
          {new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" className="timeline-axis">
          {new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </text>
        {series.map((s, i) => {
          let d = '';
          let last = 0;
          s.points.forEach((p, j) => {
            const px = x(Date.parse(p.at));
            d += j === 0 ? `M${px},${y(p.total)}` : `H${px}V${y(p.total)}`;
            last = p.total;
          });
          d += `H${x(end)}`;
          return (
            <g key={s.entrantId} className={`series-${i + 1}`}>
              <path d={d} className="timeline-line" />
              <circle cx={x(end)} cy={y(last)} r={3} className="timeline-dot" />
            </g>
          );
        })}
      </svg>
      <figcaption className="timeline-legend">
        {series.map((s, i) => (
          <span key={s.entrantId} className={cn('timeline-key xs', `series-${i + 1}`)}>
            <span className="timeline-swatch" aria-hidden /> {s.name} <span className="subtle tnum">{s.points.at(-1)?.total ?? 0}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function SolvesFeed({ solves, limit = 12 }: { solves: CtfSolve[]; limit?: number }) {
  if (!solves.length) return <p className="small subtle">No solves yet.</p>;
  return (
    <ol className="solves-feed">
      {solves.slice(0, limit).map((s) => (
        <li key={`${s.entrantId}-${s.labId}-${s.checkId}`} className="solve-item">
          <span className="xs subtle tnum">{new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="small grow truncate">
            <strong>{s.entrantName}</strong> solved Q{s.questionNumber}
            {s.solvedBy && s.solvedBy.name !== s.entrantName ? <span className="subtle"> · {s.solvedBy.name}</span> : null}
          </span>
          {s.firstBlood && (
            <span className="first-blood" title="First blood">
              <Droplet size={11} aria-hidden /> first
            </span>
          )}
          <span className="xs tnum">+{s.points}</span>
        </li>
      ))}
    </ol>
  );
}

export function FrozenNote({ board }: { board: CtfScoreboard }) {
  if (!board.frozen) return null;
  return (
    <p className="frozen-note small" role="note">
      <Snowflake size={13} aria-hidden /> The scoreboard is frozen since {board.frozenAt ? new Date(board.frozenAt).toLocaleTimeString() : 'the last minutes'}: solves after that show once the event ends.
    </p>
  );
}

export const durationLabel = (startsAt: string, endsAt: string) => formatDuration((Date.parse(endsAt) - Date.parse(startsAt)) / 1000);
