/*
 * The predefined scroll positions of the website ("stops") and the stepping
 * between them. A stop is the hero (the top), each stage of the hero story at
 * its reading line, every section of the page (its top under the header, and
 * its bottom edge when it is taller than the viewport), the sub-headings of
 * the pricing explanation, and the end of the page.
 *
 * With a mouse or trackpad (Lenis runs): one wheel gesture moves one stop, with
 * an animated scroll that settles there; keys do the same (PageUp/PageDown,
 * Space, the arrows, Home/End). Between two stops further apart than a viewport
 * the page scrolls freely, and when it rests it settles on a stop it crossed or
 * came close to. On touch the browser scrolls natively (its own physics) and,
 * when the scroll rests, the page settles on a stop it came close to. Under
 * prefers-reduced-motion none of this runs (the engine is never loaded).
 */

const COMPACT = '(max-width: 1023px)';
/** Stops closer than this are one stop. */
const MERGE = 32;
/** A gesture: wheel events less than this far apart belong together (trackpad inertia). */
const GESTURE_GAP = 200;
/** After the free scroll rests, a stop this close pulls the page to it. */
const PULL = 0.22;

const headerHeight = () => (document.querySelector('.site-header') as HTMLElement | null)?.offsetHeight ?? 0;
const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

/** The scroll position that shows `el` as a stop: the hero at 0, a stage at its reading line, anything else under the header. */
export function stopFor(el: Element): number {
  const top = el.getBoundingClientRect().top + window.scrollY;
  const vh = window.innerHeight;
  let offset = headerHeight();
  if (el.classList.contains('story-stage')) {
    // A stage reads centred in the viewport below the header, where the lab window sits
    // (LabStory.tsx places it there); on a phone it reads just below the window.
    const h = (el as HTMLElement).offsetHeight;
    if (window.matchMedia(COMPACT).matches) {
      const visual = document.querySelector('.story-visual') as HTMLElement | null;
      offset = offset + 8 + (visual?.offsetHeight ?? vh * 0.4) + 16;
    } else offset = offset + Math.max(0, (vh - offset - h) / 2);
  }
  if (el.classList.contains('site-hero')) offset = top;
  return Math.max(0, Math.min(maxScroll(), Math.round(top - offset)));
}

/** The element whose stop a link target belongs to: itself, the first stop inside it, or the stop around it. */
export function stopElementFor(target: Element): Element | undefined {
  if (target.matches(STOP_SELECTOR)) return target;
  return target.querySelector(STOP_SELECTOR) ?? target.closest(STOP_SELECTOR) ?? undefined;
}

const STOP_SELECTOR = '.site-hero, .story-stage, main .site-section, main .pm-subhead, .site-footer';

/** Every stop of the page, ascending; none on a page that opts out (`[data-no-stops]`, the legal texts) or has no sections. */
export function collectStops(): number[] {
  if (document.querySelector('[data-no-stops]')) return [];
  const vh = window.innerHeight;
  const header = headerHeight();
  const max = maxScroll();
  const ys = [0, max];
  for (const el of document.querySelectorAll(STOP_SELECTOR)) {
    const y = stopFor(el);
    ys.push(y);
    // A section taller than the viewport: its bottom edge is a stop too.
    if (el.matches('.site-section')) {
      const r = el.getBoundingClientRect();
      if (r.height > vh - header) ys.push(Math.min(max, Math.round(r.bottom + window.scrollY - vh)));
    }
  }
  if (ys.length <= 2) return []; // nothing but the top and the end: the page scrolls freely
  ys.sort((a, b) => a - b);
  const out: number[] = [];
  for (const y of ys) {
    const last = out[out.length - 1];
    if (last === undefined || y - last > MERGE) out.push(y);
  }
  return out;
}

export interface Stepper {
  /** Scrolls to a stop position with the stepping animation. */
  go(y: number): void;
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
  let from = 0;
  let restTimer = 0;

  const nearest = (stops: number[], y: number) => stops.reduce((best, s) => (Math.abs(s - y) < Math.abs(best - y) ? s : best), stops[0] ?? 0);
  const at = (stops: number[], y: number) => stops.find((s) => Math.abs(s - y) <= 3);
  const nextOf = (stops: number[], y: number, dir: number) => (dir > 0 ? stops.find((s) => s > y + 3) : [...stops].reverse().find((s) => s < y - 3));

  const go = (y: number) => {
    window.clearTimeout(animating);
    animating = window.setTimeout(() => (animating = 0), 2000); // a safety net, if the scroll never reports completion
    animate(y, () => {
      window.clearTimeout(animating);
      animating = 0;
    });
  };

  /** One step from the current position: to the next stop, or a viewport's worth inside a long gap. */
  const step = (dir: number) => {
    const stops = collectStops();
    if (stops.length === 0) return false;
    const y = window.scrollY;
    const next = nextOf(stops, y, dir);
    if (next === undefined) return false;
    const here = at(stops, y) ?? y;
    const gap = Math.abs(next - here);
    const vh = window.innerHeight;
    if (gap <= vh + 2) {
      go(next);
      return true;
    }
    const page = Math.round(vh * 0.82);
    go(dir > 0 ? Math.min(next, y + page) : Math.max(next, y - page));
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
    if (stops.length === 0) return;
    const y = window.scrollY;
    const here = at(stops, y);
    const next = nextOf(stops, y, dir);
    if (here !== undefined && next !== undefined && Math.abs(next - here) <= window.innerHeight + 2) {
      free = false;
      swallow();
      go(next);
      return;
    }
    // Inside a long gap, or past the last stop: the page scrolls freely and settles on rest.
    free = true;
    from = y;
  };

  const onRest = () => {
    if (animating || !free) return;
    const stops = collectStops();
    const y = window.scrollY;
    if (stops.length === 0 || at(stops, y) !== undefined) return;
    const lo = Math.min(from, y);
    const hi = Math.max(from, y);
    const crossed = stops.filter((s) => s > lo + 3 && s < hi - 3);
    const target = crossed.length > 0 ? (y > from ? crossed[0]! : crossed[crossed.length - 1]!) : nearest(stops, y);
    if (Math.abs(target - y) <= window.innerHeight * PULL || crossed.length > 0) {
      free = false;
      go(target);
    }
  };

  const onScroll = () => {
    window.clearTimeout(restTimer);
    restTimer = window.setTimeout(onRest, 180);
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
  window.addEventListener('scroll', onScroll, { passive: true });
  return {
    go,
    stop() {
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(restTimer);
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
  const go = (y: number) => {
    window.clearTimeout(animating);
    animating = window.setTimeout(() => (animating = 0), 2000);
    animate(y, () => {
      window.clearTimeout(animating);
      animating = 0;
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
