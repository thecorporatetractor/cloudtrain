import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Link, type LinkProps } from '@tanstack/react-router';
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './index';

/* ---------------------------------- Field ---------------------------------- */

/** Label + control + hint/error, wired with ids for assistive tech. */
export function Field({ label, hint, error, children, inline, className, required }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode; inline?: boolean; className?: string; required?: boolean }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('field', inline && 'field-inline', !!error && 'field-invalid', className)}>
      <label htmlFor={id} className="field-label">
        {label}
        {required && (
          <span className="field-required" aria-hidden>
            *
          </span>
        )}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && !error && (
        <div id={hintId} className="field-hint xs subtle">
          {hint}
        </div>
      )}
      {error && (
        <div id={errId} className="field-error xs text-err" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn('input', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn('textarea', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cn('select-wrap', className)}>
      <select className="select" {...rest}>
        {children}
      </select>
      <ChevronDown size={13} className="select-chev" aria-hidden />
    </span>
  );
}

export function Checkbox({ label, description, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cn('checkbox', rest.disabled && 'is-disabled', className)}>
      <input type="checkbox" {...rest} />
      <span className="checkbox-box" aria-hidden>
        <Check size={11} strokeWidth={3} />
      </span>
      <span className="stack" style={{ gap: 1 }}>
        <span className="small">{label}</span>
        {description && <span className="xs subtle">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onCheckedChange, label, disabled, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={cn('switch', checked && 'is-on')} onClick={() => onCheckedChange(!checked)}>
      <span className="switch-thumb" />
    </button>
  );
}

/** Toggle chips for a small multi-select (roles, teams). */
export function ChipSelect<T extends string>({ options, value, onChange, label, disabled }: { options: { value: T; label: ReactNode; hint?: string }[]; value: T[]; onChange: (v: T[]) => void; label: string; disabled?: boolean }) {
  return (
    <div className="chip-group" role="group" aria-label={label} style={{ flexWrap: 'wrap' }}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" className={cn('chip', on && 'is-on')} aria-pressed={on} title={o.hint} disabled={disabled} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------- Confirm dialog ----------------------------- */

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', danger, loading, onConfirm, children, disabled }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; children?: ReactNode; disabled?: boolean }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="dialog" style={{ width: 460, maxWidth: 'calc(100vw - 32px)' }} aria-describedby={undefined}>
          <div className="dialog-header">
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              {danger && (
                <span className="state-icon state-icon-err" style={{ width: 32, height: 32, margin: 0, flex: 'none' }}>
                  <AlertTriangle size={16} />
                </span>
              )}
              <div className="stack" style={{ gap: 3 }}>
                <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
                {description && <DialogPrimitive.Description className="muted small">{description}</DialogPrimitive.Description>}
              </div>
            </div>
          </div>
          {children}
          <div className="dialog-actions">
            <DialogPrimitive.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogPrimitive.Close>
            <Button variant={danger ? 'danger' : 'primary'} loading={loading} disabled={disabled} onClick={onConfirm} autoFocus={!danger}>
              {confirmLabel}
            </Button>
          </div>
          <DialogPrimitive.Close asChild>
            <button className="dialog-close" aria-label="Close">
              <X size={14} />
            </button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ---------------------------------- Drawer --------------------------------- */

/** Side sheet for detail/edit views that keep the list visible. */
export function Drawer({ open, onOpenChange, title, description, children, width = 480, actions }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; width?: number; actions?: ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="drawer" style={{ width, maxWidth: 'calc(100vw - 24px)' }} aria-describedby={undefined}>
          <div className="drawer-head">
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <DialogPrimitive.Title className="dialog-title truncate">{title}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="muted small">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="sm" iconOnly aria-label="Close" icon={<X size={14} />} />
            </DialogPrimitive.Close>
          </div>
          <div className="drawer-body">{children}</div>
          {actions && <div className="drawer-foot">{actions}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ---------------------------------- Pager ---------------------------------- */

export function Pager({ offset, pageSize, total, onChange, loading, hasNext: more }: { offset: number; pageSize: number; total: number | undefined; onChange: (offset: number) => void; loading?: boolean; hasNext?: boolean }) {
  const from = total === 0 ? 0 : offset + 1;
  const to = total === undefined ? offset + pageSize : Math.min(total, offset + pageSize);
  const hasNext = more ?? (total === undefined ? true : to < total);
  return (
    <div className="pager" aria-live="polite">
      <span className="xs subtle tnum">{total === undefined ? `${from}–${to}` : `${from}–${to} of ${total}`}</span>
      <span className="row" style={{ gap: 4 }}>
        <Button variant="ghost" size="sm" iconOnly aria-label="Previous page" icon={<ChevronLeft size={14} />} disabled={offset === 0 || loading} onClick={() => onChange(Math.max(0, offset - pageSize))} />
        <Button variant="ghost" size="sm" iconOnly aria-label="Next page" icon={<ChevronRight size={14} />} disabled={!hasNext || loading} onClick={() => onChange(offset + pageSize)} />
      </span>
    </div>
  );
}

/* --------------------------------- Tab nav --------------------------------- */

/** Secondary navigation inside an area (admin, platform, team). Links, so they work with the keyboard and the palette. */
export function TabNav({ items, current, label }: { items: { to: LinkProps['to']; label: ReactNode; exact?: boolean; params?: LinkProps['params']; search?: LinkProps['search'] }[]; current: string; label: string }) {
  return (
    <nav className="tabnav" aria-label={label}>
      {items.map((it) => {
        const to = String(it.to);
        const active = it.exact ? current === to : current === to || current.startsWith(`${to}/`);
        return (
          <Link key={to} to={it.to} params={it.params} search={it.search} className={cn('tabnav-item', active && 'is-active')} aria-current={active ? 'page' : undefined}>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* --------------------------------- Toolbar --------------------------------- */

export function Toolbar({ children, end }: { children?: ReactNode; end?: ReactNode }) {
  return (
    <div className="toolbar">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {children}
      </div>
      {end && (
        <div className="row" style={{ gap: 8 }}>
          {end}
        </div>
      )}
    </div>
  );
}

/** Table shell: horizontal scroll at narrow widths, compact density option. */
export function TableWrap({ children, className, compact }: { children: ReactNode; className?: string; compact?: boolean }) {
  return <div className={cn('table-wrap', compact && 'table-compact', className)}>{children}</div>;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap" aria-busy aria-label="Loading">
      <table className="table">
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <div className="skeleton" style={{ height: 12, width: `${40 + ((r * 7 + c * 13) % 50)}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
