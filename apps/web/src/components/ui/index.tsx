import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, Inbox, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatKeys } from '@/lib/hotkeys';

/* ---------------------------------- Button --------------------------------- */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, iconOnly, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn('btn', `btn-${variant}`, `btn-${size}`, iconOnly && 'btn-icon', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* ----------------------------------- Badge --------------------------------- */

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'err' | 'outline' }) {
  return (
    <span className={cn('badge', `badge-${tone}`, className)} {...rest}>
      {children}
    </span>
  );
}

export function Dot({ tone, pulse, className }: { tone: 'ok' | 'warn' | 'err' | 'neutral' | 'accent'; pulse?: boolean; className?: string }) {
  return <span className={cn('dot', `dot-${tone}`, pulse && 'dot-pulse', className)} aria-hidden />;
}

/* ----------------------------------- Card ---------------------------------- */

export function Card({ className, children, interactive, ...rest }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div className={cn('card', interactive && 'card-interactive', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionHeader({ title, description, actions, as = 'h2' }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; as?: 'h1' | 'h2' | 'h3' }) {
  const Tag = as;
  return (
    <div className="section-header">
      <div className="stack" style={{ gap: 2 }}>
        <Tag>{title}</Tag>
        {description && <p className="muted small">{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

/* ---------------------------------- Meter ---------------------------------- */

export function Meter({ value, tone = 'accent', label, className, thin }: { value: number; tone?: 'accent' | 'ok' | 'warn' | 'err' | 'neutral'; label?: string; className?: string; thin?: boolean }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={cn('meter', thin && 'meter-thin', className)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
      <div className={cn('meter-fill', `meter-${tone}`)} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

/* ----------------------------------- Kbd ----------------------------------- */

export function Kbd({ keys, className }: { keys: string; className?: string }) {
  const parts = formatKeys(keys);
  return (
    <span className={cn('kbd-group', className)}>
      {parts.map((p, i) =>
        p === 'then' ? (
          <span key={i} className="kbd-then">
            then
          </span>
        ) : (
          <kbd key={i} className="kbd">
            {p}
          </kbd>
        ),
      )}
    </span>
  );
}

/* --------------------------------- Skeleton -------------------------------- */

export function Skeleton({ w, h = 14, className, style }: { w?: number | string; h?: number | string; className?: string; style?: React.CSSProperties }) {
  return <div className={cn('skeleton', className)} style={{ width: w, height: h, ...style }} aria-hidden />;
}

export function PageSkeleton() {
  return (
    <div className="stack" style={{ gap: 24 }} aria-busy aria-label="Loading">
      <Skeleton w={260} h={26} />
      <div className="grid-2">
        <Skeleton h={160} />
        <Skeleton h={160} />
      </div>
      <Skeleton h={220} />
    </div>
  );
}

/* --------------------------- Empty / Error states -------------------------- */

export function EmptyState({ icon, title, description, action, compact }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn('state', compact && 'state-compact')} role="status">
      <div className="state-icon">{icon ?? <Inbox size={20} />}</div>
      <h3>{title}</h3>
      {description && <p className="muted small">{description}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', error, onRetry }: { title?: string; error?: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  return (
    <div className="state" role="alert">
      <div className="state-icon state-icon-err">
        <AlertCircle size={20} />
      </div>
      <h3>{title}</h3>
      {message && <p className="muted small mono">{message}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} style={{ marginTop: 8 }}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* ---------------------------------- Tooltip -------------------------------- */

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children, side = 'bottom', shortcut }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; shortcut?: string }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="tooltip">
          {content}
          {shortcut && <Kbd keys={shortcut} className="tooltip-kbd" />}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ---------------------------------- Dialog --------------------------------- */

export function Dialog({ open, onOpenChange, title, description, children, width = 520, hideTitle }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode; width?: number; hideTitle?: boolean }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="dialog" style={{ width, maxWidth: 'calc(100vw - 32px)' }} aria-describedby={description ? undefined : undefined}>
          <div className={cn('dialog-header', hideTitle && 'sr-only')}>
            <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="muted small">{description}</DialogPrimitive.Description>}
          </div>
          {children}
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

/* --------------------------------- Dropdown -------------------------------- */

export const Dropdown = {
  Root: DropdownPrimitive.Root,
  Trigger: DropdownPrimitive.Trigger,
  Content: ({ children, align = 'end', className, ...rest }: DropdownPrimitive.DropdownMenuContentProps) => (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content className={cn('menu', className)} align={align} sideOffset={6} collisionPadding={8} {...rest}>
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  ),
  Item: ({ className, ...rest }: DropdownPrimitive.DropdownMenuItemProps) => <DropdownPrimitive.Item className={cn('menu-item', className)} {...rest} />,
  Label: ({ className, ...rest }: DropdownPrimitive.DropdownMenuLabelProps) => <DropdownPrimitive.Label className={cn('menu-label', className)} {...rest} />,
  Separator: () => <DropdownPrimitive.Separator className="menu-sep" />,
  RadioGroup: DropdownPrimitive.RadioGroup,
  RadioItem: ({ className, children, ...rest }: DropdownPrimitive.DropdownMenuRadioItemProps) => (
    <DropdownPrimitive.RadioItem className={cn('menu-item', className)} {...rest}>
      <span className="menu-check">
        <DropdownPrimitive.ItemIndicator>•</DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.RadioItem>
  ),
};

/* --------------------------------- Segmented -------------------------------- */

export function Segmented<T extends string>({ value, onChange, options, label, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; label: string; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('segmented', `segmented-${size}`)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={cn('segmented-item', value === o.value && 'is-active')} onClick={() => onChange(o.value)} title={o.title}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- Stat tile -------------------------------- */

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' | 'err' }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={cn('stat-value tnum', tone && `text-${tone}`)}>{value}</div>
      {hint && <div className="stat-hint muted small">{hint}</div>}
    </div>
  );
}

export * from './forms';
