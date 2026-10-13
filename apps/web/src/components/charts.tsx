import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Circular progress. Monotone: track in surface, fill in accent or a status tone. */
export function Ring({ value, size = 64, stroke = 5, tone = 'accent', children, label }: { value: number; size?: number; stroke?: number; tone?: 'accent' | 'ok' | 'warn' | 'err' | 'neutral'; children?: ReactNode; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone === 'accent' ? 'var(--accent)' : tone === 'neutral' ? 'var(--fg-subtle)' : `var(--${tone})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 500ms var(--ease)' }}
        />
      </svg>
      {children && <div className="ring-center">{children}</div>}
    </div>
  );
}

/**
 * Heat cell: fill opacity encodes mastery, a dashed ring encodes uncertainty.
 * Uses the accent only; status colours stay reserved for meaning.
 */
export function HeatCell({ value, sigma, children, className, style, onClick, selected, title, ...rest }: { value: number; sigma?: number; children?: ReactNode; className?: string; style?: CSSProperties; onClick?: () => void; selected?: boolean; title?: string; 'aria-label'?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const alpha = 0.08 + v * 0.8;
  const inner = (
    <>
      <span className="heat-fill" style={{ opacity: alpha }} aria-hidden />
      {sigma !== undefined && sigma > 0.18 && <span className={cn('heat-uncertain', sigma > 0.3 && 'heat-uncertain-high')} aria-hidden />}
      <span className="heat-content">{children}</span>
    </>
  );
  const cls = cn('heat', v > 0.55 && 'heat-dark', selected && 'is-selected', onClick && 'heat-click', className);
  if (onClick) {
    return (
      <button type="button" className={cls} style={style} onClick={onClick} title={title} aria-pressed={selected} {...rest}>
        {inner}
      </button>
    );
  }
  return (
    <div className={cls} style={style} title={title} {...rest}>
      {inner}
    </div>
  );
}

/** Horizontal bar with optional delta marker. */
export function Bar({ value, delta, tone = 'accent', thin }: { value: number; delta?: number; tone?: 'accent' | 'ok' | 'warn' | 'err' | 'neutral'; thin?: boolean }) {
  const v = Math.max(0, Math.min(1, value));
  const from = delta !== undefined ? Math.max(0, Math.min(1, v - delta)) : v;
  return (
    <div className={cn('meter', thin && 'meter-thin')} style={{ position: 'relative' }}>
      <div className={cn('meter-fill', `meter-${tone}`)} style={{ width: `${v * 100}%` }} />
      {delta !== undefined && delta !== 0 && <div className="bar-delta" style={{ left: `${Math.min(from, v) * 100}%`, width: `${Math.abs(delta) * 100}%` }} aria-hidden />}
    </div>
  );
}

export function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (Math.abs(value) < 0.005) return <span className="subtle xs tnum">—</span>;
  const up = value > 0;
  return (
    <span className={cn('xs tnum', up ? 'text-ok' : 'text-warn')}>
      {up ? '▲' : '▼'} {Math.abs(Math.round(value * 100))}
      {suffix}
    </span>
  );
}
