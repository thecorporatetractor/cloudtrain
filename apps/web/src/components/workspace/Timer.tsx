import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn, formatDuration } from '@/lib/utils';

export function Timer({ startedAt, deadlineMinutes }: { startedAt: string; deadlineMinutes: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = (now - new Date(startedAt).getTime()) / 1000;
  const remaining = deadlineMinutes * 60 - elapsed;
  const low = remaining < 5 * 60;
  return (
    <span className={cn('timer tnum', low && 'timer-low')} title={`Elapsed ${formatDuration(elapsed)} · ${deadlineMinutes} minute limit`} aria-label={`Time remaining ${formatDuration(remaining)}`}>
      <Clock size={13} aria-hidden />
      {formatDuration(Math.max(0, remaining))}
    </span>
  );
}
