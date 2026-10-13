import { Dialog, Kbd } from '@/components/ui';
import { useShell, type ShortcutGroup } from './shell-context';

const GLOBAL: ShortcutGroup[] = [
  {
    title: 'Global',
    items: [
      { keys: 'mod+k', description: 'Command palette' },
      { keys: '?', description: 'This cheatsheet' },
      { keys: 'mod+shift+l', description: 'Cycle theme' },
      { keys: '[', description: 'Collapse or expand navigation' },
    ],
  },
  {
    title: 'Navigate',
    items: [
      { keys: 'g h', description: 'Home' },
      { keys: 'g c', description: 'Catalog' },
      { keys: 'g s', description: 'Skills' },
      { keys: 'g t', description: 'Team' },
      { keys: 'g a', description: 'Scenario Studio' },
    ],
  },
];

export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen, extraShortcuts } = useShell();
  const groups = [...extraShortcuts, ...GLOBAL];
  return (
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} title="Keyboard shortcuts" description="Shortcuts that type into a terminal are suspended while it has focus; modifier combinations always work." width={extraShortcuts.length ? 760 : 520}>
      <div className={extraShortcuts.length ? 'shortcuts-grid shortcuts-grid-3' : 'shortcuts-grid'}>
        {groups.map((g) => (
          <section key={g.title} className="shortcuts-group">
            <h3 className="shortcuts-title">{g.title}</h3>
            <ul className="shortcuts-list">
              {g.items.map((it) => (
                <li key={it.keys} className="shortcuts-row">
                  <span className="small">{it.description}</span>
                  <Kbd keys={it.keys} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
