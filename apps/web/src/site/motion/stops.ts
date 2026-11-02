/*
 * The predefined scroll positions of the website ("stops") and the stepping
 * between them. A stop is an element marked `data-stop` (the hero, each stage of
 * the hero story at its reading line, the sections of the page under the
 * header, the footer): nothing else is one. A marked block whose content is
 * taller than the viewport gets further stops down its content, each revealing
 * a meaningful amount more, and the last one showing its end; space that is not
 * content (a block centred in a viewport-tall box, the margin after it) never
 * makes a stop, and the step across it is one step. `planStops` is the pure
 * part, tested on its own (stops.test.ts).
 *
 * With a mouse or trackpad (Lenis runs): one wheel gesture moves one stop, with
 * an animated scroll that settles there; keys do the same (PageUp/PageDown,
 * Space, the arrows, Home/End). A page without marks scrolls freely. On touch
 * the browser scrolls natively (its own physics) and, when the scroll rests,
 * the page settles on a stop it came close to. Under prefers-reduced-motion
 * none of this runs (the engine is never loaded).
 */

const COMPACT = '(max-width: 1023px)';
/** Marked stops closer than this are one stop. */
const MERGE = 32;
/** A further stop inside a tall block must reveal at least this much of the viewport. */
const REVEAL = 0.2;
/** Consecutive stops inside a tall block overlap by this much of the viewport, so nothing is skipped. */
const OVERLAP = 0.1;
/** Below the end of a block's content, at its last stop. */
const TAIL = 24;
/** A gesture: wheel events less than this far apart belong together (trackpad inertia). */
const GESTURE_GAP = 200;
/** After the free scroll rests, a stop this close pulls the page to it. */
const PULL = 0.22;

/*
 * The website is drawn at a zoom (site.css `--site-zoom`, 1.25 on a wide screen), so there are
 * two kinds of pixel: element rects and scroll positions are in the window's (zoomed) pixels,
 * offset sizes, computed styles and the values CSS takes are in the site's own. Everything here
 * is in window pixels; `siteZoom` converts where a value crosses over.
 */
const rectHeight = (el: Element | null) => el?.getBoundingClientRect().height ?? 0;
const headerHeight = () => rectHeight(document.querySelector('.site-header'));
const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

/** The site's zoom: window pixels per site pixel (measured, so it holds whatever the browser's zoom semantics). */
export function siteZoom(): number {
  const site = document.querySelector<HTMLElement>('.site');
  return site && site.offsetWidth ? site.getBoundingClientRect().width / site.offsetWidth : 1;
}

/** The scroll position that shows `el` as a stop: the hero at 0, a stage at its reading line, anything else under the header. */
export function stopFor(el: Element): number {
  const top = el.getBoundingClientRect().top + window.scrollY;
  const vh = window.innerHeight;
  let offset = headerHeight();
  if (el.classList.contains('story-stage')) {
    // A stage reads centred in the viewport below the header, where the lab window sits
    // (LabStory.tsx places it there); on a phone it reads just below the window.
    const h = rectHeight(el);
    if (window.matchMedia(COMPACT).matches) {
      const visual = document.querySelector('.story-visual');
      offset = offset + 8 + (visual ? rectHeight(visual) : vh * 0.4) + 16;
    } else offset = offset + Math.max(0, (vh - offset - h) / 2);
  }
  if (el.classList.contains('site-hero')) offset = top;
  return Math.max(0, Math.min(maxScroll(), Math.round(top - offset)));
}

const STOP_SELECTOR = '[data-stop]';

/** The element whose stop a link target belongs to: itself, the first stop inside it, or the stop around it. */
export function stopElementFor(target: Element): Element | undefined {
  if (target.matches(STOP_SELECTOR)) return target;
  return target.querySelector(STOP_SELECTOR) ?? target.closest(STOP_SELECTOR) ?? undefined;
}

/** Elements that show something on their own; with elements holding text, where a block's content is. */
const SHOWS = 'img, svg, video, input, select, textarea, button, table';

/**
 * Where a block's real content ends (page position): the lowest bottom edge among its
 * descendants that show something, text included. The block's own box does not count, so a
 * viewport-tall box with its content centred, or padding, never counts as content; nor does
 * what is not on screen (the answer inside a closed `details`, which keeps its layout).
 */
export function contentBottom(el: Element): number {
  let bottom = -Infinity;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const e = n as Element;
    const closed = e.closest('details:not([open])');
    if (closed && closed !== e && !e.matches('summary, summary *')) continue;
    let shows = e.matches(SHOWS);
    if (!shows) for (const c of e.childNodes) if (c.nodeType === Node.TEXT_NODE && c.textContent?.trim()) shows = true;
    if (!shows) continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    bottom = Math.max(bottom, r.bottom + window.scrollY);
  }
  return bottom === -Infinity ? el.getBoundingClientRect().bottom + window.scrollY : bottom;
}

export interface StopCandidate {
  /** The stop that shows the marked element (page position). */
  top: number;
  /** Where its content ends (page position); -Infinity when the block holds other marked stops. */
  contentBottom: number;
}

/**
 * The stops of a page from its marked candidates: every candidate's top (and the top and the end
 * of the page), then, for a block whose content runs past the viewport of its top by a meaningful
 * amount, further stops down the content (a viewport less the overlap apart) and a last one with
 * the content's end a little above the fold. Tops closer than `merge` are one stop; a further stop
 * within a meaningful amount of any top is left out, so a short remainder never makes a stop.
 */
export function planStops(candidates: StopCandidate[], vh: number, max: number, merge = MERGE): number[] {
  const clamp = (y: number) => Math.max(0, Math.min(max, Math.round(y)));
  const reveal = Math.max(merge, vh * REVEAL);
  const tops: number[] = [];
  for (const y of [0, max, ...candidates.map((c) => c.top)].map(clamp).sort((a, b) => a - b)) {
    const last = tops[tops.length - 1];
    if (last === undefined || y - last > merge) tops.push(y);
  }
  const out = [...tops];
  for (const c of candidates) {
    const end = c.contentBottom - vh + TAIL; // the stop that shows the content's end
    if (!Number.isFinite(end)) continue;
    let y = c.top;
    while (end - y > reveal) {
      y = Math.min(y + vh * (1 - OVERLAP), end);
      const yy = clamp(y);
      if (!out.some((s) => Math.abs(s - yy) <= reveal)) out.push(yy);
    }
  }
  out.sort((a, b) => a - b);
  return out.filter((y, i) => i === 0 || y - out[i - 1]! > merge);
}

/** Every stop of the page, ascending; none on a page that opts out (`[data-no-stops]`, the legal texts) or has no marks. */
export function collectStops(): number[] {
  if (document.querySelector('[data-no-stops]')) return [];
  const els = Array.from(document.querySelectorAll(STOP_SELECTOR));
  if (els.length === 0) return [];
  const candidates: StopCandidate[] = els.map((el) => ({ top: stopFor(el), contentBottom: el.querySelector(STOP_SELECTOR) ? -Infinity : contentBottom(el) }));
  return planStops(candidates, window.innerHeight, maxScroll());
}

export interface Stepper {
  /** Scrolls to a stop position with the stepping animation; `done` runs when it has settled or was interrupted. */
  go(y: number, done?: () => void): void;
  stop(): void;
}

/**
 * Installs wheel and key stepping. `animate` scrolls the window (Lenis) and calls back when
 * it has settled; `onRest` fires when scrolling rests (from the scroll events).
 */
export function startStepping(animate: (y: number, done: () => void) => void): Stepper {
  let animating = 0;
  let lastWheel = 0;
  let free = false;

  const at = (stops: number[], y: number) => stops.find((s) => Math.abs(s - y) <= 3);
  const nextOf = (stops: number[], y: number, dir: number) => (dir > 0 ? stops.find((s) => s > y + 3) : [...stops].reverse().find((s) => s < y - 3));

  const go = (y: number, done?: () => void) => {
    window.clearTimeout(animating);
    animating = window.setTimeout(() => (animating = 0), 2000); // a safety net, if the scroll never reports completion
    animate(y, () => {
      window.clearTimeout(animating);
      animating = 0;
      done?.();
    });
  };

  /** One step from the current position: to the next stop in that direction. */
  const step = (dir: number) => {
    const stops = collectStops();
    if (stops.length === 0) return false;
    const next = nextOf(stops, window.scrollY, dir);
    if (next === undefined) return false;
    go(next);
    return true;
  };

  const locked = () => document.body.hasAttribute('data-scroll-locked');
  const inOwnScroller = (t: EventTarget | null) => t instanceof Element && !!t.closest('[data-lenis-prevent]');

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || locked() || inOwnScroller(e.target)) return;
    const now = performance.now();
    const fresh = now - lastWheel > GESTURE_GAP;
    lastWheel = now;
    const swallow = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (animating) return swallow();
    if (!fresh) {
      if (!free) swallow();
      return;
    }
    const dir = Math.sign(e.deltaY);
    if (!dir) return;
    const stops = collectStops();
    if (stops.length === 0) {
      // A page without stops scrolls freely: the rest of this gesture must not be swallowed.
      free = true;
      return;
    }
    free = false;
    const next = nextOf(stops, window.scrollY, dir);
    swallow();
    if (next !== undefined) go(next);
    else if (at(stops, window.scrollY) === undefined) go(dir > 0 ? stops[stops.length - 1]! : stops[0]!);
  };

  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select|button)$/i.test(t.tagName));
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || locked() || typing(e.target)) return;
    let handled = false;
    if (e.key === 'PageDown' || e.key === 'ArrowDown' || (e.key === ' ' && !e.shiftKey)) handled = animating ? true : step(1);
    else if (e.key === 'PageUp' || e.key === 'ArrowUp' || (e.key === ' ' && e.shiftKey)) handled = animating ? true : step(-1);
    else if (e.key === 'Home') (go(0), (handled = true));
    else if (e.key === 'End') (go(maxScroll()), (handled = true));
    if (handled) e.preventDefault();
  };

  window.addEventListener('wheel', onWheel, { passive: false, capture: true });
  window.addEventListener('keydown', onKey, { capture: true });
  return {
    go,
    stop() {
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
    },
  };
}

/**
 * Touch (no Lenis): native scrolling, and when it rests near a stop the page settles on it.
 * A flick past several stops is left alone, so nothing traps the user.
 */
export function startRestSnapping(animate: (y: number, done: () => void) => void): Stepper {
  let animating = 0;
  let restTimer = 0;
  const go = (y: number, done?: () => void) => {
    window.clearTimeout(animating);
    animating = window.setTimeout(() => (animating = 0), 2000);
    animate(y, () => {
      window.clearTimeout(animating);
      animating = 0;
      done?.();
    });
  };
  const onRest = () => {
    if (animating || document.body.hasAttribute('data-scroll-locked')) return;
    const stops = collectStops();
    if (stops.length === 0) return;
    const y = window.scrollY;
    const target = stops.reduce((best, s) => (Math.abs(s - y) < Math.abs(best - y) ? s : best), stops[0] ?? 0);
    if (Math.abs(target - y) > 3 && Math.abs(target - y) <= window.innerHeight * PULL) go(target);
  };
  const onScroll = () => {
    if (animating) return;
    window.clearTimeout(restTimer);
    restTimer = window.setTimeout(onRest, 200);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  return {
    go,
    stop() {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(restTimer);
    },
  };
}
