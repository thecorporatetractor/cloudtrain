import { Link } from '@tanstack/react-router';
import { BarChart3, Boxes, Check, Cloud, Eye, Flag, GraduationCap, Lock, Network, Route, Server, Shield, Sparkles, TerminalSquare, Timer, Users, type LucideProps } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { isInternalHref } from '@/api/public';
import type { SiteFeatureIcon, SiteLink } from '@/api/types';
import { useBrandName } from '@/components/brand';

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

/** A configured link: an in-app `<Link>` for paths, `<a>` for URLs (new tab for http(s) unless told otherwise). */
export function SiteAnchor({ to, external, className, children, ...rest }: { to: string; external?: boolean; className?: string; children: ReactNode; 'aria-label'?: string; onClick?: () => void }) {
  if (isInternalHref(to)) {
    const [path, hash] = to.split('#');
    return (
      <Link to={path as '/'} hash={hash} className={className} {...rest}>
        {children}
      </Link>
    );
  }
  const newTab = external ?? /^https?:/.test(to);
  return (
    <a href={to} className={className} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...rest}>
      {children}
    </a>
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
