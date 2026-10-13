import { Command } from 'cmdk';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useNavigate } from '@tanstack/react-router';
import { BookOpen, FlaskConical, Home, Keyboard, Moon, Palette, Sun, Sunset, Terminal, Users, Waypoints } from 'lucide-react';
import { useCatalog } from '@/api/client';
import { Kbd } from '@/components/ui';
import { THEMES, useTheme } from '@/lib/theme';
import { formatMinutes, titleCase } from '@/lib/utils';
import { useShell } from './shell-context';

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setShortcutsOpen } = useShell();
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const catalog = useCatalog();

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
                <Command.Item className="palette-item" onSelect={run(() => void navigate({ to: '/' }))} keywords={['home', 'dashboard']}>
                  <Home size={14} /> Home <Kbd keys="g h" />
                </Command.Item>
                <Command.Item className="palette-item" onSelect={run(() => void navigate({ to: '/catalog', search: {} }))}>
                  <BookOpen size={14} /> Catalog <Kbd keys="g c" />
                </Command.Item>
                <Command.Item className="palette-item" onSelect={run(() => void navigate({ to: '/skills', search: { framework: 'cks' } }))}>
                  <Waypoints size={14} /> Skills <Kbd keys="g s" />
                </Command.Item>
                <Command.Item className="palette-item" onSelect={run(() => void navigate({ to: '/team' }))}>
                  <Users size={14} /> Team dashboard <Kbd keys="g t" />
                </Command.Item>
                <Command.Item className="palette-item" onSelect={run(() => void navigate({ to: '/studio' }))}>
                  <FlaskConical size={14} /> Scenario Studio <Kbd keys="g a" />
                </Command.Item>
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
