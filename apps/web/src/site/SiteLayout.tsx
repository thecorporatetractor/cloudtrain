import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Link, useRouterState } from '@tanstack/react-router';
import { ArrowRight, LayoutDashboard, LogIn, Menu, Moon, ShieldCheck, Sun, Sunset, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMe } from '@/api/client';
import { useSite } from '@/api/public';
import type { SiteConfig } from '@/api/types';
import { BrandMark, useBrandName } from '@/components/brand';
import { Dropdown, Tooltip } from '@/components/ui';
import { THEMES, useTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { linkKey, SiteAnchor } from './util';

/*
 * Chrome of the public website: a sticky header with the primary navigation,
 * the theme switcher and "Sign in" / "Go to dashboard", the page, and a footer
 * built from the site configuration. Every public route renders inside it; the
 * signed-in app keeps its sidebar shell (app/Shell.tsx).
 */

interface NavEntry {
  to: '/catalog' | '/pricing' | '/about' | '/faq' | '/contact';
  label: string;
}

export function siteNav(site: SiteConfig | undefined): NavEntry[] {
  const flags = site?.flags;
  return [
    ...(flags?.showCatalog !== false ? [{ to: '/catalog', label: 'Catalog' } as NavEntry] : []),
    ...(flags?.showPricing ? [{ to: '/pricing', label: 'Pricing' } as NavEntry] : []),
    { to: '/about', label: 'About' },
    { to: '/faq', label: 'FAQ' },
    { to: '/contact', label: 'Contact' },
  ];
}

/** `/catalog` validates its search params, so it gets an explicit empty search. */
function NavLink({ entry, className, current }: { entry: NavEntry; className: string; current: boolean }) {
  const aria = current ? ('page' as const) : undefined;
  if (entry.to === '/catalog') {
    return (
      <Link to="/catalog" search={{}} className={className} aria-current={aria}>
        {entry.label}
      </Link>
    );
  }
  return (
    <Link to={entry.to} className={className} aria-current={aria}>
      {entry.label}
    </Link>
  );
}

const themeIcon: Record<Theme, ReactNode> = { dark: <Moon size={15} />, light: <Sun size={15} />, cream: <Sunset size={15} /> };

export function SiteLayout({ children }: { children: ReactNode }) {
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
  if (me.isSuccess) {
    return (
      <Link to="/" className={cn('btn btn-primary', `btn-${size}`, className)}>
        <LayoutDashboard size={14} aria-hidden /> Go to dashboard
      </Link>
    );
  }
  const here = location.pathname + location.searchStr;
  return (
    <Link to="/sign-in" search={here !== '/' ? { returnTo: here } : {}} className={cn('btn btn-primary', `btn-${size}`, className)}>
      <LogIn size={14} aria-hidden /> Sign in
    </Link>
  );
}

function SiteHeader() {
  const site = useSite().data;
  const brand = useBrandName();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  const nav = siteNav(site);
  const active = (to: string) => pathname === to || pathname.startsWith(`${to}/`);

  return (
    <header className="site-header">
      <div className="site-container site-header-inner">
        <Link to="/" className="brand site-brand" aria-label={`${brand} home`}>
          <BrandMark />
          <span className="brand-name">{brand}</span>
        </Link>
        <nav className="site-nav" aria-label="Website">
          {nav.map((n) => (
            <NavLink key={n.to} entry={n} className={cn('site-nav-link', active(n.to) && 'is-active')} current={active(n.to)} />
          ))}
        </nav>
        <div className="site-header-actions">
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
          <SessionButton className="site-session-btn" />
          <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
            <DialogPrimitive.Trigger asChild>
              <button ref={menuButton} type="button" className="site-icon-btn site-menu-btn" aria-label="Open menu" aria-expanded={open} aria-controls="site-drawer" aria-haspopup="dialog">
                <Menu size={18} />
              </button>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="dialog-overlay" />
              <DialogPrimitive.Content id="site-drawer" className="site-drawer" aria-describedby={undefined} onCloseAutoFocus={(e) => (e.preventDefault(), menuButton.current?.focus())}>
                <div className="site-drawer-head">
                  <DialogPrimitive.Title className="row" style={{ gap: 9, fontWeight: 600 }}>
                    <BrandMark /> {brand}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Close asChild>
                    <button type="button" className="site-icon-btn" aria-label="Close menu">
                      <X size={16} />
                    </button>
                  </DialogPrimitive.Close>
                </div>
                <nav className="site-drawer-nav" aria-label="Website">
                  <Link to="/" className={cn('site-drawer-link', pathname === '/' && 'is-active')}>
                    Home
                  </Link>
                  {nav.map((n) => (
                    <NavLink key={n.to} entry={n} className={cn('site-drawer-link', active(n.to) && 'is-active')} current={active(n.to)} />
                  ))}
                </nav>
                <div className="site-drawer-foot">
                  <SessionButton size="lg" />
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
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

/** Links to pages a flag has turned off are dropped rather than leading to an empty page. */
function visibleLink(to: string, site: SiteConfig): boolean {
  const route = to.split(/[?#]/)[0] ?? '';
  if (route === '/pricing') return site.flags.showPricing;
  if (route.startsWith('/catalog')) return site.flags.showCatalog;
  return true;
}

function SiteFooter() {
  const site = useSite().data;
  const brand = useBrandName();
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="site-container">
        <div className="site-footer-grid">
          <div className="stack" style={{ gap: 10 }}>
            <span className="brand" style={{ padding: 0 }}>
              <BrandMark />
              <span className="brand-name">{brand}</span>
            </span>
            <p className="small muted" style={{ maxWidth: 320 }}>
              {site?.brand.tagline}
            </p>
            {site?.footer.note && (
              <p className="xs subtle" style={{ maxWidth: 360 }}>
                {site.footer.note}
              </p>
            )}
          </div>
          {site?.footer.columns.map((c) => (
            <nav key={c.title} className="site-footer-col" aria-label={c.title}>
              <h3>{c.title}</h3>
              <ul>
                {c.links.filter((l) => visibleLink(l.to, site)).map((l) => (
                  <li key={linkKey(l)}>
                    <SiteAnchor to={l.to} external={l.external} className="site-footer-link">
                      {l.label}
                      {!l.to.startsWith('/') && <ArrowRight size={11} className="site-footer-ext" aria-hidden />}
                    </SiteAnchor>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        {site?.legal.alignmentNotice && (
          <p className="site-notice xs subtle">
            <ShieldCheck size={12} aria-hidden /> {site.legal.alignmentNotice}
          </p>
        )}
        <div className="site-footer-bottom xs subtle">
          <span>
            © {year} {site?.brand.legalName ?? brand}
          </span>
          <span className="row" style={{ gap: 14 }}>
            <Link to="/legal/terms" className="site-footer-link">
              Terms
            </Link>
            <Link to="/legal/privacy" className="site-footer-link">
              Privacy
            </Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
