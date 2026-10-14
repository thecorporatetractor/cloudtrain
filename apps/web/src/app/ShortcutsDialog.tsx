import { useMe } from '@/api/client';
import { Dialog, Kbd } from '@/components/ui';
import { canAccess } from './access';
import { NAV } from './Shell';
import { useShell, type ShortcutGroup } from './shell-context';

const GLOBAL: ShortcutGroup = {
  title: 'Global',
  items: [
    { keys: 'mod+k', description: 'Command palette' },
    { keys: '?', description: 'This cheatsheet' },
    { keys: 'mod+shift+l', description: 'Cycle theme' },
    { keys: '[', description: 'Collapse or expand navigation' },
  ],
};

export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen, extraShortcuts } = useShell();
  const me = useMe().data;
  // Only the destinations this principal can open (same gate as the nav).
  const navigate: ShortcutGroup = { title: 'Navigate', items: NAV.flatMap((s) => s.items).filter((n) => n.keys && canAccess(me, n.to)).map((n) => ({ keys: n.keys!, description: n.label })) };
  const groups = [...extraShortcuts, GLOBAL, navigate];
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
