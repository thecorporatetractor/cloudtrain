/*
 * The motion layer of the public website, as seen by components: small, in the
 * main bundle, no GSAP or Lenis in it. The engine (./engine.ts, GSAP +
 * ScrollTrigger + Lenis) is imported on demand and never when the visitor
 * prefers reduced motion: then there is no smooth scroll, no pinning and no
 * scrubbing, and every section is the finished, still page.
 *
 * `html.motion` is set before first paint by public/theme-init.js when motion
 * is allowed, and `html.motion-ready` once the engine has set every scene's
 * initial state: site.css pre-hides the few things that start their entrance
 * hidden (hero headline words, the story terminal) only in between, so they
 * neither blink nor stay hidden when the engine does not load.
 */
import { useEffect, useLayoutEffect, useState, type DependencyList, type RefObject } from 'react';
import type { Gsap } from './engine';

type Engine = typeof import('./engine');
type Ctx = ReturnType<Gsap['context']>;
export type { Gsap };

/** Handles a scene's `build` receives. */
export interface Motion {
  gsap: Gsap;
  ScrollTrigger: Engine['ScrollTrigger'];
  /** Whether the viewport is a phone or small tablet (the hero story is not sticky there). */
  compact: boolean;
  /** True when the scene is built before the component's first paint (the engine was already there): it may start things hidden. */
  sync: boolean;
  /** Scrolls the page (through Lenis when it runs). */
  scrollTo: Engine['scrollTo'];
  /** The scroll position that shows an element as a stop (motion/stops.ts). */
  stopFor: Engine['stopFor'];
}

let allowed: boolean | undefined;
/** Whether the visitor gets motion at all (not with prefers-reduced-motion, never during SSR). */
export function motionAllowed(): boolean {
  if (allowed !== undefined) return allowed;
  if (typeof window === 'undefined' || !window.matchMedia) return (allowed = false);
  allowed = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return allowed;
}

let engine: Engine | undefined;
let loading: Promise<Engine | undefined> | undefined;

function markReady() {
  // After the scenes that awaited the engine have set their initial states (microtasks), before the next paint.
  requestAnimationFrame(() => document.documentElement.classList.add('motion-ready'));
}

/** Loads and starts the engine once; resolves to undefined when motion is off or the chunk fails. */
export function loadMotion(): Promise<Engine | undefined> {
  if (engine) return Promise.resolve(engine);
  if (!motionAllowed()) return Promise.resolve(undefined);
  if (!loading) {
    const html = document.documentElement;
    html.classList.add('motion');
    // A slow network must not keep the headline hidden: fall back to the still page.
    const bail = window.setTimeout(() => html.classList.remove('motion'), 2500);
    loading = import('./engine')
      .then((mod) => {
        window.clearTimeout(bail);
        if (!html.classList.contains('motion')) return undefined; // bailed: the still page stays
        engine = mod;
        mod.start();
        markReady();
        return mod;
      })
      .catch(() => {
        window.clearTimeout(bail);
        html.classList.remove('motion');
        return undefined;
      });
  }
  return loading;
}

const COMPACT = '(max-width: 1023px)';
export const isCompact = () => window.matchMedia(COMPACT).matches;

/** Flips when the viewport crosses the compact breakpoint, so scenes rebuild for the other layout. */
function useCompactFlip(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && isCompact());
  useEffect(() => {
    const mq = window.matchMedia(COMPACT);
    const on = () => setCompact(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

/**
 * A scroll scene for one component: `build` runs inside a gsap.context scoped to
 * `ref` (selector text is scoped too) once the engine is there, and everything it
 * created is reverted when the component unmounts, the route changes or `deps`
 * change. It may return a function for extra cleanup. Nothing runs under
 * prefers-reduced-motion.
 */
export function useScrollScene(ref: RefObject<HTMLElement | null>, build: (m: Motion, ctx: Ctx) => void | (() => void), deps: DependencyList = []) {
  const compact = useCompactFlip();
  useLayoutEffect(() => {
    if (!motionAllowed() || !ref.current) return;
    let ctx: Ctx | undefined;
    let extra: void | (() => void);
    let cancelled = false;
    const run = (mod: Engine | undefined, sync: boolean) => {
      if (cancelled || !mod || !ref.current) return;
      ctx = mod.gsap.context(() => {
        extra = build({ gsap: mod.gsap, ScrollTrigger: mod.ScrollTrigger, compact: isCompact(), sync, scrollTo: mod.scrollTo, stopFor: mod.stopFor }, ctx!);
      }, ref.current);
      mod.refreshSoon();
    };
    if (engine) run(engine, true);
    else void loadMotion().then((mod) => run(mod, false));
    return () => {
      cancelled = true;
      extra?.();
      ctx?.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, ...deps]);
}

/** Scrolls the website to an element or a position: through Lenis when it runs, natively otherwise. */
export function siteScrollTo(target: Element | number, opts: { immediate?: boolean } = {}) {
  if (engine) return engine.scrollTo(target, opts);
  // 'instant', not 'auto': the website's html has scroll-behavior: smooth, which 'auto' would follow.
  if (typeof target === 'number') return window.scrollTo({ top: target, behavior: opts.immediate ? 'instant' : 'smooth' });
  target.scrollIntoView({ block: 'start', behavior: opts.immediate || !motionAllowed() ? 'instant' : 'smooth' });
}

/** A new website page is on screen: its short entrance (nothing when motion is off or the engine is not there yet). */
export function sitePageEnter(el: Element | null) {
  if (el && engine) engine.pageEnter(el);
}
