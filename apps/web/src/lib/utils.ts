export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const units: [number, string][] = [
    [60_000, 'm'],
    [3_600_000, 'h'],
    [86_400_000, 'd'],
    [7 * 86_400_000, 'w'],
  ];
  if (abs < 60_000) return 'just now';
  let label = '';
  for (let i = units.length - 1; i >= 0; i--) {
    const [ms, u] = units[i]!;
    if (abs >= ms) {
      label = `${Math.floor(abs / ms)}${u}`;
      break;
    }
  }
  return future ? `in ${label}` : `${label} ago`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function daysUntil(iso: string, now = Date.now()): number {
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl';
