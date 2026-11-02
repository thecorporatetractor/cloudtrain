import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Link } from '@tanstack/react-router';
import { ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type { SiteConfig, SiteFeatureItem, SiteFeaturePage, SiteFigure } from '@/api/types';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/*
 * The product screens of the website (content/site.yaml `featurePage`): the
 * image that follows the visitor's theme with its 1x and 2x candidates, the
 * lightbox of the features page, and the homepage callout with the featured
 * screens. The page itself is src/routes/site/Features.tsx.
 */


/** The id of a feature on the page (`/features#the-lab-workspace`). */
export const featureId = (item: SiteFeatureItem) => item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** The groups with their items, in the configured order; a group without items, or an item without a group, is left out. */
export function featureGroups(page: SiteFeaturePage): { id: string; title: string; lead?: string; items: SiteFeatureItem[] }[] {
  return page.groups.map((g) => ({ ...g, items: page.items.filter((it) => it.group === g.id) })).filter((g) => g.items.length > 0);
}

/** The featured items the homepage shows (the first three, in a configured group). */
export function featuredItems(page: SiteFeaturePage): SiteFeatureItem[] {
  const groups = new Set(page.groups.map((g) => g.id));
  return page.items.filter((it) => it.featured && groups.has(it.group)).slice(0, 3);
}

/** The sources of a figure for the current theme: the image and, when there is one, the 2x candidate. */
export function figureSources(figure: SiteFigure, theme: string): { src: string; src2x?: string } {
  if (theme === 'dark') return { src: figure.image, ...(figure.image2x ? { src2x: figure.image2x } : {}) };
  const src = figure.imageLight ?? figure.image;
  const src2x = figure.imageLight ? figure.imageLight2x : figure.image2x;
  return { src, ...(src2x ? { src2x } : {}) };
}

/**
 * A screen in a window frame, lazy and with its intrinsic size reserved. The dark image
 * serves the dark theme, the light one the light and cream themes; a 2x image, when the
 * figure has one, is offered to high-density screens through `srcset`.
 */
export function FeatureShot({ figure, sizes, className }: { figure: SiteFigure; sizes: string; className?: string }) {
  const { theme } = useTheme();
  const { src, src2x } = figureSources(figure, theme);
  const width = figure.width ?? 1440;
  return (
    <span className={cn('site-shot', className)}>
      <img src={src} {...(src2x ? { srcSet: `${src} ${width}w, ${src2x} ${width * 2}w` } : {})} sizes={sizes} alt={figure.alt} width={width} height={figure.height ?? 900} loading="lazy" decoding="async" />
    </span>
  );
}

/* --------------------------------------------------------------- lightbox */

export interface LightboxEntry {
  figure: SiteFigure;
  /** The feature the figure belongs to. */
  title: string;
}

/**
 * The enlarged screen: a dialog over the page with the figure at its 2x size, its
 * description, and previous/next through every screen of the page (the arrow keys
 * too). Escape closes it and the focus returns to the thumbnail that opened it.
 */
export function Lightbox({ entries, index, onChange, returnTo }: { entries: LightboxEntry[]; index: number | null; onChange: (i: number | null) => void; returnTo: (i: number) => HTMLElement | null }) {
  const { theme } = useTheme();
  // The screen the lightbox was opened from: the focus goes back to its thumbnail, whatever was stepped to since.
  const opened = useRef<number | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (index !== null && !wasOpen.current) opened.current = index;
    wasOpen.current = index !== null;
  }, [index]);
  const entry = index === null ? undefined : entries[index];
  const step = (d: number) => {
    if (index === null || entries.length === 0) return;
    onChange((index + d + entries.length) % entries.length);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') (e.preventDefault(), step(1));
    else if (e.key === 'ArrowLeft') (e.preventDefault(), step(-1));
  };
  // A click on the backdrop around the image closes; one on the controls or the image does not.
  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onChange(null);
  };
  const sources = entry ? figureSources(entry.figure, theme) : undefined;
  return (
    <DialogPrimitive.Root open={index !== null} onOpenChange={(open) => !open && onChange(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay site-lightbox-overlay" />
        <DialogPrimitive.Content
          className="site-lightbox"
          data-lenis-prevent
          aria-describedby={undefined}
          onKeyDown={onKey}
          onClick={onBackdrop}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const i = opened.current;
            if (i !== null) returnTo(i)?.focus({ preventScroll: true });
          }}
        >
          <DialogPrimitive.Title className="site-lightbox-title">{entry?.title ?? 'Screen'}</DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <button type="button" className="site-icon-btn site-lightbox-close" aria-label="Close">
              <X size={18} />
            </button>
          </DialogPrimitive.Close>
          {entry && sources && (
            <figure className="site-lightbox-figure" onClick={onBackdrop}>
              <img key={sources.src} src={sources.src2x ?? sources.src} alt={entry.figure.alt} width={entry.figure.width ?? 1440} height={entry.figure.height ?? 900} decoding="async" />
              <figcaption>{entry.figure.alt}</figcaption>
            </figure>
          )}
          {entries.length > 1 && (
            <div className="site-lightbox-nav">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => step(-1)} aria-label="Previous screen">
                <ChevronLeft size={14} aria-hidden /> Previous
              </button>
              <span className="site-lightbox-count tnum" aria-live="polite">
                {index === null ? '' : `${index + 1} of ${entries.length}`}
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => step(1)} aria-label="Next screen">
                Next <ChevronRight size={14} aria-hidden />
              </button>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ---------------------------------------------------------- the callout */

/**
 * The homepage section that leads to the features page: the featured screens, each a
 * link to its feature, and the link to the whole page. Still and complete without a
 * script; the reveal on scroll is the only motion.
 */
export function FeatureCallout({ site }: { site: SiteConfig }) {
  const page = site.featurePage;
  if (!page) return null;
  const items = featuredItems(page);
  if (items.length === 0) return null;
  const c = page.callout ?? {};
  return (
    <section className="site-section site-section-tall site-features-callout" id="features" aria-labelledby="features-callout-title" data-stop>
      <div className="site-container">
        <div className="site-section-head">
          <div className="site-section-head-copy" data-reveal="children">
            <p className="site-eyebrow">{c.eyebrow ?? page.eyebrow ?? 'Features'}</p>
            <h2 id="features-callout-title" className="site-h2">
              {c.title ?? page.title}
            </h2>
            {c.body && <p className="site-section-lead">{c.body}</p>}
          </div>
          <Link to="/features" className="btn btn-secondary btn-lg site-section-action">
            {c.linkLabel ?? 'All features'} <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
        <ul className="site-feature-trio" data-reveal="children">
          {items.map((it) => (
            <li key={it.title}>
              <Link to="/features" hash={featureId(it)} className="site-feature-card">
                <FeatureShot figure={it.figures[0]!} sizes="(max-width: 767px) 84vw, (max-width: 1023px) 46vw, 370px" />
                <span className="site-feature-card-title">
                  {it.title} <ArrowRight size={14} aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
