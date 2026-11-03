import { Clock } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LabSession } from '@/api/types';
import { clockOffset, dueWarning, EXPIRY_WARNINGS, labDeadline, sessionClock, warningText, warningTitle } from '@/lib/labClock';
import { cn, formatDuration } from '@/lib/utils';

/**
 * Time left in a lab. Counts against the gateway's clock (serverTime on the session), so a
 * skewed browser clock does not move the deadline, and warns at 10 and 2 minutes left: in an
 * assertive live region for screen readers, and through `onWarn` (the workspace shows a toast).
 * Both name the time actually left (see warningTitle).
 * Without `onWarn` (an instructor observing) it only counts down.
 *
 * The offset and the warnings given are kept per session id outside the component (see
 * sessionClock): a cached session without serverTime (the start, validate and hint responses)
 * keeps the last offset, and a remount does not warn again.
 */
export function Timer({ session, onWarn }: { session: Pick<LabSession, 'startedAt' | 'deadlineMinutes' | 'expiresAt' | 'serverTime'> & { id?: string }; onWarn?: (title: string, threshold: number) => void }) {
  const offset = useMemo(() => clockOffset(session.id, session.serverTime), [session.id, session.serverTime]);
  const [browserNow, setBrowserNow] = useState(() => Date.now());
  useEffect(() => {
    setBrowserNow(Date.now());
    const id = window.setInterval(() => setBrowserNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const now = browserNow + offset;
  const deadline = labDeadline(session);
  const remaining = (deadline - now) / 1000;
  const elapsed = (now - Date.parse(session.startedAt)) / 1000;
  const clock = sessionClock(session.id);
  const [announce, setAnnounce] = useState('');
  const onWarnRef = useRef(onWarn);
  onWarnRef.current = onWarn;

  useEffect(() => {
    // An extension moves the deadline: the warnings are given again for the new one.
    if (clock.deadline !== deadline) {
      clock.deadline = deadline;
      clock.given = new Set();
    }
    // Only the learner's own lab warns (an observer's view passes no onWarn).
    if (!onWarnRef.current) return;
    const due = dueWarning(remaining, clock.given);
    if (due === undefined) return;
    for (const t of EXPIRY_WARNINGS) if (t >= due) clock.given.add(t);
    setAnnounce(warningText(remaining, due));
    onWarnRef.current?.(warningTitle(remaining, due), due);
  }, [remaining, deadline, clock]);

  const low = remaining < 5 * 60;
  return (
    <>
      <span className={cn('timer tnum', low && 'timer-low')} title={`Elapsed ${formatDuration(Math.max(0, elapsed))} · ends at ${new Date(deadline).toLocaleTimeString()}`} role="timer" aria-label={`Time remaining ${formatDuration(Math.max(0, remaining))}`}>
        <Clock size={13} aria-hidden />
        {formatDuration(Math.max(0, remaining))}
      </span>
      <span className="sr-only" aria-live="assertive">
        {announce}
      </span>
    </>
  );
}
