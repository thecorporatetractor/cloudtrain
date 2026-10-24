/*
 * Motion tokens of the public website: the easings and durations every scene
 * shares, so the page moves as one. Kept apart from the engine (which pulls in
 * GSAP and Lenis) so a component can import them without loading either.
 */

/** GSAP ease names. `out` for things that arrive, `inOut` for things that move, `none` for scrubbed timelines. */
export const EASE = {
  out: 'power3.out',
  soft: 'power2.out',
  inOut: 'power2.inOut',
  expo: 'expo.out',
  none: 'none',
} as const;

/** Seconds. */
export const DUR = {
  fast: 0.35,
  base: 0.6,
  slow: 0.9,
  /** Between items of one group. */
  stagger: 0.07,
} as const;

/** How far a revealed element rises from, in px. */
export const RISE = 22;

/** Smooth scroll: how much of the distance is covered per frame (Lenis `lerp`). */
export const SCROLL_LERP = 0.11;
/** Smooth scroll: duration of a programmatic scroll (anchors), in seconds. */
export const SCROLL_TO_DURATION = 1.1;
/** Scrubbed timelines lag the scroll by this many seconds, so wheel steps read as glides. */
export const SCRUB = 0.5;
