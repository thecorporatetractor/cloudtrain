import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, type ReactNode } from 'react';
import { BookOpen, Building2, Check, ChevronLeft, ChevronRight, ClipboardList, FlaskConical, GraduationCap, HelpCircle, History, Home as HomeIcon, Keyboard, LogOut, Moon, Palette, Presentation, Search, Server, Settings, Shield, Sun, Sunset, Users, UserCog, Waypoints, X } from 'lucide-react';
import { useMe } from '@/api/client';
import { useLogout, useSwitchOrg } from '@/api/platform';
import { isRealApi } from '@/api/mode';
import type { Me } from '@/api/types';
import { Badge, Button, Dot, Dropdown, Kbd, Tooltip } from '@/components/ui';
import { useHotkeys, type Hotkey } from '@/lib/hotkeys';
import { THEMES, useTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { canAccess } from './access';
import { AuthGate, isPublicPath } from './auth';
import { CommandPalette } from './CommandPalette';
import { PersonaSwitcher } from './PersonaSwitcher';
import { ShellProvider, useShell } from './shell-context';
import { ShortcutsDialog } from './ShortcutsDialog';

export function Shell() {
  return (
    <ShellProvider>
      <AuthGate>
        <ShellInner />
      </AuthGate>
    </ShellProvider>
  );
}

interface NavLinkProps {
  className: string;
  'aria-current'?: 'page';
  children: ReactNode;
}
interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  keys?: string;
  link: (p: NavLinkProps) => ReactNode;
  /** Paths that also highlight this item. */
  also?: string[];
}
interface NavSection {
  title?: string;
  items: NavItem[];
}

/** Access per item comes from ROUTE_ACCESS (app/access.tsx): nav, palette, hotkeys and the routes use the same map. */
export const NAV: NavSection[] = [
  {
    items: [
      { to: '/', label: 'Home', icon: <HomeIcon size={16} />, keys: 'g h', link: (p) => <Link to="/" {...p} /> },
      { to: '/catalog', label: 'Catalog', icon: <BookOpen size={16} />, keys: 'g c', link: (p) => <Link to="/catalog" search={{}} {...p} />, also: ['/labs'] },
      { to: '/skills', label: 'Skills', icon: <Waypoints size={16} />, keys: 'g s', link: (p) => <Link to="/skills" search={{ framework: 'cks' }} {...p} /> },
      { to: '/assignments', label: 'My assignments', icon: <ClipboardList size={16} />, keys: 'g m', link: (p) => <Link to="/assignments" {...p} /> },
      { to: '/history', label: 'History', icon: <History size={16} />, keys: 'g y', link: (p) => <Link to="/history" {...p} /> },
      { to: '/exams', label: 'Exams', icon: <GraduationCap size={16} />, keys: 'g e', link: (p) => <Link to="/exams" search={{}} {...p} /> },
    ],
  },
  {
    title: 'Manage',
    items: [
      { to: '/team', label: 'Team', icon: <Users size={16} />, keys: 'g t', link: (p) => <Link to="/team" search={{}} {...p} /> },
      { to: '/cohorts', label: 'Cohorts', icon: <Presentation size={16} />, keys: 'g o', link: (p) => <Link to="/cohorts" {...p} /> },
      { to: '/studio', label: 'Scenario Studio', icon: <FlaskConical size={16} />, keys: 'g a', link: (p) => <Link to="/studio" {...p} /> },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/admin', label: 'Admin', icon: <UserCog size={16} />, keys: 'g d', link: (p) => <Link to="/admin" {...p} /> },
      { to: '/platform', label: 'Platform', icon: <Server size={16} />, keys: 'g p', link: (p) => <Link to="/platform" {...p} /> },
    ],
  },
];

const themeIcon: Record<Theme, ReactNode> = { dark: <Moon size={14} />, light: <Sun size={14} />, cream: <Sunset size={14} /> };

function ShellInner() {
  const shell = useShell();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { theme, setTheme, cycle } = useTheme();
  const me = useMe();
  const inWorkspace = /^\/labs\/[^/]+\/work$/.test(pathname) || /\/observe\/[^/]+$/.test(pathname) || /^\/exams\/attempts\/[^/]+$/.test(pathname);
  const publicPage = isPublicPath(pathname);

  // Workspace forces the rail; leaving restores the user's preference.
  useEffect(() => {
    if (inWorkspace) shell.setNavMode(shell.chromeless ? 'hidden' : 'rail');
    else shell.setNavMode(shell.navCollapsed ? 'rail' : 'full');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inWorkspace, shell.chromeless, shell.navCollapsed]);

  const principal = me.data;
  const visibleSections = NAV.map((s) => ({ ...s, items: s.items.filter((n) => canAccess(principal, n.to)) })).filter((s) => s.items.length > 0);
  const hotkeys: Hotkey[] = [
    // Ctrl+K and Ctrl+/ mean kill-line and undo in a shell, so they stay with the terminal there.
    { keys: 'mod+k', description: 'Open command palette', group: 'Global', skipTerminal: true, handler: () => shell.setPaletteOpen(true) },
    { keys: '?', description: 'Keyboard shortcuts', group: 'Global', handler: () => shell.setShortcutsOpen(true) },
    { keys: 'mod+/', description: 'Keyboard shortcuts', group: 'Global', skipTerminal: true, handler: () => shell.setShortcutsOpen(true) },
    { keys: 'mod+shift+l', description: 'Cycle theme', group: 'Global', handler: cycle },
    { keys: '[', description: 'Collapse or expand navigation', group: 'Global', handler: () => !inWorkspace && shell.toggleNavCollapsed() },
    ...visibleSections.flatMap((s) => s.items.filter((n) => n.keys).map((n): Hotkey => ({ keys: n.keys!, description: `Go to ${n.label.toLowerCase()}`, group: 'Navigate', handler: () => void navigate({ to: n.to as '/', search: n.to === '/catalog' || n.to === '/team' || n.to === '/exams' ? {} : n.to === '/skills' ? { framework: 'cks' } : undefined }) }))),
  ];
  useHotkeys(hotkeys, !publicPage);

  if (publicPage) {
    return (
      <div className="shell shell-public">
        <main id="main" className="main" tabIndex={-1}>
          <Outlet />
        </main>
        <Toasts />
      </div>
    );
  }

  const navMode = shell.navMode;

  return (
    <div className={cn('shell', `shell-nav-${navMode}`, inWorkspace && 'shell-workspace')} data-nav={navMode}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {navMode !== 'hidden' && (
        <nav className="nav" aria-label="Primary">
          <div className="nav-brand">
            <Link to="/" className="brand" aria-label="CloudTrain home">
              <span className="brand-mark" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M3 12.5h9.2a3.3 3.3 0 0 0 .4-6.57A4.6 4.6 0 0 0 4 7.6 2.5 2.5 0 0 0 3 12.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M6.5 15.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </span>
              {navMode === 'full' && <span className="brand-name">CloudTrain</span>}
            </Link>
            {navMode === 'full' && !inWorkspace && (
              <Tooltip content="Collapse navigation" shortcut="[" side="right">
                <button className="nav-collapse" onClick={shell.toggleNavCollapsed} aria-label="Collapse navigation">
                  <ChevronLeft size={14} />
                </button>
              </Tooltip>
            )}
          </div>

          <button className={cn('nav-search', navMode === 'rail' && 'nav-search-rail')} onClick={() => shell.setPaletteOpen(true)} aria-label="Search and commands">
            <Search size={14} />
            {navMode === 'full' && (
              <>
                <span className="grow" style={{ textAlign: 'left' }}>
                  Search
                </span>
                <Kbd keys="mod+k" />
              </>
            )}
          </button>

          <div className="nav-scroll">
            {visibleSections.map((section, si) => (
              <div key={section.title ?? si} className="nav-section">
                {section.title && navMode === 'full' && <div className="nav-section-title">{section.title}</div>}
                {section.title && navMode === 'rail' && <div className="nav-section-rule" aria-hidden />}
                <ul className="nav-list" aria-label={section.title}>
                  {section.items.map((n) => {
                    const active = n.to === '/' ? pathname === '/' : pathname === n.to || pathname.startsWith(`${n.to}/`) || (n.also ?? []).some((a) => pathname.startsWith(a));
                    const item = n.link({
                      className: cn('nav-item', active && 'is-active'),
                      'aria-current': active ? 'page' : undefined,
                      children: (
                        <>
                          <span className="nav-icon">{n.icon}</span>
                          {navMode === 'full' && <span className="grow truncate">{n.label}</span>}
                        </>
                      ),
                    });
                    return (
                      <li key={n.to}>
                        {navMode === 'rail' ? (
                          <Tooltip content={n.label} shortcut={n.keys} side="right">
                            {item}
                          </Tooltip>
                        ) : (
                          item
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="nav-footer">
            {!isRealApi && <PersonaSwitcher compact={navMode === 'rail'} />}
            {navMode === 'rail' && !inWorkspace && (
              <Tooltip content="Expand navigation" shortcut="[" side="right">
                <button className="nav-item nav-item-icon" onClick={shell.toggleNavCollapsed} aria-label="Expand navigation">
                  <ChevronRight size={16} />
                </button>
              </Tooltip>
            )}
            <Dropdown.Root>
              <Tooltip content="Theme" shortcut="mod+shift+l" side="right">
                <Dropdown.Trigger asChild>
                  <button className="nav-item nav-item-icon" aria-label={`Theme: ${theme}`}>
                    <span className="nav-icon">{themeIcon[theme]}</span>
                    {navMode === 'full' && <span className="grow truncate">Theme</span>}
                    {navMode === 'full' && <span className="subtle small">{THEMES.find((t) => t.id === theme)?.label}</span>}
                  </button>
                </Dropdown.Trigger>
              </Tooltip>
              <Dropdown.Content side="right" align="end" sideOffset={10}>
                <Dropdown.Label>Appearance</Dropdown.Label>
                <Dropdown.RadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                  {THEMES.map((t) => (
                    <Dropdown.RadioItem key={t.id} value={t.id}>
                      {themeIcon[t.id]}
                      <span className="grow">{t.label}</span>
                      <span className="subtle xs">{t.hint}</span>
                    </Dropdown.RadioItem>
                  ))}
                </Dropdown.RadioGroup>
              </Dropdown.Content>
            </Dropdown.Root>

            <UserMenu me={principal} navMode={navMode} />
          </div>
        </nav>
      )}

      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>

      <CommandPalette />
      <ShortcutsDialog />
      <Toasts />
    </div>
  );
}

function UserMenu({ me, navMode }: { me: Me | undefined; navMode: 'full' | 'rail' | 'hidden' }) {
  const shell = useShell();
  const navigate = useNavigate();
  const { cycle } = useTheme();
  const switchOrg = useSwitchOrg();
  const logout = useLogout();
  const orgName = me?.activeOrg?.name ?? me?.org ?? '';

  const signOut = () =>
    logout.mutate(undefined, {
      onSuccess: (r) => {
        if (isRealApi) window.location.assign(r.redirectUrl);
        else void navigate({ to: '/sign-in', search: { signedOut: true }, replace: true });
      },
      onError: (e) => shell.toast({ title: 'Could not sign out', description: e.message, tone: 'err' }),
    });

  const changeOrg = (orgId: string) => {
    if (orgId === me?.activeOrg?.id) return;
    switchOrg.mutate(orgId, {
      onSuccess: (m) => {
        shell.toast({ title: `Switched to ${m.activeOrg?.name ?? 'organisation'}`, tone: 'ok' });
        void navigate({ to: '/' });
      },
      onError: (e) => shell.toast({ title: 'Could not switch organisation', description: e.message, tone: 'err' }),
    });
  };

  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button className="nav-item nav-user" aria-label="Account menu">
          <span className="avatar" aria-hidden>
            {initials(me?.name ?? '')}
          </span>
          {navMode === 'full' && (
            <span className="stack grow" style={{ gap: 0, minWidth: 0 }}>
              <span className="truncate small" style={{ fontWeight: 500 }}>
                {me?.name ?? '…'}
              </span>
              <span className="truncate xs subtle">{orgName}</span>
            </span>
          )}
        </button>
      </Dropdown.Trigger>
      <Dropdown.Content side="right" align="end" sideOffset={10}>
        <div className="menu-user">
          <div className="small" style={{ fontWeight: 500 }}>
            {me?.name}
          </div>
          <div className="xs subtle truncate">{me?.email}</div>
          <div className="row xs subtle" style={{ marginTop: 6, flexWrap: 'wrap', gap: 4 }}>
            <Dot tone="ok" /> {orgName}
            {me?.supportAccess && (
              <Badge tone="warn" className="xs">
                <Shield size={10} /> support access
              </Badge>
            )}
          </div>
          {me?.auth.idp && <div className="xs subtle">signed in through {me.auth.idp}</div>}
        </div>
        {me && me.memberships.length > 1 && (
          <>
            <Dropdown.Separator />
            <Dropdown.Label>Organisation</Dropdown.Label>
            {me.memberships.map((m) => (
              <Dropdown.Item key={m.org.id} onSelect={() => changeOrg(m.org.id)} disabled={switchOrg.isPending}>
                <Building2 size={14} />
                <span className="grow truncate">{m.org.name}</span>
                {m.org.id === me.activeOrg?.id ? <Check size={13} className="text-accent" /> : <span className="xs subtle">{m.roles.length ? m.roles.map(roleLabel).join(', ') : ''}</span>}
              </Dropdown.Item>
            ))}
          </>
        )}
        <Dropdown.Separator />
        <Dropdown.Item onSelect={() => shell.setShortcutsOpen(true)}>
          <Keyboard size={14} /> Keyboard shortcuts <Kbd keys="?" />
        </Dropdown.Item>
        <Dropdown.Item onSelect={cycle}>
          <Palette size={14} /> Switch theme <Kbd keys="mod+shift+l" />
        </Dropdown.Item>
        <Dropdown.Item disabled>
          <Settings size={14} /> Preferences
        </Dropdown.Item>
        <Dropdown.Item disabled>
          <HelpCircle size={14} /> Help centre
        </Dropdown.Item>
        <Dropdown.Separator />
        <Dropdown.Item className="menu-item-danger" onSelect={signOut} disabled={logout.isPending}>
          <LogOut size={14} /> Sign out
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown.Root>
  );
}

/** Display names for roles, used only where a role is shown to a human (never for gating). */
export const roleLabel = (r: string): string => ({ learner: 'Learner', manager: 'Manager', instructor: 'Instructor', author: 'Author', org_admin: 'Org admin', platform_admin: 'Platform admin' })[r] ?? r;

function Toasts() {
  const { toasts, dismissToast } = useShell();
  // The live region is always in the tree; only its children change, so screen readers announce new toasts.
  return (
    <div className="toasts" role="status" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div key={t.id} className={cn('toast', `toast-${t.tone}`)}>
          <Dot tone={t.tone} />
          <div className="grow">
            <div className="small" style={{ fontWeight: 500 }}>
              {t.title}
            </div>
            {t.description && <div className="xs muted">{t.description}</div>}
          </div>
          <Button variant="ghost" size="sm" iconOnly aria-label="Dismiss" onClick={() => dismissToast(t.id)} icon={<X size={12} />} />
        </div>
      ))}
    </div>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
