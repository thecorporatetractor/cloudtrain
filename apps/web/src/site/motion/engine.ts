/*
 * The motion engine of the public website: GSAP with ScrollTrigger, and Lenis
 * for smooth scrolling, wired together. Loaded on demand by ./index.ts (never
 * when the visitor prefers reduced motion), so the first paint does not wait for
 * it and the pages that do not animate never download it.
 *
 * The website scrolls on the window (site.css `html:has(.shell-site)`): Lenis
 * drives window scrolling from GSAP's ticker and ScrollTrigger reads it, so a
 * scrubbed timeline and the scroll position agree within the same frame.
 *
 * Section reveals: any `[data-reveal]` element (or, with `data-reveal="children"`,
 * its children) rises in once when it scrolls into view. `[data-count]` figures
 * count up to the number they show, `[data-count-range]` sliders sweep to their
 * value, `[data-grow]` bars grow from the left: all once, on entering view, and
 * all with the page's own markup as the end state. Elements already in view when
 * the engine scans are left as they are, so nothing visible ever blinks.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { startRestSnapping, startStepping, stopElementFor, stopFor, type Stepper } from './stops';
import { DUR, EASE, RISE, SCROLL_LERP, SCROLL_TO_DURATION } from './tokens';

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true });

export { gsap, ScrollTrigger, stopFor };
export type Gsap = typeof gsap;

/** Smooth scrolling is for wheel and trackpad; touch keeps the browser's own physics. */
const SMOOTH_QUERY = '(pointer: fine) and (hover: hover)';

let lenis: Lenis | undefined;
let stepper: Stepper | undefined;

/** The animated scroll to a stop: longer for a longer way, never sluggish. */
const stepDuration = (dist: number) => 0.55 + Math.min(0.45, dist / 2400);

function startLenis() {
  if (lenis || !window.matchMedia(SMOOTH_QUERY).matches) return;
  const l = (lenis = new Lenis({ autoRaf: false, lerp: SCROLL_LERP, smoothWheel: true, syncTouch: false, anchors: false }));
  l.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => l.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  // The page moves between its stops (stops.ts): one gesture, one stop.
  stepper = startStepping((y, done) => l.scrollTo(y, { duration: stepDuration(Math.abs(y - window.scrollY)), easing: (t) => 1 - Math.pow(1 - t, 3), lock: true, force: true, onComplete: done }));
  // Radix dialogs and menus lock the body (react-remove-scroll sets data-scroll-locked):
  // Lenis pauses with them, or its target would drift from the real scroll position.
  const locks = new MutationObserver(() => {
    if (!lenis) return;
    if (document.body.hasAttribute('data-scroll-locked')) lenis.stop();
    else lenis.start();
  });
  locks.observe(document.body, { attributes: true, attributeFilter: ['data-scroll-locked'] });
}

/** Where the sticky header ends: anchors scroll to just below it. */
const headerHeight = () => (document.querySelector('.site-header') as HTMLElement | null)?.offsetHeight ?? 0;

/** Scrolls to an element (below the header, honouring its scroll-margin-top) or to a position. */
export function scrollTo(target: Element | number, opts: { immediate?: boolean; duration?: number } = {}) {
  let offset = 0;
  if (typeof target !== 'number') {
    // A link target that is (or holds, or sits in) a stop lands on that stop, like a step would.
    const stop = stopElementFor(target);
    if (stop && stepper && !opts.immediate) return stepper.go(stopFor(stop));
    const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    offset = -(margin || headerHeight());
  }
  if (lenis) {
    lenis.scrollTo(target as HTMLElement | number, { offset, duration: opts.duration ?? SCROLL_TO_DURATION, immediate: opts.immediate, force: true });
    return;
  }
  const top = typeof target === 'number' ? target : target.getBoundingClientRect().top + window.scrollY + offset;
  if (opts.immediate) return window.scrollTo({ top, behavior: 'instant' });
  tweenScroll(top, opts.duration ?? SCROLL_TO_DURATION);
}

let scrollTween: gsap.core.Tween | undefined;
const INTERRUPTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
/**
 * Without Lenis (touch devices) a scroll is tweened here rather than left to the browser's
 * own smooth scrolling, so it lands exactly, and a touch, wheel or key interrupts it.
 */
function tweenScroll(top: number, duration: number, done?: () => void) {
  scrollTween?.kill();
  const pos = { y: window.scrollY };
  const stop = () => {
    scrollTween?.kill();
    scrollTween = undefined;
    for (const ev of INTERRUPTS) window.removeEventListener(ev, stop);
    done?.();
  };
  scrollTween = gsap.to(pos, { y: top, duration, ease: EASE.inOut, overwrite: true, onUpdate: () => window.scrollTo(0, pos.y), onComplete: stop });
  for (const ev of INTERRUPTS) window.addEventListener(ev, stop, { passive: true, once: true });
}

/* ------------------------------------------------------------------ reveals */

function revealTargets(el: HTMLElement): HTMLElement[] {
  return el.dataset.reveal === 'children' ? (Array.from(el.children) as HTMLElement[]) : [el];
}

/** Sets up the reveal of every `[data-reveal]` not yet handled, and drops triggers of removed elements. */
export function scanReveals(root: ParentNode = document) {
  for (const t of ScrollTrigger.getAll()) {
    const el = t.trigger as Element | null;
    if (el && !el.isConnected) t.kill();
  }
  const fold = window.innerHeight * 0.92;
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]:not([data-reveal-done])'));
  for (const el of els) {
    el.setAttribute('data-reveal-done', '');
    const targets = revealTargets(el);
    if (targets.length === 0) continue;
    // Already on screen (first paint, a prerendered page, a hash navigation): leave it.
    if (el.getBoundingClientRect().top < fold) continue;
    gsap.set(targets, { opacity: 0, y: RISE });
    ScrollTrigger.create({
      trigger: el,
      start: 'top 90%',
      once: true,
      onEnter: () => {
        gsap.to(targets, { opacity: 1, y: 0, duration: DUR.base, ease: EASE.out, stagger: DUR.stagger, overwrite: 'auto', clearProps: 'transform' });
      },
    });
  }
}

/** A figure's text as prefix, number and suffix ("€10.80" -> ["€", 10.8, ""], "15" -> ["", 15, ""]). */
function parseFigure(text: string): { prefix: string; value: number; decimals: number; suffix: string; grouped: boolean } | undefined {
  const m = /^(\D*?)(\d[\d,]*)(?:\.(\d+))?(.*)$/s.exec(text.trim());
  if (!m) return undefined;
  const whole = m[2]!.replace(/,/g, '');
  const frac = m[3] ?? '';
  return { prefix: m[1]!, value: Number(whole + (frac ? `.${frac}` : '')), decimals: frac.length, suffix: m[4]!, grouped: m[2]!.includes(',') };
}

/** Counters and growing bars: once, on entering view; the markup is the finished state. */
export function scanFigures(root: ParentNode = document) {
  const fold = window.innerHeight * 0.92;
  const fresh = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(`${sel}:not([data-motion-done])`)).filter((el) => (el.setAttribute('data-motion-done', ''), el.getBoundingClientRect().top >= fold));
  for (const el of fresh('[data-count]')) {
    const fig = parseFigure(el.textContent ?? '');
    if (!fig || fig.value === 0) continue;
    const fmt = new Intl.NumberFormat('en', { minimumFractionDigits: fig.decimals, maximumFractionDigits: fig.decimals, useGrouping: fig.grouped });
    const n = { v: 0 };
    const write = () => (el.textContent = `${fig.prefix}${fmt.format(n.v)}${fig.suffix}`);
    ScrollTrigger.create({ trigger: el, start: 'top 88%', once: true, onEnter: () => gsap.fromTo(n, { v: 0 }, { v: fig.value, duration: 1.1, ease: EASE.expo, onUpdate: write, onComplete: write }) });
  }
  for (const el of fresh('[data-count-range]')) {
    const input = el as HTMLInputElement;
    const to = Number(input.value);
    const from = Number(input.min) || 0;
    if (!(to > from)) continue;
    const n = { v: from };
    ScrollTrigger.create({
      trigger: el,
      start: 'top 88%',
      once: true,
      onEnter: () => gsap.fromTo(n, { v: from }, { v: to, duration: 1.1, ease: EASE.expo, onUpdate: () => (input.value = String(n.v)), onComplete: () => (input.value = String(to)) }),
    });
  }
  for (const el of fresh('[data-grow]')) {
    gsap.set(el, { scaleX: 0, transformOrigin: 'left center' });
    ScrollTrigger.create({ trigger: el, start: 'top 90%', once: true, onEnter: () => gsap.to(el, { scaleX: 1, duration: 0.9, ease: EASE.expo, clearProps: 'transform' }) });
  }
}

/** A new page of the website arrives: a short rise of its content (a from-tween; the page itself is the end state). */
export function pageEnter(el: Element) {
  gsap.fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: EASE.out, clearProps: 'opacity,transform', overwrite: true });
}

let refreshTimer = 0;
/** Recomputes the scroll positions after the layout changed (content arrived, a section mounted, fonts loaded). */
export function refreshSoon() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 120);
}

let watching = false;
/** Watches the page for new sections (routes, data arriving) and keeps reveals and positions current. */
function watch() {
  if (watching) return;
  watching = true;
  let scanTimer = 0;
  const schedule = () => {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      scanReveals();
      scanFigures();
      refreshSoon();
    }, 40);
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  new ResizeObserver(() => refreshSoon()).observe(document.body);
  document.fonts?.ready.then(() => refreshSoon());
}

/** Called once by ./index.ts after the engine is imported. */
export function start() {
  startLenis();
  scanFigures();
  // Touch: the browser scrolls, the page settles on a stop when the scroll rests.
  if (!stepper) stepper = startRestSnapping((y, done) => tweenScroll(y, stepDuration(Math.abs(y - window.scrollY)), done));
  scanReveals();
  watch();
}
