import { describe, expect, it } from 'vitest';
import { planStops } from './stops';

/* The stop planner (motion/stops.ts) on a page 10000px long with a 1000px viewport. */
const VH = 1000;
const MAX = 9000;

describe('planStops', () => {
  it('stops at every marked top, the top and the end of the page', () => {
    expect(planStops([{ top: 1200, contentBottom: 1800 }, { top: 3000, contentBottom: 3600 }], VH, MAX)).toEqual([0, 1200, 3000, 9000]);
  });

  it('crosses spacer space (a viewport-tall box with short content, the margin after it) in one step', () => {
    // a block at 1000 whose content ends at 1600 inside a 1200px box, the next block at 2300
    expect(planStops([{ top: 1000, contentBottom: 1600 }, { top: 2300, contentBottom: 2900 }], VH, MAX)).toEqual([0, 1000, 2300, 9000]);
  });

  it('adds further stops down a block whose content is taller than the viewport, the last one showing its end', () => {
    // content from 1000 to 3400: 1000, 1900 (a viewport less the overlap), then the end (3400 - 1000 + 24)
    expect(planStops([{ top: 1000, contentBottom: 3400 }], VH, MAX)).toEqual([0, 1000, 1900, 2424, 9000]);
  });

  it('leaves out a remainder that would reveal less than a meaningful amount', () => {
    // 1150px of content: the 174px below the fold is not worth a stop
    expect(planStops([{ top: 1000, contentBottom: 2150 }], VH, MAX)).toEqual([0, 1000, 9000]);
    // 1300px of content: 324px is
    expect(planStops([{ top: 1000, contentBottom: 2300 }], VH, MAX)).toEqual([0, 1000, 1324, 9000]);
  });

  it('never makes a further stop within a meaningful amount of a marked top', () => {
    // the block's end stop (2424) would sit 76px before the next marked top at 2500: the top wins
    expect(planStops([{ top: 1000, contentBottom: 3400 }, { top: 2500, contentBottom: 3000 }], VH, MAX)).toEqual([0, 1000, 1900, 2500, 9000]);
  });

  it('merges marked tops closer than the merge distance (the first wins) and clamps to the page', () => {
    expect(planStops([{ top: 8990, contentBottom: 9500 }, { top: 9020, contentBottom: -Infinity }, { top: -5, contentBottom: 400 }], VH, MAX)).toEqual([0, 8990]);
    expect(planStops([{ top: 9020, contentBottom: -Infinity }], VH, MAX)).toEqual([0, 9000]);
  });

  it('ignores the content of a block that holds other marked stops', () => {
    expect(planStops([{ top: 0, contentBottom: -Infinity }, { top: 600, contentBottom: 900 }], VH, MAX)).toEqual([0, 600, 9000]);
  });
});
