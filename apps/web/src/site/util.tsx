import { Link } from '@tanstack/react-router';
import { BarChart3, Boxes, Building2, Check, Cloud, Eye, Flag, GraduationCap, Layers, Lock, Network, Route, Server, Shield, Sparkles, Target, TerminalSquare, Timer, UserRound, Users, type LucideProps } from 'lucide-react';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { isInternalHref } from '@/api/public';
import type { SiteFeatureIcon, SiteFigure, SiteLink } from '@/api/types';
import { useBrandName } from '@/components/brand';
import { hrefFor, signInHref, surfaceConfig } from '@/lib/surface';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/** Sets the document title for the public pages: "Page · Brand" (or just the brand). */
export function useDocumentTitle(page?: string) {
  const brand = useBrandName();
  useEffect(() => {
    const previous = document.title;
    document.title = page ? `${page} · ${brand}` : brand;
    return () => {
      document.title = previous;
    };
  }, [page, brand]);
}

/**
 * A configured link: an in-app `<Link>` for paths, `<a>` for URLs (new tab for http(s)
 * unless told otherwise). A path served by the other origin (the app's `/sign-in` on the
 * website, a website page in the app; src/lib/surface.ts) is a plain link to that origin.
 */
export function SiteAnchor({ to, external, className, children, ...rest }: { to: string; external?: boolean; className?: string; children: ReactNode; 'aria-label'?: string; 'aria-current'?: 'page' | 'location'; onClick?: () => void }) {
  const cross = isInternalHref(to) ? hrefFor(surfaceConfig, to) : to;
  if (cross !== to) {
    return (
      <a href={cross} className={className} {...rest}>
        {children}
      </a>
    );
  }
  if (isInternalHref(to)) {
    const [path, hash] = to.split('#');
    return (
      <Link to={path as '/'} hash={hash} className={className} {...rest}>
        {children}
      </Link>
    );
  }
  // The app's and the website's own origins open in the same tab, like any internal link.
  const own = [surfaceConfig.appUrl, surfaceConfig.siteUrl].some((o) => o && (to === o || to.startsWith(`${o}/`)));
  const newTab = external ?? (!own && /^https?:/.test(to));
  return (
    <a href={to} className={className} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...rest}>
      {children}
    </a>
  );
}

/**
 * "Sign in" from the website: the app's sign-in page, on the app origin when the two are
 * split (src/lib/surface.ts), coming back to `returnTo` when it is an app page.
 */
export function SignInLink({ returnTo, className, title, style, children }: { returnTo?: string; className?: string; title?: string; style?: CSSProperties; children: ReactNode }) {
  const href = signInHref(surfaceConfig, returnTo);
  if (!href.startsWith('/')) {
    return (
      <a href={href} className={className} title={title} style={style}>
        {children}
      </a>
    );
  }
  return (
    <Link to="/sign-in" search={returnTo ? { returnTo } : {}} className={className} title={title} style={style}>
      {children}
    </Link>
  );
}

export const linkKey = (l: SiteLink) => `${l.label}|${l.to}`;

const ICONS: Record<SiteFeatureIcon, (p: LucideProps) => ReactNode> = {
  server: (p) => <Server {...p} />,
  shield: (p) => <Shield {...p} />,
  graduation: (p) => <GraduationCap {...p} />,
  flag: (p) => <Flag {...p} />,
  users: (p) => <Users {...p} />,
  network: (p) => <Network {...p} />,
  boxes: (p) => <Boxes {...p} />,
  terminal: (p) => <TerminalSquare {...p} />,
  timer: (p) => <Timer {...p} />,
  check: (p) => <Check {...p} />,
  sparkles: (p) => <Sparkles {...p} />,
  chart: (p) => <BarChart3 {...p} />,
  lock: (p) => <Lock {...p} />,
  cloud: (p) => <Cloud {...p} />,
  route: (p) => <Route {...p} />,
  eye: (p) => <Eye {...p} />,
  user: (p) => <UserRound {...p} />,
  building: (p) => <Building2 {...p} />,
  target: (p) => <Target {...p} />,
  layers: (p) => <Layers {...p} />,
};

export function FeatureIcon({ icon, size = 18 }: { icon: SiteFeatureIcon; size?: number }) {
  return <>{(ICONS[icon] ?? ICONS.sparkles)({ size, 'aria-hidden': true })}</>;
}

/** Plain paragraphs from configured copy (one `<p>` per entry). */
export function Paragraphs({ text, className }: { text: string[]; className?: string }) {
  return (
    <>
      {text.map((p, i) => (
        <p key={i} className={className}>
          {p}
        </p>
      ))}
    </>
  );
}

/**
 * A real product screenshot in a window frame. The dark image serves the dark
 * theme, `imageLight` the light and cream themes. `priority` marks the hero
 * image (loaded eagerly, high fetch priority); everything else is lazy. The
 * intrinsic size (default 1440×900, the capture size of scripts/site-shots.mjs)
 * reserves the space so the page does not shift when the image arrives.
 */
export function SiteShot({ figure, priority, className, sizes }: { figure: SiteFigure; priority?: boolean; className?: string; sizes?: string }) {
  const { theme } = useTheme();
  const src = theme === 'dark' ? figure.image : (figure.imageLight ?? figure.image);
  return (
    <figure className={cn('site-shot', className)}>
      <img
        src={src}
        alt={figure.alt}
        width={figure.width ?? 1440}
        height={figure.height ?? 900}
        sizes={sizes}
        decoding="async"
        {...(priority ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })}
      />
    </figure>
  );
}
