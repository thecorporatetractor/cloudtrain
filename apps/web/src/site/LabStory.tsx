import { useRef, type ReactNode } from 'react';
import type { SiteConfig } from '@/api/types';
import { cn } from '@/lib/utils';
import { LabPreview, LINE, LINE_COUNT, STORY_PASSED } from './LabPreview';
import { DUR, EASE, STORY } from './motion/tokens';
import { useScrollScene, type Motion } from './motion';

/*
 * The hero and the story of a lab, as one section. Left, the hero copy and then
 * the four stages of a lab (content/site.yaml `howItWorks`: choose, start, work,
 * validate); right, the lab window (LabPreview), which stays in view (sticky)
 * while the stages scroll past. At the top of the page the window is the cluster
 * view of the lab (the cards, the wires, the objective, a terminal beside the
 * facts of the session) and plays a short idle sequence when the page opens (the
 * first command runs, worker-1 turns out to be NotReady). The story is four
 * scenes with fixed stops the page steps between (motion/stops.ts): the first
 * step morphs the cluster view into the compact window (the cards shrink into
 * the pills of the topology, the terminal takes the width) and every step after
 * types the commands, brings the nodes up or ticks the checks. The copy of a
 * stage fades in as its stop arrives and out as it leaves. On phones the window
 * sits above the stages and stays below the header.
 *
 * Without motion (prefers-reduced-motion, a prerendered page before its script,
 * an engine that did not load) the markup is the complete page: every stage is
 * readable, the lab shows its cluster view and its whole session, nothing is sticky.
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
          <LabPreview />
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

/** The least room under the last stage, in the site's px (the hero's bottom padding with motion). */
const STORY_TAIL = 48;
/** The terminal shows at most this many lines: older ones scroll off the top. Beside the checks, fewer. */
const TERM_LINES = { alone: 8, withChecks: 5 } as const;
/** The lines the hero's terminal shows: its command, the table, the prompt. */
const HERO_LINES = LINE.heroEnd - LINE.hero + 2;

type NodeState = 'up' | 'down' | 'off';

/**
 * The story as scenes with stops. Time runs in stops: 0 is the hero (the cluster
 * view after its idle sequence: `kubectl get nodes`, worker-1 NotReady), 1 the lab
 * chosen (the cluster view has morphed into the compact window, the terminal
 * unchanged), 2 started (`ct start`, the nodes come up), 3 worked (the diagnosis
 * and the fix, worker-1 up), 4 validated (the checks ticked, three of four
 * passed). The scroll position maps onto that time through the stops of the
 * stages, so every stop of the page is one scene and the same scroll position
 * always gives the same frame. All of it is scripted here and in LabPreview:
 * nothing comes from the API.
 *
 * Everything on screen is a function of the one time value: the scenes and the
 * stage copy in `tl`, the morph in `morph` (rebuilt from measurements whenever
 * the layout changes, then rendered at the same time again), and the node states
 * from `setState`. Nothing is left to a tween that could be interrupted half-way.
 */
function buildStory({ gsap, ScrollTrigger, stopFor, compact }: Motion, root: HTMLElement) {
  const q = gsap.utils.selector(root);
  const lab = q<HTMLElement>('.lab-preview')[0];
  const stages = q<HTMLElement>('.story-stage');
  const copies = q<HTMLElement>('.story-stage-in');
  const visual = q<HTMLElement>('.story-visual')[0]!;
  if (!lab || stages.length < 4) return;
  const last = 4;

  const term = q<HTMLElement>('.lab-preview-term')[0]!;
  const idle = q<HTMLElement>('.lab-preview-idle');
  const lines = q<HTMLElement>('.lab-preview-lines > .lab-preview-line:not(.lab-preview-idle):not(.lab-preview-rest)').slice(0, LINE_COUNT);
  const rest = q<HTMLElement>('.lab-preview-rest');
  const checks = q<HTMLElement>('.lab-preview-checks')[0]!;
  const items = q('.lab-preview-checks li');
  const icons = q('.lab-preview-check-icon');
  const passed = q<HTMLElement>('.lab-preview-passed')[0];
  const heroCopy = q<HTMLElement>('.story-hero-copy')[0]!;
  const nodeEls = (name: string) => [...q(`.lab-preview-node[data-node="${name}"] .lab-preview-status`), ...q(`.lab-preview-card[data-node="${name}"]`)];
  const up = [...nodeEls('cp-1'), ...nodeEls('worker-2')];
  const w1 = nodeEls('worker-1');

  root.classList.add('is-live');

  // The terminal is sized to its content, up to a few lines; beyond that the lines scroll up
  // (a terminal scrolls, it does not fade). Heights are tweened so the window never jumps.
  const linesEl = q<HTMLElement>('.lab-preview-lines')[0]!;
  const lineH = parseFloat(getComputedStyle(lines[0] ?? term).lineHeight) || 20;
  const termStyle = getComputedStyle(term);
  const pad = (parseFloat(termStyle.paddingTop) || 0) + (parseFloat(termStyle.paddingBottom) || 0);
  const termH = (n: number) => n * lineH + pad;
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
  // of the stages centre the copy the same way, motion/stops.ts). On a phone it sits under the
  // header. Measured in window pixels, written in the site's own (its zoom, motion/stops.ts).
  const zoom = () => (lab.offsetWidth ? lab.getBoundingClientRect().width / lab.offsetWidth : 1);
  const header = () => document.querySelector('.site-header')?.getBoundingClientRect().height ?? 0;
  const place = () => {
    if (compact) return;
    const h = header();
    const z = zoom();
    const vh = visual.getBoundingClientRect().height;
    const top = Math.max(h + 12 * z, Math.round(h + (window.innerHeight - h - vh) / 2));
    visual.style.setProperty('--story-top', `${Math.round(top / z)}px`);
    // The room under the last stage: the hero's bottom padding, or more when the window (centred
    // like the stage) is taller than a stage, so it is still stuck beside it at the last stop. No
    // more than that: the step from the last stage to the next section must stay within a viewport.
    const stageH = stages[stages.length - 1]!.getBoundingClientRect().height;
    root.style.setProperty('--story-tail', `${Math.ceil(Math.max(STORY_TAIL * z, (vh - stageH) / 2 + 2) / z)}px`);
  };
  const sizes = new ResizeObserver(place);
  sizes.observe(visual);
  window.addEventListener('resize', place);
  place();

  /** The story time, the one value everything on screen follows. */
  const time = { t: 0 };

  // The state that is not a tween, from the story time: node status, the meter, the active stage.
  let booting: boolean | undefined;
  let w1State = '';
  let active = -1;
  let w1Hold: NodeState | undefined; // the idle sequence holds worker-1 grey until its NotReady line prints
  const setState = (t: number) => {
    const isBooting = t >= 1.12 && t < 1.5;
    if (isBooting !== booting) {
      booting = isBooting;
      lab.classList.toggle('is-booting', isBooting);
      up.forEach((el) => el.setAttribute('data-state', isBooting ? 'off' : 'up'));
    }
    const next: NodeState = w1Hold ?? (isBooting ? 'off' : t < 2.92 ? 'down' : 'up');
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

  // The window before any scene: the hero's lines, no checks (set now, not as zero-time
  // members of a paused timeline, which would not render at time 0).
  const hero = lines.slice(LINE.hero, LINE.heroEnd + 1);
  gsap.set(lines, { display: 'none' });
  gsap.set(idle, { display: 'block' });
  gsap.set(term, { height: termH(1) });
  gsap.set(linesEl, { y: 0 });
  gsap.set(checks, { height: 0, opacity: 0 });

  // The scenes, in stop time.
  const tl = gsap.timeline({ paused: true, defaults: { ease: EASE.none } });
  // 0 -> 1, chosen: the window morphs (below); the terminal keeps the hero's lines.
  // 1 -> 2, started: `ct start`, the environment comes up, the session begins.
  let n = HERO_LINES;
  hide(tl, rest, 1.1);
  type(tl, lines[LINE.start]!, 1.1, 0.2);
  fit(tl, 1.1, n);
  show(tl, [lines[LINE.start + 1]!], 1.35);
  fit(tl, 1.35, ++n);
  show(tl, [lines[LINE.start + 2]!], 1.5);
  fit(tl, 1.5, ++n);
  show(tl, [lines[LINE.start + 3]!], 1.65);
  fit(tl, 1.65, ++n);
  show(tl, rest, 1.82);
  fit(tl, 1.82, ++n);
  // 2 -> 3, worked: the diagnosis and the fix; worker-1 comes up on the last `Ready` line.
  hide(tl, rest, 2.05);
  type(tl, lines[LINE.work]!, 2.05, 0.2);
  show(tl, [lines[LINE.work + 1]!], 2.3);
  fit(tl, 2.3, ++n);
  type(tl, lines[LINE.work + 2]!, 2.4, 0.22);
  fit(tl, 2.4, ++n);
  type(tl, lines[LINE.work + 3]!, 2.7, 0.14);
  fit(tl, 2.7, ++n);
  show(tl, [lines[LINE.work + 4]!], 2.92);
  fit(tl, 2.92, ++n);
  show(tl, rest, 2.97);
  fit(tl, 2.97, ++n);
  // 3 -> 4, validated: `ct validate`, the checks panel takes the lower part of the window, the checks tick.
  hide(tl, rest, 3.05);
  type(tl, lines[LINE.validate]!, 3.05, 0.14);
  fit(tl, 3.28, n, TERM_LINES.withChecks);
  tl.to(checks, { height: checksH, opacity: 1, duration: 0.16 }, 3.28);
  tl.from(items, { opacity: 0, x: -8, duration: 0.08, stagger: 0.1 }, 3.48);
  tl.from(icons, { scale: 0.4, transformOrigin: '50% 50%', duration: 0.08, ease: 'back.out(3)', stagger: 0.1 }, 3.48);
  if (passed) {
    const counter = { n: 0 };
    passed.textContent = '0';
    tl.to(counter, { n: STORY_PASSED, duration: 0.1 * STORY_PASSED, snap: { n: 1 }, onUpdate: () => (passed.textContent = String(counter.n)) }, 3.52);
  }
  show(tl, rest, 3.9);
  fit(tl, 3.9, ++n, TERM_LINES.withChecks);
  tl.to({}, { duration: 0.02 }, last - 0.02);

  // The copy: the hero's fades up and away over the first step; each stage's copy fades in (rising,
  // sharpening) as its stop arrives and out as it leaves, a function of the time like everything else.
  const { copyFloor: floor, copyRise: rise, copyBlur: blur } = STORY;
  tl.fromTo(heroCopy, { opacity: 1, y: 0 }, { opacity: floor, y: -rise, duration: 0.5 }, 0);
  copies.forEach((el, i) => {
    const at = i + 1;
    tl.fromTo(el, { opacity: floor, y: rise, filter: `blur(${blur}px)` }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.5 }, at - 0.5);
    if (i < copies.length - 1) tl.to(el, { opacity: floor, y: -rise, filter: `blur(${blur}px)`, duration: 0.5 }, at);
  });

  /*
   * The morph, 0 -> 1: the cluster view becomes the compact window. Each card travels and shrinks
   * so that its status dot lands on its pill's (a transform about that dot), its details fading
   * first and its frame last, while the pills come in under it; the objective and the wires fade;
   * the stage shrinks from the canvas's height to the topology's; the facts panel folds away and
   * the terminal takes the width. Built from measurements, so it is rebuilt whenever they change.
   */
  const stage = q<HTMLElement>('.lab-preview-stage')[0]!;
  const canvas = q<HTMLElement>('.lab-preview-canvas')[0]!;
  const canvasBg = q<HTMLElement>('.lab-preview-canvas-bg');
  const objective = q<HTMLElement>('.lab-preview-objective');
  const wires = q<HTMLElement>('.lab-preview-wires');
  const topo = q<HTMLElement>('.lab-preview-topo')[0]!;
  const cards = q<HTMLElement>('.lab-preview-card');
  const details = q<HTMLElement>('.lab-preview-card-lines, .lab-preview-badge, .lab-preview-tab');
  const body = q<HTMLElement>('.lab-preview-body')[0]!;
  const kv = q<HTMLElement>('.lab-preview-kv')[0]!;
  const { morphFrom: m0, morphTo: m1 } = STORY;
  const span = m1 - m0;
  let morph: gsap.core.Timeline | undefined;
  const measureMorph = () => {
    // Measure at rest: the old morph at its start puts every card back where the layout has it.
    morph?.progress(0).kill();
    const sh = canvas.offsetHeight;
    const th = topo.offsetHeight;
    const kvW = kv.offsetWidth;
    const z = zoom(); // rects are in window pixels, the transforms in the site's own
    const m = (morph = gsap.timeline({ paused: true, defaults: { ease: EASE.none } }));
    const seg = (from: number, to: number) => ({ at: m0 + from * span, duration: (to - from) * span });
    const s1 = seg(0, 1);
    m.fromTo(stage, { height: sh }, { height: th, ...s1 }, s1.at);
    m.fromTo(objective, { opacity: 1, y: 0 }, { opacity: 0, y: -6, ...seg(0, 0.35) }, seg(0, 0.35).at);
    m.fromTo(wires, { opacity: 1 }, { opacity: 0, ...seg(0, 0.4) }, seg(0, 0.4).at);
    m.fromTo(details, { opacity: 1 }, { opacity: 0, ...seg(0, 0.25) }, seg(0, 0.25).at);
    m.fromTo(canvasBg, { opacity: 1 }, { opacity: 0, ...seg(0.2, 0.8) }, seg(0.2, 0.8).at);
    for (const card of cards) {
      const name = card.dataset.node!;
      const dot = card.querySelector<HTMLElement>('.lab-preview-dot');
      const pill = topo.querySelector<SVGGElement>(`.lab-preview-node[data-node="${name}"]`);
      const pillDot = pill?.querySelector<SVGCircleElement>('.lab-preview-status');
      if (!dot || !pill || !pillDot) continue;
      const c = card.getBoundingClientRect();
      const d = dot.getBoundingClientRect();
      const p = pill.getBoundingClientRect();
      const pd = pillDot.getBoundingClientRect();
      // Shrinks to a little more than the pill's height, about its dot, so its name lands by the pill's.
      const scale = Math.min(0.7, Math.max(0.4, (1.3 * p.height) / c.height));
      const dx = (pd.left + pd.width / 2 - (d.left + d.width / 2)) / z;
      const dy = (pd.top + pd.height / 2 - (d.top + d.height / 2)) / z;
      m.fromTo(card, { x: 0, y: 0, scale: 1, transformOrigin: `${(d.left + d.width / 2 - c.left) / z}px ${(d.top + d.height / 2 - c.top) / z}px` }, { x: dx, y: dy, scale, ...s1 }, s1.at);
      m.fromTo(card, { opacity: 1 }, { opacity: 0, ...seg(0.3, 0.75) }, seg(0.3, 0.75).at);
    }
    m.fromTo(topo, { autoAlpha: 0 }, { autoAlpha: 1, ...seg(0.5, 1) }, seg(0.5, 1).at);
    m.set(canvas, { visibility: 'hidden' }, m1);
    if (kvW > 0) {
      m.fromTo(kv, { opacity: 1, x: 0 }, { opacity: 0, x: 10, ...seg(0, 0.5) }, seg(0, 0.5).at);
      m.fromTo(body, { '--lp-kv': `${kvW}px` }, { '--lp-kv': '0px', ...seg(0.1, 0.85) }, seg(0.1, 0.85).at);
    }
    m.time(Math.min(1, time.t), true);
  };

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
  const render = () => {
    tl.time(time.t);
    morph?.time(Math.min(1, time.t));
    setState(time.t);
  };
  const sync = (immediate = false) => {
    stops = stages.map((el) => stopFor(el));
    const t = timeAt(window.scrollY);
    if (t > 0.02 && idleTl.isActive()) idleTl.progress(1);
    if (t === lastT) return;
    lastT = t;
    if (immediate) {
      gsap.killTweensOf(time);
      time.t = t;
      render();
    } else gsap.to(time, { t, duration: DUR.fast, ease: EASE.soft, overwrite: true, onUpdate: render });
  };
  // The idle sequence of the hero: the first command runs and prints the table; worker-1, grey until
  // then, turns out NotReady on its line (once, on arrival).
  const idleTl = gsap.timeline({ paused: true, defaults: { ease: EASE.none } });
  idleTl.call(() => ((w1Hold = 'off'), setState(time.t)), [], 0);
  hide(idleTl, idle, 0.5);
  type(idleTl, hero[0]!, 0.5, 0.45);
  show(idleTl, [hero[1]!], 1.15);
  fit(idleTl, 1.15, 2);
  show(idleTl, [hero[2]!], 1.25);
  fit(idleTl, 1.25, 3);
  show(idleTl, [hero[3]!], 1.35);
  fit(idleTl, 1.35, 4);
  idleTl.call(() => ((w1Hold = undefined), setState(time.t)), [], 1.35);
  show(idleTl, [hero[4]!], 1.45);
  fit(idleTl, 1.45, 5);
  show(idleTl, rest, 1.7);
  fit(idleTl, 1.7, 6);
  const settle = () => {
    // The hero's lines, whatever the idle sequence got to (a tab in the background, a scroll).
    w1Hold = undefined;
    gsap.set(idle, { display: 'none' });
    gsap.set([...hero, ...rest], { display: 'block', clipPath: 'none' });
    gsap.set(term, { height: termH(HERO_LINES) });
    gsap.set(linesEl, { y: 0 });
    setState(time.t);
  };
  idleTl.eventCallback('onComplete', settle);

  const trigger = ScrollTrigger.create({ start: 0, end: 'max', onUpdate: () => sync(), onRefresh: () => (measureMorph(), sync(true)) });

  // Measurements follow the layout: the window's width (not its height, which the morph itself
  // changes), the loaded face, the pills' geometry (not the topology's own style, which the morph sets).
  let remeasure = 0;
  const scheduleMeasure = () => {
    cancelAnimationFrame(remeasure);
    remeasure = requestAnimationFrame(measureMorph);
  };
  let labW = lab.offsetWidth;
  const labSize = new ResizeObserver(() => {
    if (lab.offsetWidth === labW) return;
    labW = lab.offsetWidth;
    scheduleMeasure();
  });
  labSize.observe(lab);
  const topoChange = new MutationObserver(scheduleMeasure);
  topoChange.observe(topo.querySelector('svg')!, { attributes: true, subtree: true, attributeFilter: ['transform', 'width', 'd', 'x', 'y'] });
  document.fonts?.ready.then(scheduleMeasure);

  measureMorph();
  sync(true);
  if (window.scrollY < 2 && document.visibilityState === 'visible') idleTl.play();
  else {
    idleTl.progress(1);
    settle();
  }

  return () => {
    trigger.kill();
    sizes.disconnect();
    labSize.disconnect();
    topoChange.disconnect();
    cancelAnimationFrame(remeasure);
    gsap.killTweensOf(time);
    morph?.kill();
    window.removeEventListener('resize', place);
    visual.style.removeProperty('--story-top');
    root.style.removeProperty('--story-tail');
    root.classList.remove('is-live');
    lab.classList.remove('is-booting');
    stages.forEach((el) => el.classList.remove('is-active'));
    [...up, ...w1].forEach((el) => el.setAttribute('data-state', el.matches('.lab-preview-card[data-node="worker-1"]') ? 'down' : 'up'));
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
