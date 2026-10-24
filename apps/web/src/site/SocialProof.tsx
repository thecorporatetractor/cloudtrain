import { Quote } from 'lucide-react';
import type { SiteConfig } from '@/api/types';
import { useTheme } from '@/lib/theme';
import { PlaceholderTag } from './PricingModel';

/*
 * Customer logos and quotes (content/site.yaml `socialProof`). Until real ones are
 * signed off, `placeholder: true` labels every slot as a placeholder, visibly and
 * for screen readers, so nothing invented can pass for a real endorsement.
 */
export function SocialProof({ site }: { site: SiteConfig }) {
  const sp = site.socialProof;
  const { theme } = useTheme();
  if (!sp || (!sp.logos?.length && !sp.quotes?.length)) return null;
  const ph = sp.placeholder !== false;
  return (
    <section className="site-section sp" id="customers" aria-labelledby="sp-title" data-placeholder={ph || undefined}>
      <div className="site-container">
        <div className="sp-head">
          <div>
            {sp.eyebrow && <p className="site-eyebrow">{sp.eyebrow}</p>}
            <h2 id="sp-title" className="site-h2">
              {sp.title ?? 'Teams that train on real systems'}
            </h2>
          </div>
          {ph && (
            <p className="sp-note">
              <PlaceholderTag /> {sp.note ?? 'Placeholder content. Logos and quotes appear here once customers approve them.'}
            </p>
          )}
        </div>
        {sp.logos && sp.logos.length > 0 && (
          // A slow marquee with motion (the second copy only loops it); a grid on the still page.
          <div className="marquee marquee-slow sp-marquee">
            {[false, true].map((dup) => (
              <ul key={String(dup)} className="sp-logos marquee-track" aria-hidden={dup || undefined} aria-label={dup ? undefined : ph ? 'Customer logos (placeholders)' : 'Customers'}>
                {sp.logos!.map((l) => {
                  const src = theme === 'dark' ? (l.imageDark ?? l.image) : l.image;
                  return (
                    <li key={l.name} className="sp-logo">
                      {src && !ph ? <img src={src} alt={l.name} loading="lazy" decoding="async" height={28} /> : <span>{l.name}</span>}
                    </li>
                  );
                })}
              </ul>
            ))}
          </div>
        )}
        {sp.quotes && sp.quotes.length > 0 && (
          <ul className="sp-quotes" data-reveal="children">
            {sp.quotes.map((q, i) => (
              <li key={`${i}-${q.name}`}>
                <figure className="sp-quote">
                  <Quote size={18} aria-hidden className="sp-quote-mark" />
                  <blockquote>
                    <p>
                      {ph && <span className="sr-only">Placeholder quote: </span>}
                      {q.quote}
                    </p>
                  </blockquote>
                  <figcaption>
                    <span className="sp-avatar" aria-hidden>
                      {q.name
                        .split(/\s+/)
                        .map((w) => w[0])
                        .join('')
                        .slice(0, 2)}
                    </span>
                    <span>
                      <strong>{q.name}</strong>
                      {q.role && <span className="sp-role">{q.role}</span>}
                    </span>
                    {ph && <PlaceholderTag />}
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
