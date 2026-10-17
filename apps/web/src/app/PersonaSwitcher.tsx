import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, UserRound } from 'lucide-react';
import { request, useMe } from '@/api/client';
import { useSetPersona } from '@/api/platform';
import { Dropdown, Tooltip } from '@/components/ui';
import { useShell } from './shell-context';

interface Persona {
  id: string;
  userId: string;
  orgId: string;
  label: string;
  hint: string;
}

/**
 * Mock mode only: switch between one account per role so every view can be
 * demoed. Not rendered in real mode (the gateway owns the session there).
 */
export function PersonaSwitcher({ compact, side = 'right' }: { compact?: boolean; side?: 'right' | 'top' }) {
  const personas = useQuery({ queryKey: ['dev', 'personas'], queryFn: () => request<Persona[]>('/api/dev/personas'), staleTime: Infinity });
  const me = useMe();
  const set = useSetPersona();
  const navigate = useNavigate();
  const { toast } = useShell();
  const current = personas.data?.find((p) => p.userId === me.data?.id && p.orgId === me.data?.activeOrg?.id);

  const choose = (p: Persona) =>
    set.mutate(p.id, {
      onSuccess: () => {
        toast({ title: `Now viewing as ${p.label}`, description: p.hint, tone: 'neutral' });
        void navigate({ to: '/' });
      },
    });

  const trigger = (
    <Dropdown.Trigger asChild>
      <button className="nav-item nav-persona" aria-label="Demo persona (mock mode)">
        <span className="nav-icon">
          <UserRound size={15} />
        </span>
        {!compact && (
          <>
            <span className="grow truncate">Viewing as</span>
            <span className="subtle small truncate">{current?.label ?? 'Custom'}</span>
          </>
        )}
      </button>
    </Dropdown.Trigger>
  );

  return (
    <Dropdown.Root>
      {compact ? (
        <Tooltip content="Demo persona" side="right">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      <Dropdown.Content side={side} align="end" sideOffset={10} className="persona-menu">
        <Dropdown.Label>Demo persona · mock mode</Dropdown.Label>
        {(personas.data ?? []).map((p) => (
          <Dropdown.Item key={p.id} onSelect={() => choose(p)} disabled={set.isPending} className="menu-item-2line">
            <span className="grow stack" style={{ gap: 1, minWidth: 0 }}>
              <span className="truncate">{p.label}</span>
              <span className="xs subtle truncate">{p.hint}</span>
            </span>
            {current?.id === p.id && <Check size={13} className="text-accent" aria-label="current" />}
          </Dropdown.Item>
        ))}
      </Dropdown.Content>
    </Dropdown.Root>
  );
}
