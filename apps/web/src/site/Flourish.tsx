import type { PublicCatalog, SiteConfig } from '@/api/types';
import { DomainIcon } from '@/components/domain';

/*
 * The marquee band of the catalog's domains: pure markup and CSS, complete and
 * readable without a script and with prefers-reduced-motion (site.css, "Motion").
 */

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/** The domains with labs, as a slow marquee (a wrapped row with reduced motion); nothing when the catalog is not there. */
export function DomainMarquee({ site, cat, label = 'Domains' }: { site: SiteConfig; cat: PublicCatalog | undefined; label?: string }) {
  if (!cat) return null;
  const domains = site.highlightDomains.map((id) => cat.domains.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d && d.labCount > 0);
  if (domains.length === 0) return null;
  const items = (hidden: boolean) => (
    <ul className="marquee-track" aria-hidden={hidden || undefined}>
      {domains.map((d) => (
        <li key={d.id} className="marquee-item">
          <DomainIcon domain={d.id} size={15} aria-hidden />
          <span className="marquee-name">{d.name}</span>
          <span className="site-meta">{plural(d.labCount, 'lab', 'labs')}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="site-band" aria-label={label} role="region">
      <div className="marquee">
        {items(false)}
        {items(true)}
      </div>
    </div>
  );
}
