import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Link, useRouterState } from '@tanstack/react-router';
import { LayoutDashboard, LogIn, Menu, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMe } from '@/api/client';
import { useSite } from '@/api/public';
import type { SiteConfig } from '@/api/types';
import { BrandLockup, useBrandName } from '@/components/brand';
import { Dropdown, Tooltip } from '@/components/ui';
import { THEMES, useTheme, type Theme } from '@/lib/theme';
import { ON_SITE, surfaceConfig } from '@/lib/surface';
import { cn } from '@/lib/utils';
import { ComingSoon } from './ComingSoon';
import { ComingSoonChrome } from './ComingSoonChrome';
import { SiteBrand, SiteFooter, themeIcon } from './Footer';
import { isComingSoon, keepsOwnPage, launchKnown } from './launch';
import { loadMotion, sitePageEnter, siteScrollTo } from './motion';
import { SignInLink } from './util';



/*
 * Chrome of the public website: a sticky header with the primary navigation,
 * the theme switcher and "Sign in" / "Go to dashboard", the page, and a footer
 * built from the site configuration. Every public route renders inside it; the
 * signed-in app keeps its sidebar shell (app/Shell.tsx).
 */

interface NavEntry {
  /** Website route, optionally with a section hash (`/#how-it-works`). */
  to: string;
  label: string;
}

/** The header navigation: the catalog and its paths, the two landing sections, pricing when enabled. */
export function siteNav(site: SiteConfig | undefined): NavEntry[] {
  const flags = site?.flags;
  return [
    ...(flags?.showCatalog !== false ? [{ to: '/catalog', label: 'Catalog' }, { to: '/catalog#paths', label: 'Learning paths' }] : []),
    { to: '/#how-it-works', label: 'How it works' },
    { to: '/#teams', label: 'For teams' },
    ...(flags?.showPricing ? [{ to: '/pricing', label: 'Pricing' }] : []),
  ];
}

/** The pages that live in the drawer and the footer rather than the header. */
const SECONDARY_NAV: NavEntry[] = [
  { to: '/about', label: 'About' },
  { to: '/faq', label: 'FAQ' },
  { to: '/contact', label: 'Contact' },
];

const split = (to: string): [string, string] => {
  const [path, hash] = to.split('#');
  return [path || '/', hash ?? ''];
};

/** Active when the pathname matches and, for section links, the hash does too (a plain `/catalog` is not active on `/catalog#paths`). */
function isActive(entry: NavEntry, pathname: string, hash: string): boolean {
  const [path, h] = split(entry.to);
  const onPath = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
  if (!onPath) return false;
  return h ? hash === h : !hash || path !== '/';
}

function NavLink({ entry, className, current }: { entry: NavEntry; className: string; current: boolean }) {
  const [path, hash] = split(entry.to);
  const aria = current ? ('page' as const) : undefined;
  // `/catalog` validates its search params, so it gets an explicit empty search.
  if (path === '/catalog') {
    return (
      <Link to="/catalog" search={{}} hash={hash || undefined} className={className} aria-current={aria}>
        {entry.label}
      </Link>
    );
  }
  return (
    <Link to={path as '/'} hash={hash || undefined} className={className} aria-current={aria}>
      {entry.label}
    </Link>
  );
}

/**
 * The website scrolls on the window (site.css `html:has(.shell-site)`), and the
 * router's scroll restoration is not used here: a new page starts at the top and
 * a section link scrolls to its target (the header is sticky; sections carry a
 * scroll margin), through the smooth scroll of src/site/motion when it runs.
 */
function useSiteScroll() {
  const location = useRouterState({ select: (s) => s.location });
  const { pathname, hash } = location;
  const first = useRef(true);
  useEffect(() => {
    // A new page (not the first): it rises in; the stops of the page are read from its markup as it scrolls.
    if (first.current) first.current = false;
    else sitePageEnter(document.getElementById('main'));
    // After the frame in which the drawer closes and returns focus, so the scroll is not cancelled.
    const id = window.setTimeout(() => {
      if (hash) {
        const el = document.getElementById(hash);
        if (el) {
          siteScrollTo(el);
          return;
        }
      }
      siteScrollTo(0, { immediate: true });
    }, 60);
    return () => window.clearTimeout(id);
  }, [pathname, hash]);
}

export function SiteLayout({ children }: { children: ReactNode }) {
  useSiteScroll();
  // The motion engine (smooth scroll, reveals, the hero story) loads once the page is up; never with reduced motion.
  useEffect(() => {
    void loadMotion();
  }, []);
  const site = useSite().data;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Until the configuration says which website this is, neither chrome is drawn (no flash of the other one).
  if (!launchKnown(site)) {
    return (
      <div className="site">
        <main id="main" className="site-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    );
  }
  // Pre-launch (src/site/launch.ts): one standalone page in its own chrome; only the legal pages keep theirs.
  if (isComingSoon(site)) {
    return <ComingSoonChrome themeMenu={<ThemeMenu />}>{keepsOwnPage(pathname) ? children : <ComingSoon />}</ComingSoonChrome>;
  }
  return (
    <div className="site">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="site-main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

/** "Sign in" for visitors (back to this page afterwards), "Go to dashboard" once signed in. */
export function SessionButton({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const me = useMe();
  const location = useRouterState({ select: (s) => s.location });
  // The website origin has no platform behind it unless the app's origin is configured.
  if (ON_SITE && !surfaceConfig.appUrl) return null;
  if (me.isSuccess) {
    return (
      <Link to="/" className={cn('btn btn-primary', `btn-${size}`, className)}>
        <LayoutDashboard size={14} aria-hidden /> Go to dashboard
      </Link>
    );
  }
  const here = location.pathname + location.searchStr;
  return (
    <SignInLink returnTo={here !== '/' ? here : undefined} className={cn('btn btn-primary', `btn-${size}`, className)}>
      <LogIn size={14} aria-hidden /> Sign in
    </SignInLink>
  );
}

/** The theme switcher of the website header. */
export function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  return (
    <Dropdown.Root>
      <Tooltip content="Theme">
        <Dropdown.Trigger asChild>
          <button type="button" className="site-icon-btn" aria-label={`Theme: ${theme}`}>
            {themeIcon[theme]}
          </button>
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Content align="end" sideOffset={8}>
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
  );
}

function SiteHeader() {
  const site = useSite().data;
  const brand = useBrandName();
  const location = useRouterState({ select: (s) => s.location });
  const { pathname, hash } = location;
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname, hash]);
  const nav = siteNav(site);

  return (
    <header className="site-header">
      <div className="site-container site-header-inner">
        <Link to="/" className="site-brand" aria-label={`${brand} home`}>
          <SiteBrand />
        </Link>
        <nav className="site-nav" aria-label="Website">
          {nav.map((n) => {
            const current = isActive(n, pathname, hash);
            return <NavLink key={n.to} entry={n} className={cn('site-nav-link', current && 'is-active')} current={current} />;
          })}
        </nav>
        <div className="site-header-actions">
          <ThemeMenu />
          <SessionButton className="site-session-btn" />
          <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
            <DialogPrimitive.Trigger asChild>
              <button ref={menuButton} type="button" className="site-icon-btn site-menu-btn" aria-label="Open menu" aria-expanded={open} aria-controls="site-drawer" aria-haspopup="dialog">
                <Menu size={20} />
              </button>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="dialog-overlay" />
              <DialogPrimitive.Content id="site-drawer" className="site-drawer" data-lenis-prevent aria-describedby={undefined} onCloseAutoFocus={(e) => (e.preventDefault(), menuButton.current?.focus({ preventScroll: true }))}>
                <div className="site-drawer-head">
                  <DialogPrimitive.Title className="site-drawer-title">
                    <BrandLockup height={20} title={`${brand} menu`} />
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Close asChild>
                    <button type="button" className="site-icon-btn" aria-label="Close menu">
                      <X size={18} />
                    </button>
                  </DialogPrimitive.Close>
                </div>
                <nav className="site-drawer-nav" aria-label="Website">
                  <Link to="/" className={cn('site-drawer-link', pathname === '/' && !hash && 'is-active')} aria-current={pathname === '/' && !hash ? 'page' : undefined}>
                    Home
                  </Link>
                  {nav.map((n) => {
                    const current = isActive(n, pathname, hash);
                    return <NavLink key={n.to} entry={n} className={cn('site-drawer-link', current && 'is-active')} current={current} />;
                  })}
                  <span className="site-drawer-sep" aria-hidden />
                  {SECONDARY_NAV.map((n) => {
                    const current = isActive(n, pathname, hash);
                    return <NavLink key={n.to} entry={n} className={cn('site-drawer-link site-drawer-link-secondary', current && 'is-active')} current={current} />;
                  })}
                </nav>
                <div className="site-drawer-foot">
                  <SessionButton size="lg" />
                  <div className="site-theme-chips" role="group" aria-label="Theme">
                    {THEMES.map((t) => (
                      <button key={t.id} type="button" className={cn('chip', theme === t.id && 'is-on')} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
                        {themeIcon[t.id]} {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        </div>
      </div>
    </header>
  );
}
