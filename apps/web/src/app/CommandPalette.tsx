import { Command } from 'cmdk';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useNavigate } from '@tanstack/react-router';
import { Keyboard, Moon, Palette, Sun, Sunset, Terminal } from 'lucide-react';
import { useCatalog, useMe } from '@/api/client';
import { Kbd } from '@/components/ui';
import { THEMES, useTheme } from '@/lib/theme';
import { formatMinutes, titleCase } from '@/lib/utils';
import { canAccess } from './access';
import { NAV } from './Shell';
import { useShell } from './shell-context';

/** Deeper destinations inside the areas; gated like the nav items that contain them. */
const EXTRA: { to: string; label: string; keywords: string[] }[] = [
  { to: '/team/assign', label: 'Assign a lab or path', keywords: ['assignment', 'due', 'manager'] },
  { to: '/team/assignments', label: 'Team assignments', keywords: ['overdue', 'status'] },
  { to: '/team/exams', label: 'Team exam readiness', keywords: ['exam', 'simulation'] },
  { to: '/admin/users', label: 'Admin: users', keywords: ['invite', 'roles', 'deactivate'] },
  { to: '/admin/teams', label: 'Admin: teams', keywords: ['managers'] },
  { to: '/admin/sso', label: 'Admin: single sign-on', keywords: ['sso', 'oidc', 'saml', 'entra', 'okta', 'domain'] },
  { to: '/admin/content', label: 'Admin: content visibility', keywords: ['packs', 'labs', 'pin'] },
  { to: '/admin/sessions', label: 'Admin: live sessions', keywords: ['terminate'] },
  { to: '/admin/usage', label: 'Admin: usage & quotas', keywords: ['quota', 'hours'] },
  { to: '/admin/audit', label: 'Admin: audit log', keywords: ['audit', 'export'] },
  { to: '/admin/settings', label: 'Admin: settings', keywords: ['org', 'logo'] },
  { to: '/platform/capacity', label: 'Platform: capacity', keywords: ['nodes', 'warm pools', 'vms'] },
];

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setShortcutsOpen } = useShell();
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const catalog = useCatalog();
  const me = useMe().data;

  const run = (fn: () => void) => () => {
    setPaletteOpen(false);
    fn();
  };

  return (
    <DialogPrimitive.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="palette" aria-describedby={undefined}>
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <Command label="Command palette" loop>
            <div className="palette-input-row">
              <Command.Input className="palette-input" placeholder="Search labs, pages and actions…" autoFocus />
              <Kbd keys="escape" />
            </div>
            <Command.List className="palette-list">
              <Command.Empty className="palette-empty">No results. Try a lab name, a skill or a page.</Command.Empty>

              <Command.Group heading="Go to" className="palette-group">
                {NAV.flatMap((s) => s.items)
                  .filter((n) => canAccess(me, n.to))
                  .map((n) => (
                    <Command.Item key={n.to} className="palette-item" value={`${n.label} ${n.to}`} onSelect={run(() => void navigate({ to: n.to as '/', search: n.to === '/catalog' || n.to === '/team' ? {} : n.to === '/skills' ? { framework: 'cks' } : undefined }))}>
                      {n.icon} {n.label} {n.keys && <Kbd keys={n.keys} />}
                    </Command.Item>
                  ))}
                {EXTRA.filter((e) => canAccess(me, e.to)).map((e) => (
                  <Command.Item key={e.to} className="palette-item" value={`${e.label} ${e.to}`} keywords={e.keywords} onSelect={run(() => void navigate({ to: e.to as '/', search: e.to.startsWith('/team') ? {} : undefined }))}>
                    <span style={{ width: 14 }} /> {e.label}
                  </Command.Item>
                ))}
              </Command.Group>

              {catalog.data && (
                <Command.Group heading="Labs" className="palette-group">
                  {catalog.data.labs.map((l) => (
                    <Command.Item key={l.id} className="palette-item" value={`${l.title} ${l.id} ${l.tags?.join(' ') ?? ''}`} onSelect={run(() => void navigate({ to: '/labs/$labId', params: { labId: l.id } }))}>
                      <Terminal size={14} />
                      <span className="grow truncate">{l.title}</span>
                      <span className="subtle xs">
                        {titleCase(l.domain)} · {titleCase(l.difficulty)} · {formatMinutes(l.estimatedMinutes)}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading="Appearance" className="palette-group">
                {THEMES.map((t) => (
                  <Command.Item key={t.id} className="palette-item" onSelect={run(() => setTheme(t.id))} keywords={['theme', 'appearance']}>
                    {t.id === 'dark' ? <Moon size={14} /> : t.id === 'light' ? <Sun size={14} /> : <Sunset size={14} />}
                    <span className="grow">Theme: {t.label}</span>
                    <span className="subtle xs">{t.hint}</span>
                  </Command.Item>
                ))}
                <Command.Item className="palette-item" onSelect={run(() => setShortcutsOpen(true))} keywords={['help', 'keys']}>
                  <Keyboard size={14} /> Keyboard shortcuts <Kbd keys="?" />
                </Command.Item>
                <Command.Item className="palette-item" disabled>
                  <Palette size={14} /> Custom accent (coming later)
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
