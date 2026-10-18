import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Layers, Search } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Framework, FrameworkId } from '@/api/types';
import { coverageInProgress, groupFrameworks, matchesFramework } from '@/lib/frameworks';
import { cn, pct } from '@/lib/utils';
import { Bar } from './charts';
import { DomainIcon } from './domain';
import { Badge } from './ui';

/** Domain icon, or a stack for cross-domain (Platform) frameworks. */
export function FrameworkIcon({ framework, size = 13 }: { framework: Pick<Framework, 'domain'>; size?: number }) {
  return framework.domain ? <DomainIcon domain={framework.domain} size={size} aria-hidden /> : <Layers size={size} aria-hidden />;
}

/**
 * Searchable framework chooser (combobox in a popover): grouped as the API groups
 * them, filtered by short or full name, certifying body or group, and navigable
 * with the arrow keys, Home/End, Enter and Escape. `readiness` (0..1, or null
 * when not assessed) is shown next to each option when given.
 */
export function FrameworkPicker({
  frameworks,
  value,
  onChange,
  readiness,
  label = 'Framework',
}: {
  frameworks: readonly Framework[];
  value: FrameworkId | undefined;
  onChange: (id: FrameworkId) => void;
  readiness?: ReadonlyMap<FrameworkId, number | null>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string>(value ?? '');
  const groups = useMemo(() => groupFrameworks(frameworks), [frameworks]);
  const byKey = useMemo(() => new Map(frameworks.map((f) => [f.id.toLowerCase(), f])), [frameworks]);
  const current = frameworks.find((f) => f.id === value);

  const toggle = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery('');
      setActive(value ?? frameworks[0]?.id ?? '');
    }
  };
  const choose = (id: FrameworkId) => {
    setOpen(false);
    if (id !== value) onChange(id);
  };
  // Arrow keys on the closed trigger open the list, as on a native select.
  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      toggle(true);
    }
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={toggle}>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" className="btn btn-secondary fw-trigger" aria-label={`${label}: ${current ? `${current.name}, ${current.fullName}` : 'none selected'}`} onKeyDown={onTriggerKey}>
          {current && <FrameworkIcon framework={current} />}
          <span className="fw-trigger-name">{current?.name ?? 'Choose a framework'}</span>
          {current && readiness?.has(current.id) && <span className="fw-trigger-meta tnum">{fmt(readiness.get(current.id))}</span>}
          <ChevronsUpDown size={13} className="subtle" aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className="menu fw-menu" align="end" sideOffset={6} collisionPadding={8} aria-label={label}>
          <Command label={label} loop value={active} onValueChange={setActive} filter={(id, search) => (matchesFramework(byKey.get(id.toLowerCase()) ?? ({ id } as Framework), search) ? 1 : 0)}>
            <div className="fw-search">
              <Search size={13} className="subtle" aria-hidden />
              <Command.Input className="fw-search-input" placeholder={`Search ${frameworks.length} frameworks…`} value={query} onValueChange={setQuery} autoFocus />
            </div>
            <Command.List className="fw-list">
              <Command.Empty className="palette-empty">No framework matches “{query}”.</Command.Empty>
              {groups.map((g) => (
                <Command.Group key={g.group} heading={g.group} className="palette-group">
                  {g.frameworks.map((f) => {
                    const r = readiness?.get(f.id);
                    const building = coverageInProgress(f);
                    return (
                      <Command.Item key={f.id} value={f.id} onSelect={() => choose(f.id)} className="menu-item menu-item-2line fw-item" data-current={f.id === value || undefined}>
                        <span className="fw-item-check" aria-hidden>
                          {f.id === value && <Check size={12} strokeWidth={3} />}
                        </span>
                        <FrameworkIcon framework={f} size={12} />
                        <span className="stack grow" style={{ gap: 1, minWidth: 0 }}>
                          <span className="row" style={{ gap: 6 }}>
                            <span className="fw-item-name">{f.name}</span>
                            {building && (
                              <Badge tone="outline" className="fw-item-badge" title={`Labs cover ${pct(f.coverage)} of its objectives so far`}>
                                coverage in progress
                              </Badge>
                            )}
                          </span>
                          <span className="xs subtle truncate">
                            {f.fullName}
                            {f.vendor ? ` · ${f.vendor}` : ''}
                          </span>
                        </span>
                        {readiness && (
                          <span className={cn('xs tnum fw-item-ready', r == null && 'subtle')} aria-label={r == null ? 'not assessed' : `${pct(r)} ready`}>
                            {fmt(r)}
                          </span>
                        )}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function fmt(r: number | null | undefined): string {
  return r == null ? '–' : pct(r);
}

export interface FrameworkReadinessRow {
  id: FrameworkId;
  label: ReactNode;
  readiness: number;
  tone?: 'accent' | 'neutral';
}

/**
 * Framework readiness bars, highest first. Long lists (the framework set grows
 * with the curriculum) show the top `limit` with a toggle for the rest.
 */
export function FrameworkReadinessList({ rows, limit = 6 }: { rows: FrameworkReadinessRow[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => [...rows].sort((a, b) => b.readiness - a.readiness), [rows]);
  const shown = all ? sorted : sorted.slice(0, limit);
  return (
    <>
      <ul className="domain-readiness" style={{ padding: '14px 20px 16px' }}>
        {shown.map((r) => (
          <li key={r.id} className="stack" style={{ gap: 5 }}>
            <div className="row-between small">
              {r.label}
              <span className="tnum">{pct(r.readiness)}</span>
            </div>
            <Bar value={r.readiness} {...(r.tone ? { tone: r.tone } : {})} thin />
          </li>
        ))}
      </ul>
      {sorted.length > limit && (
        <div style={{ padding: '0 20px 14px' }}>
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? 'Show top frameworks' : `Show all ${sorted.length} frameworks`}
          </button>
        </div>
      )}
    </>
  );
}
