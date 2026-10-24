import { useRef, type ReactNode } from 'react';
import type { SiteConfig } from '@/api/types';
import { cn } from '@/lib/utils';
import { LabPreview, STORY_LINE_COUNT, STORY_PASSED } from './LabPreview';
import { DUR, EASE } from './motion/tokens';
import { useScrollScene, type Motion } from './motion';

/*
 * The hero and the story of a lab, as one section. Left, the hero copy and then
 * the four stages of a lab (content/site.yaml `howItWorks`: choose, start, work,
 * validate); right, the lab window (LabPreview in story mode), which stays in
 * view (sticky) while the stages scroll past. The window plays an idle sequence
 * when the page opens (the environment comes up, a first command runs) and the
 * story is four scenes with fixed stops the page steps between (motion/stops.ts):
 * each step types the commands, brings the nodes up or ticks the checks, and
 * settles on the next scene. On phones the window sits above the stages and
 * stays below the header.
 *
 * Without motion (prefers-reduced-motion, a prerendered page before its script,
 * an engine that did not load) the markup is the complete page: every stage is
 * readable, the lab shows its end state, nothing is sticky.
 */

export function HeroStory({ site, children, className }: { site: SiteConfig; children: ReactNode; className?: string }) {
  const root = useRef<HTMLElement>(null);
  const steps = site.howItWorks;

  useScrollScene(root, (m) => buildStory(m, root.current!), [steps.length]);
  useScrollScene(root, (m) => heroEntrance(m, root.current!));

  return (
    <section ref={root} className={cn('site-hero story', className)} aria-labelledby="hero-title">
      <div className="site-hero-bg" aria-hidden />
      <div className="site-container site-hero-inner story-grid">
        <div className="site-hero-copy story-hero-copy">{children}</div>
        <div className="site-hero-visual story-visual">
          <LabPreview mode="story" />
        </div>
        <div className="story-stages-wrap">
          <h2 id="how-title" className="sr-only">
            How a lab works
          </h2>
          <ol className="story-stages" id="how-it-works" aria-labelledby="how-title">
            {steps.map((step, i) => (
              <li key={step.title} className="story-stage">
                <div className="story-stage-in">
                  <p className="site-eyebrow">
                    <span className="site-eyebrow-n tnum">{String(i + 1).padStart(2, '0')}</span>
                    How a lab works
                  </p>
                  <h3>{step.title}</h3>
                  <p className="story-stage-body">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/** The terminal shows at most this many lines: older ones scroll off the top. Beside the checks, fewer. */
const TERM_LINES = { alone: 8, withChecks: 5 } as const;

/**
 * The story as scenes with stops. Time runs in stops: 0 is the hero (the window
 * after its idle sequence: environment up, first command and its output), 1 the
 * lab chosen (a clean window and the topology), 2 started (the nodes come up,
 * the first command runs), 3 worked (the diagnosis and the fix, worker-1 up),
 * 4 validated (the checks ticked, three of four passed). The scroll position
 * maps onto that time through the stops of the stages, so every stop of the page
 * is one scene and the same scroll position always gives the same frame. All of
 * it is scripted here and in LabPreview: nothing comes from the API.
 */
function buildStory({ gsap, ScrollTrigger, stopFor, compact }: Motion, root: HTMLElement) {
  const q = gsap.utils.selector(root);
  const lab = q<HTMLElement>('.lab-preview')[0];
  const stages = q<HTMLElement>('.story-stage');
  const visual = q<HTMLElement>('.story-visual')[0]!;
  if (!lab || stages.length < 4) return;
  const last = 4;

  const term = q<HTMLElement>('.lab-preview-term')[0]!;
  const boot = q<HTMLElement>('.lab-preview-boot');
  const idle = q<HTMLElement>('.lab-preview-idle');
  const typed = q<HTMLElement>('.lab-preview-lines > .lab-preview-line:not(.lab-preview-boot):not(.lab-preview-idle):not(.lab-preview-rest)').slice(0, STORY_LINE_COUNT);
  const rest = q<HTMLElement>('.lab-preview-rest');
  const checks = q<HTMLElement>('.lab-preview-checks')[0]!;
  const items = q('.lab-preview-checks li');
  const icons = q('.lab-preview-check-icon');
  const passed = q<HTMLElement>('.lab-preview-passed')[0];
  const status = (name: string) => q(`.lab-preview-node[data-node="${name}"] .lab-preview-status`);
  const up = [...status('cp-1'), ...status('worker-2')];
  const w1 = status('worker-1');

  root.classList.add('is-live');

  // The terminal is sized to its content, up to a few lines; beyond that the lines scroll up
  // (a terminal scrolls, it does not fade). Heights are tweened so the window never jumps.
  const linesEl = q<HTMLElement>('.lab-preview-lines')[0]!;
  const lineH = parseFloat(getComputedStyle(typed[0] ?? term).lineHeight) || 20;
  const termStyle = getComputedStyle(term);
  const pad = (parseFloat(termStyle.paddingTop) || 0) + (parseFloat(termStyle.paddingBottom) || 0);
  const termH = (lines: number) => lines * lineH + pad;
  const checksH = checks.scrollHeight;
  /** The terminal after `n` lines are showing, with room for `cap` of them. */
  const fit = (tl: gsap.core.Timeline, at: number, n: number, cap: number = TERM_LINES.alone) => {
    tl.to(term, { height: termH(Math.min(n, cap)), duration: 0.08, ease: EASE.soft }, at);
    tl.to(linesEl, { y: -Math.max(0, n - cap) * lineH, duration: 0.08, ease: EASE.soft }, at);
  };

  // Line visibility is display (a terminal scrolls, it does not fade) and typing is a clip.
  const show = (tl: gsap.core.Timeline, els: Element[], at: number) => tl.set(els, { display: 'block' }, at);
  const hide = (tl: gsap.core.Timeline, els: Element[], at: number) => tl.set(els, { display: 'none' }, at);
  const type = (tl: gsap.core.Timeline, el: HTMLElement, at: number, seconds: number) => {
    const chars = Number(el.dataset.chars) || 20;
    show(tl, [el], at);
    tl.fromTo(el, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: seconds, ease: `steps(${chars})` }, at);
  };

  // The window sits centred in the viewport below the header, whatever its height (the stops
  // of the stages centre the copy the same way, motion/stops.ts). On a phone it sits under the header.
  const header = () => (document.querySelector('.site-header') as HTMLElement | null)?.offsetHeight ?? 0;
  const place = () => {
    if (compact) return;
    const h = header();
    visual.style.setProperty('--story-top', `${Math.max(h + 12, Math.round(h + (window.innerHeight - h - visual.offsetHeight) / 2))}px`);
  };
  const sizes = new ResizeObserver(place);
  sizes.observe(visual);
  window.addEventListener('resize', place);
  place();

  // The state that is not a tween, from the story time: node status, the meter, the active stage copy.
  let booting: boolean | undefined;
  let w1State = '';
  let active = -1;
  const setState = (t: number) => {
    const isBooting = t >= 0.4 && t < 1.45;
    if (isBooting !== booting) {
      booting = isBooting;
      lab.classList.toggle('is-booting', isBooting);
      up.forEach((el) => el.setAttribute('data-state', isBooting ? 'off' : 'up'));
    }
    const next = isBooting ? 'off' : t < 0.4 || (t >= 1.9 && t < 2.92) ? 'down' : t >= 2.92 ? 'up' : 'off';
    if (next !== w1State) {
      w1State = next;
      w1.forEach((el) => el.setAttribute('data-state', next));
    }
    const stage = Math.min(3, Math.max(0, Math.round(t) - 1));
    if (stage !== active) {
      active = stage;
      stages.forEach((el, i) => el.classList.toggle('is-active', i === stage));
    }
  };

  // The window before any scene: an empty prompt, the checks still to come (set now, not as
  // zero-time members of a paused timeline, which would not render at time 0).
  gsap.set(term, { height: termH(1) });
  gsap.set(linesEl, { y: 0 });
  gsap.set(checks, { height: 0, opacity: 0 });

  // The scenes, in stop time.
  const tl = gsap.timeline({ paused: true, defaults: { ease: EASE.none } });
  // 0 -> 1, chosen: the window clears, the topology stands alone.
  hide(tl, [...boot, ...typed, ...rest], 0.4);
  show(tl, idle, 0.4);
  fit(tl, 0.4, 1);
  // 1 -> 2, started: the environment comes up, the first command runs.
  show(tl, [boot[0]!], 1.1);
  fit(tl, 1.1, 2);
  show(tl, [boot[1]!], 1.25);
  fit(tl, 1.25, 3);
  show(tl, [boot[2]!], 1.4);
  fit(tl, 1.4, 4);
  hide(tl, idle, 1.55);
  type(tl, typed[0]!, 1.55, 0.2);
  show(tl, [typed[1]!], 1.8);
  fit(tl, 1.8, 5);
  show(tl, [typed[2]!], 1.85);
  fit(tl, 1.85, 6);
  show(tl, [typed[3]!], 1.9);
  fit(tl, 1.9, 7);
  show(tl, rest, 1.96);
  fit(tl, 1.96, 8);
  // 2 -> 3, worked: the diagnosis and the fix; worker-1 comes up on the last `Ready` line.
  hide(tl, rest, 2.05);
  type(tl, typed[4]!, 2.05, 0.2);
  show(tl, [typed[5]!], 2.3);
  fit(tl, 2.3, 9);
  type(tl, typed[6]!, 2.4, 0.22);
  fit(tl, 2.4, 10);
  type(tl, typed[7]!, 2.7, 0.14);
  fit(tl, 2.7, 11);
  show(tl, [typed[8]!], 2.92);
  fit(tl, 2.92, 12);
  show(tl, rest, 2.97);
  fit(tl, 2.97, 13);
  // 3 -> 4, validated: `ct validate`, the checks panel takes the lower part of the window, the checks tick.
  hide(tl, rest, 3.05);
  type(tl, typed[9]!, 3.05, 0.14);
  fit(tl, 3.28, 13, TERM_LINES.withChecks);
  tl.to(checks, { height: checksH, opacity: 1, duration: 0.16 }, 3.28);
  tl.from(items, { opacity: 0, x: -8, duration: 0.08, stagger: 0.1 }, 3.48);
  tl.from(icons, { scale: 0.4, transformOrigin: '50% 50%', duration: 0.08, ease: 'back.out(3)', stagger: 0.1 }, 3.48);
  if (passed) {
    const counter = { n: 0 };
    passed.textContent = '0';
    tl.to(counter, { n: STORY_PASSED, duration: 0.1 * STORY_PASSED, snap: { n: 1 }, onUpdate: () => (passed.textContent = String(counter.n)) }, 3.52);
  }
  show(tl, rest, 3.9);
  fit(tl, 3.9, 14, TERM_LINES.withChecks);
  tl.to({}, { duration: 0.02 }, last - 0.02);

  // The idle sequence of the hero: the environment comes up, a first command runs (once, on arrival).
  gsap.set([...boot, ...typed, ...rest], { display: 'none' });
  gsap.set(idle, { display: 'block' });
  const idleTl = gsap.timeline({ paused: true, defaults: { ease: EASE.none } });
  idleTl.call(() => setState(1.0), [], 0.05);
  show(idleTl, [boot[0]!], 0.7);
  fit(idleTl, 0.7, 2);
  show(idleTl, [boot[1]!], 1.3);
  fit(idleTl, 1.3, 3);
  idleTl.call(() => setState(1.5), [], 1.5);
  show(idleTl, [boot[2]!], 1.7);
  fit(idleTl, 1.7, 4);
  hide(idleTl, idle, 2.1);
  type(idleTl, typed[0]!, 2.1, 0.4);
  show(idleTl, [typed[1]!], 2.75);
  fit(idleTl, 2.75, 5);
  show(idleTl, [typed[2]!], 2.85);
  fit(idleTl, 2.85, 6);
  show(idleTl, [typed[3]!], 2.95);
  fit(idleTl, 2.95, 7);
  idleTl.call(() => setState(0), [], 2.95);
  show(idleTl, rest, 3.15);
  fit(idleTl, 3.15, 8);

  // Scroll -> story time: piecewise linear through the stops of the stages (recomputed on each
  // update, so a resize moves the scenes with the stops). The hero is time 0 at the top.
  let stops: number[] = [];
  let lastT = -1;
  const timeAt = (y: number) => {
    let t = 0;
    for (let k = 0; k < stops.length; k++) {
      const a = k === 0 ? 0 : stops[k - 1]!;
      const b = stops[k]!;
      if (y <= a) break;
      t = b <= a ? k + 1 : k + Math.min(1, (y - a) / (b - a));
    }
    return Math.min(last, t);
  };
  const sync = (immediate = false) => {
    stops = stages.map((el) => stopFor(el));
    const t = timeAt(window.scrollY);
    if (t > 0.02 && idleTl.isActive()) idleTl.progress(1);
    if (t === lastT) return;
    lastT = t;
    if (immediate) tl.time(t);
    else gsap.to(tl, { time: t, duration: 0.35, ease: EASE.soft, overwrite: true });
    setState(t);
  };
  const trigger = ScrollTrigger.create({ start: 0, end: 'max', onUpdate: () => sync(), onRefresh: () => sync(true) });

  sync(true);
  if (window.scrollY < 2 && document.visibilityState === 'visible') idleTl.play();
  else {
    idleTl.progress(1);
    if (window.scrollY < 2) {
      gsap.set([...boot, ...typed.slice(0, 4), ...rest], { display: 'block', clipPath: 'none' });
      gsap.set(term, { height: termH(TERM_LINES.alone) });
    }
  }

  return () => {
    trigger.kill();
    sizes.disconnect();
    window.removeEventListener('resize', place);
    visual.style.removeProperty('--story-top');
    root.classList.remove('is-live');
    lab.classList.remove('is-booting');
    stages.forEach((el) => el.classList.remove('is-active'));
    [...up, ...w1].forEach((el) => el.removeAttribute('data-state'));
    if (passed) passed.textContent = String(STORY_PASSED);
  };
}

/**
 * The hero entrance: headline, copy and window rise in. Only "from" tweens on
 * elements whose resting state is the page as it is, built before the first
 * paint, and finished by force after a moment if anything delays them, so the
 * headline is never left hidden. Skipped when the page has already painted
 * without it (a late engine, a reload further down, a background tab).
 */
function heroEntrance({ gsap, sync }: Motion, root: HTMLElement) {
  if (!sync || window.scrollY > 2 || document.visibilityState !== 'visible' || performance.now() > 1600) return;
  const q = gsap.utils.selector(root);
  const tl = gsap.timeline({ defaults: { ease: EASE.expo } });
  tl.from(q('.story-hero-copy > h1'), { opacity: 0, y: 22, duration: 0.9 }, 0.05);
  tl.from(q('.story-hero-copy > :not(h1)'), { opacity: 0, y: 14, duration: DUR.base, ease: EASE.out, stagger: DUR.stagger }, 0.3);
  tl.from(q('.story-visual'), { opacity: 0, y: 12, duration: 0.7, ease: EASE.out }, 0.25);
  const backstop = window.setTimeout(() => tl.progress(1), 2500);
  return () => window.clearTimeout(backstop);
}
