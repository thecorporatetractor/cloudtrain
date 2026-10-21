import { Link, useNavigate } from '@tanstack/react-router';
import { Panel, Separator, usePanelRef, type Layout, type PanelSize } from 'react-resizable-panels';
import { AlertTriangle, CheckCircle2, ChevronLeft, Eye, Keyboard, Lightbulb, Loader2, Maximize2, Megaphone, Minimize2, Network, PanelLeft, PanelLeftClose, PanelRight, Play, Power, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, useEndSession, useLab, useQuestions, useRevealHint, useSession, useStartSession, useValidate } from '@/api/client';
import { isRealApi } from '@/api/mode';
import type { LabSession, SessionNotice, TopologyLink, ValidateResponse } from '@/api/types';
import { useScreenShortcuts, useShell } from '@/app/shell-context';
import { BillingBlocked } from '@/components/billing';
import { DifficultyBadge, SkillTags, StatusDot } from '@/components/domain';
import { Badge, Button, ErrorState, Kbd, Skeleton, Tooltip } from '@/components/ui';
import { PersistedGroup } from '@/components/ui/panels';
import { TaskPanel } from '@/components/workspace/TaskPanel';
import { TerminalArea, focusActiveTerminal, useTerminalModel } from '@/components/workspace/TerminalArea';
import { Timer } from '@/components/workspace/Timer';
import { TopologyCanvas } from '@/components/workspace/Topology';
import { useHotkeys } from '@/lib/hotkeys';
import { useMediaQuery } from '@/lib/media';
import { billingBlockOf } from '@/lib/billing';
import { personalize } from '@/lib/personalize';
import { cn } from '@/lib/utils';
import { workspaceRoute } from '@/router';

type TaskSide = 'left' | 'right';
const LAYOUT_KEY = 'ct.workspace.layout';

interface LayoutPrefs {
  taskSide: TaskSide;
  taskCollapsed: boolean;
  topoCollapsed: boolean;
}

function readLayout(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return { taskSide: 'left', taskCollapsed: false, topoCollapsed: false, ...(JSON.parse(raw) as Partial<LayoutPrefs>) };
  } catch {
    /* ignore */
  }
  return { taskSide: 'left', taskCollapsed: false, topoCollapsed: false };
}

/*
 * Workspace shortcuts avoid keys a shell user relies on. Readline owns Alt+B/F/D/T
 * (word motion, kill-word, transpose) and Ctrl+K/U/W/A/E/L, so actions use
 * Ctrl/⌘+Shift+letter (never seen by the shell) and tab switching uses Alt with
 * digits and brackets, which readline leaves alone in practice. Ctrl+Shift+T/W/N
 * are reserved by browsers and are not used.
 */
const WORKSPACE_SHORTCUTS = [
  {
    title: 'Lab',
    items: [
      { keys: 'mod+enter', description: 'Validate' },
      { keys: 'mod+shift+h', description: 'Reveal next hint' },
      { keys: 'mod+shift+b', description: 'Toggle task panel' },
      { keys: 'mod+shift+arrowleft', description: 'Dock task panel left' },
      { keys: 'mod+shift+arrowright', description: 'Dock task panel right' },
      { keys: 'mod+shift+g', description: 'Toggle topology' },
      { keys: 'mod+shift+f', description: 'Full-screen terminal' },
    ],
  },
  {
    title: 'Terminals',
    items: [
      { keys: 'mod+shift+o', description: 'New console on the jumphost' },
      { keys: 'mod+shift+x', description: 'Close console tab' },
      { keys: 'mod+shift+d', description: 'Split pane' },
      { keys: 'alt+]', description: 'Next tab' },
      { keys: 'alt+[', description: 'Previous tab' },
      { keys: 'alt+1', description: 'Tab 1 … 9' },
    ],
  },
];

export function Workspace() {
  const { labId } = workspaceRoute.useParams();
  const search = workspaceRoute.useSearch();
  const navigate = useNavigate({ from: workspaceRoute.fullPath });
  const shell = useShell();

  const lab = useLab(labId);
  const session = useSession(search.s);
  // Shares the questions panel's cache (header points).
  const questions = useQuestions(search.s, !!lab.data?.spec.questions?.length);
  const start = useStartSession(labId);
  const validate = useValidate(search.s);
  const reveal = useRevealHint(search.s);
  const end = useEndSession(search.s);
  const [lastResult, setLastResult] = useState<ValidateResponse | null>(null);
  const [dismissedNotices, setDismissedNotices] = useState<Set<string>>(() => new Set());

  // Start (or restart) a session when none is attached or it is gone.
  const startingRef = useRef(false);
  useEffect(() => {
    const missing = !search.s || (session.isError && session.error instanceof ApiError && session.error.status === 404);
    if (missing && !startingRef.current && lab.isSuccess) {
      startingRef.current = true;
      start.mutate(undefined, {
        onSuccess: (s) => {
          void navigate({ search: { s: s.id }, replace: true });
          startingRef.current = false;
        },
        // Stay blocked after a failure: the error state's Retry unblocks (no request loop).
        onError: () => undefined,
      });
    }
  }, [search.s, session.isError, session.error, lab.isSuccess, start, navigate]);

  // Layout preferences
  const [layout, setLayout] = useState<LayoutPrefs>(readLayout);
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* ignore */
    }
  }, [layout]);
  const taskRef = usePanelRef();
  const topoRef = usePanelRef();
  // v4 has no onCollapse/onExpand: derive the collapsed flags from the panel size (collapsedSize is 0).
  const onTaskResize = useCallback((size: PanelSize) => {
    const collapsed = size.asPercentage === 0;
    setLayout((x) => (x.taskCollapsed === collapsed ? x : { ...x, taskCollapsed: collapsed }));
  }, []);
  // The topology flag follows the group layout instead: onLayoutChange runs with the layout update
  // itself, while onResize comes a frame later from a ResizeObserver, after React Flow has already
  // measured (and warned about) a zero-height canvas.
  const onVerticalLayout = useCallback((l: Layout) => {
    const collapsed = l.topo === 0;
    setLayout((x) => (x.topoCollapsed === collapsed ? x : { ...x, topoCollapsed: collapsed }));
  }, []);
  const chromeless = shell.chromeless;

  // Leave full-screen when the workspace unmounts (the setter is stable; `shell` is not).
  const { setChromeless: setShellChromeless } = shell;
  useEffect(() => () => setShellChromeless(false), [setShellChromeless]);

  const toggleTask = useCallback(() => {
    const p = taskRef.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
    focusActiveTerminal();
  }, []);
  const toggleTopo = useCallback(() => {
    const p = topoRef.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
    focusActiveTerminal();
  }, []);
  const dock = useCallback((side: TaskSide) => {
    setLayout((l) => ({ ...l, taskSide: side }));
    taskRef.current?.expand();
    focusActiveTerminal();
  }, []);
  const setChromeless = useCallback(
    (v: boolean) => {
      shell.setChromeless(v);
      focusActiveTerminal();
    },
    [shell],
  );

  // The lab as this attempt sees it: resolved {{params}}, revealed hint content.
  const effLab = useMemo(() => (lab.data ? personalize(lab.data, session.data) : undefined), [lab.data, session.data]);

  // Terminals
  const terminals = useTerminalModel(effLab, isRealApi);
  const { toast } = shell;

  const onCapture = useCallback(
    (link: TopologyLink) => {
      terminals.openCapture(link);
      toast({ title: 'Capture started', description: `${link.a} ↔ ${link.b}`, tone: 'neutral' });
    },
    [terminals, toast],
  );
  const onImpair = useCallback((link: TopologyLink) => toast({ title: 'Link impairment', description: `tc netem on ${link.a} ↔ ${link.b} is available once the orchestrator is wired up.`, tone: 'warn' }), [toast]);

  const runValidate = useCallback(() => {
    if (!search.s || validate.isPending) return;
    validate.mutate(undefined, {
      onSuccess: (r) => {
        setLastResult(r);
        if (r.grading && r.grading.state !== 'complete') {
          toast({ title: r.grading.state === 'timeout' ? 'No grading result yet' : 'Grading failed', description: r.grading.message, tone: 'warn' });
          return;
        }
        const all = r.summary.passed === r.summary.total;
        toast({ title: all ? 'All checks passed' : `${r.summary.passed} of ${r.summary.total} checks passed`, description: `Score ${r.summary.score} / 100`, tone: all ? 'ok' : r.summary.passed ? 'neutral' : 'warn' });
      },
    });
  }, [search.s, validate, toast]);

  const endLab = useCallback(() => {
    if (!search.s || end.isPending) return;
    end.mutate(undefined, {
      onSuccess: () => {
        toast({ title: 'Lab ended', description: 'The environment is being torn down.', tone: 'neutral' });
        void navigate({ to: '/labs/$labId', params: { labId } });
      },
      onError: (e) => toast({ title: 'Could not end the lab', description: e.message, tone: 'warn' }),
    });
  }, [search.s, end, toast, navigate, labId]);

  const revealNext = useCallback(() => {
    const hints = lab.data?.spec.hints ?? [];
    const revealed = session.data?.revealedHints ?? [];
    const next = hints.findIndex((_, i) => !revealed.includes(i));
    if (next >= 0) reveal.mutate(next);
  }, [lab.data, session.data, reveal]);

  /**
   * Keys the workspace takes before xterm sees them. Matched on the physical key (e.code)
   * so they work with Option on macOS. Everything else, including Alt+B/F/D, Ctrl+K and
   * dead keys for accented input, reaches the shell.
   */
  const ownsKey = useCallback((e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && !e.altKey) return /^(Key[BDFGHOXL]|ArrowLeft|ArrowRight)$/.test(e.code);
    if (mod && !e.shiftKey && !e.altKey) return e.key === 'Enter';
    if (e.altKey && !mod && !e.shiftKey) return /^(Digit[1-9]|BracketLeft|BracketRight)$/.test(e.code);
    return false;
  }, []);

  useHotkeys([
    { keys: 'mod+enter', description: 'Validate', group: 'Lab', global: true, handler: runValidate },
    { keys: 'mod+shift+h', description: 'Reveal next hint', group: 'Lab', global: true, handler: revealNext },
    { keys: 'mod+shift+b', description: 'Toggle task panel', group: 'Lab', global: true, handler: toggleTask },
    { keys: 'mod+shift+arrowleft', description: 'Dock task panel left', group: 'Lab', global: true, handler: () => dock('left') },
    { keys: 'mod+shift+arrowright', description: 'Dock task panel right', group: 'Lab', global: true, handler: () => dock('right') },
    { keys: 'mod+shift+g', description: 'Toggle topology', group: 'Lab', global: true, handler: toggleTopo },
    { keys: 'mod+shift+f', description: 'Full-screen terminal', group: 'Lab', global: true, handler: () => setChromeless(!chromeless) },
    { keys: 'mod+shift+o', description: 'New console', group: 'Terminals', global: true, handler: () => effLab && terminals.openConsole(effLab.spec.topology.entry ?? effLab.spec.topology.nodes[0]!.name) },
    { keys: 'mod+shift+x', description: 'Close tab', group: 'Terminals', global: true, handler: () => terminals.closeTab() },
    { keys: 'mod+shift+d', description: 'Split pane', group: 'Terminals', global: true, handler: terminals.split },
    { keys: 'alt+]', description: 'Next tab', group: 'Terminals', global: true, handler: () => terminals.cycleTab(1) },
    { keys: 'alt+[', description: 'Previous tab', group: 'Terminals', global: true, handler: () => terminals.cycleTab(-1) },
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ keys: `alt+${n}`, description: `Tab ${n}`, group: 'Terminals', global: true, handler: () => terminals.selectTab(n - 1) })),
    { keys: 'escape', description: 'Exit full-screen', group: 'Lab', handler: () => chromeless && setChromeless(false) },
  ]);
  useScreenShortcuts(WORKSPACE_SHORTCUTS);
  const stacked = useMediaQuery('(max-width: 640px)');

  if (lab.isPending) {
    return (
      <div className="ws ws-loading" aria-busy>
        <div className="ws-header">
          <Skeleton w={320} h={16} />
        </div>
        <div className="ws-body" style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 1 }}>
          <Skeleton h="100%" style={{ borderRadius: 0 }} />
          <Skeleton h="100%" style={{ borderRadius: 0 }} />
        </div>
      </div>
    );
  }
  if (lab.isError) {
    return (
      <div className="page page-narrow">
        <ErrorState title="Lab unavailable" error={lab.error} onRetry={() => void lab.refetch()} />
      </div>
    );
  }
  if (start.isError && billingBlockOf(start.error)) {
    return (
      <div className="page page-narrow">
        <BillingBlocked block={billingBlockOf(start.error)!} />
        <p className="small" style={{ marginTop: 14 }}>
          <Link to="/labs/$labId" params={{ labId }} className="link-quiet">
            Back to the lab
          </Link>
        </p>
      </div>
    );
  }
  if (start.isError) {
    return (
      <div className="page page-narrow">
        <ErrorState
          title="Could not start the lab environment"
          error={start.error}
          onRetry={() => {
            startingRef.current = false;
            start.reset();
          }}
        />
      </div>
    );
  }

  const l = effLab!;
  const s = session.data;
  const ended = s?.phase === 'failed' || s?.phase === 'expired' || s?.status === 'failed' || s?.status === 'expired';
  const provisioning = ended ? 0 : (s?.nodes.filter((n) => n.status === 'provisioning').length ?? 0);
  const envReady = !!s && !ended && provisioning === 0 && (s.phase === undefined || s.phase === 'ready' || s.phase === 'grading');
  const gradingNote = lastResult?.grading && lastResult.grading.state !== 'complete' ? lastResult.grading : undefined;
  const passedCount = s?.results.filter((r) => r.status === 'pass').length ?? 0;
  const hasChecks = l.spec.checks.length > 0;
  const done = s?.status === 'passed';
  const observers = (s?.notices ?? []).filter((n) => n.kind === 'observed' && n.active !== false);
  const messages = (s?.notices ?? []).filter((n) => n.kind !== 'observed' && !dismissedNotices.has(n.id));

  const taskPanel = (
    <Panel id="task" panelRef={taskRef} collapsible collapsedSize="0%" minSize="18%" defaultSize="28%" maxSize="45%" onResize={onTaskResize} className="ws-task-panel">
      <TaskPanel lab={l} session={s} validating={validate.isPending} onRevealHint={(i) => reveal.mutate(i)} revealing={reveal.isPending} ready={envReady} />
    </Panel>
  );

  return (
    <div className={cn('ws', chromeless && 'ws-chromeless')}>
      <header className="ws-header">
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          {!chromeless && (
            <Tooltip content="Back to lab overview">
              <Link to="/labs/$labId" params={{ labId }} className="btn btn-ghost btn-sm btn-icon" aria-label="Back to lab overview">
                <ChevronLeft size={15} />
              </Link>
            </Tooltip>
          )}
          <h1 className="ws-title truncate">{l.metadata.title}</h1>
          {!chromeless && <DifficultyBadge difficulty={l.metadata.difficulty} />}
          {provisioning > 0 && (
            <Badge tone="warn">
              <StatusDot status="provisioning" /> provisioning {provisioning} {provisioning === 1 ? 'node' : 'nodes'}
            </Badge>
          )}
          {done && (
            <Badge tone="ok">
              <CheckCircle2 size={11} /> complete
            </Badge>
          )}
          {s?.status === 'failed' && (
            <Badge tone="err">
              <AlertTriangle size={11} /> environment failed
            </Badge>
          )}
          {s?.status === 'expired' && <Badge tone="neutral">session ended</Badge>}
        </div>

        <div className="row" style={{ gap: 6 }}>
          {chromeless && (
            <span className="ws-chromeless-hint xs subtle" aria-hidden>
              <Kbd keys="mod+shift+f" /> exit
            </span>
          )}
          {s && (
            <>
              <span className="ws-stat tnum" title="Score">
                <span className="subtle">score</span> {s.score}
              </span>
              {hasChecks && (
                <span className="ws-stat tnum" title="Checks passing">
                  <span className="subtle">checks</span> {passedCount}/{l.spec.checks.length}
                </span>
              )}
              {questions.data && (
                <span className="ws-stat tnum" title="Points from questions">
                  <span className="subtle">points</span> {questions.data.earned}/{questions.data.possible}
                </span>
              )}
              <Timer startedAt={s.startedAt} deadlineMinutes={s.deadlineMinutes} />
              <span className="vdivider" style={{ height: 18, margin: '0 4px' }} />
            </>
          )}
          {hasChecks && (
            <Tooltip content="Validate all checks" shortcut="mod+enter">
              <Button variant="primary" size="sm" icon={<Play size={13} />} loading={validate.isPending} disabled={!envReady} onClick={runValidate}>
                Validate
              </Button>
            </Tooltip>
          )}
          {isRealApi && s && !ended && (
            <Tooltip content="End the lab and remove its environment">
              <Button variant="ghost" size="sm" icon={<Power size={13} />} loading={end.isPending} onClick={endLab}>
                End lab
              </Button>
            </Tooltip>
          )}
          <span className="vdivider" style={{ height: 18, margin: '0 4px' }} />
          <div className="segmented segmented-sm" role="group" aria-label="Task panel position">
            <Tooltip content="Dock task panel left" shortcut="mod+shift+arrowleft">
              <button className={cn('segmented-item', layout.taskSide === 'left' && !layout.taskCollapsed && 'is-active')} aria-pressed={layout.taskSide === 'left' && !layout.taskCollapsed} aria-label="Dock task panel left" onClick={() => dock('left')}>
                <PanelLeft size={13} />
              </button>
            </Tooltip>
            <Tooltip content="Hide task panel" shortcut="mod+shift+b">
              <button className={cn('segmented-item', layout.taskCollapsed && 'is-active')} aria-pressed={layout.taskCollapsed} aria-label="Hide task panel" onClick={() => {
                  taskRef.current?.collapse();
                  focusActiveTerminal();
                }}>
                <PanelLeftClose size={13} />
              </button>
            </Tooltip>
            <Tooltip content="Dock task panel right" shortcut="mod+shift+arrowright">
              <button className={cn('segmented-item', layout.taskSide === 'right' && !layout.taskCollapsed && 'is-active')} aria-pressed={layout.taskSide === 'right' && !layout.taskCollapsed} aria-label="Dock task panel right" onClick={() => dock('right')}>
                <PanelRight size={13} />
              </button>
            </Tooltip>
          </div>
          <Tooltip content={layout.topoCollapsed ? 'Show topology' : 'Hide topology'} shortcut="mod+shift+g">
            <Button variant="ghost" size="sm" iconOnly aria-label="Toggle topology" aria-pressed={!layout.topoCollapsed} onClick={toggleTopo} icon={<Network size={14} />} />
          </Tooltip>
          <Tooltip content={chromeless ? 'Exit full-screen' : 'Full-screen terminal'} shortcut="mod+shift+f">
            <Button variant="ghost" size="sm" iconOnly aria-label="Toggle full-screen terminal" aria-pressed={chromeless} onClick={() => setChromeless(!chromeless)} icon={chromeless ? <Minimize2 size={14} /> : <Maximize2 size={14} />} />
          </Tooltip>
          <Tooltip content="Keyboard shortcuts" shortcut="?">
            <Button variant="ghost" size="sm" iconOnly aria-label="Keyboard shortcuts" onClick={() => shell.setShortcutsOpen(true)} icon={<Keyboard size={14} />} />
          </Tooltip>
        </div>
      </header>

      {observers.length > 0 && (
        <div className="ws-notice ws-notice-observed" role="status" aria-live="polite">
          <span className="row small" style={{ gap: 8 }}>
            <Eye size={13} />
            <strong>An instructor is observing this session</strong>
            <span className="muted">
              · {observers.map((n) => n.from?.name ?? 'Instructor').join(', ')} can see your terminal (read-only) · this is recorded in the audit log
            </span>
          </span>
        </div>
      )}
      {messages.map((n) => (
        <NoticeBar key={n.id} notice={n} onDismiss={() => setDismissedNotices((d) => new Set(d).add(n.id))} />
      ))}
      {lastResult && gradingNote && (
        <div className="ws-result ws-result-partial" role="status">
          <span className="row small" style={{ gap: 8 }}>
            <AlertTriangle size={13} className="text-warn" />
            <strong>{gradingNote.state === 'timeout' ? 'No grading result yet' : 'Grading failed'}</strong>
            {gradingNote.message && <span className="muted">· {gradingNote.message}</span>}
          </span>
          <Button variant="ghost" size="sm" iconOnly aria-label="Dismiss" icon={<X size={12} />} onClick={() => setLastResult(null)} />
        </div>
      )}
      {lastResult && !gradingNote && (
        <div className={cn('ws-result', lastResult.summary.passed === lastResult.summary.total ? 'ws-result-ok' : 'ws-result-partial')} role="status">
          <span className="row small" style={{ gap: 8 }}>
            <strong>
              {lastResult.summary.passed} / {lastResult.summary.total} checks passed
            </strong>
            <span className="muted">· score {lastResult.summary.score}</span>
            <span className="muted">· evidence recorded for</span>
            <SkillTags ids={lastResult.summary.skillsTouched} max={6} size="xs" />
          </span>
          <span className="row" style={{ gap: 6 }}>
            {lastResult.summary.passed === lastResult.summary.total && (
              <Link to="/" className="btn btn-secondary btn-sm">
                Back to home
              </Link>
            )}
            <Button variant="ghost" size="sm" iconOnly aria-label="Dismiss" icon={<X size={12} />} onClick={() => setLastResult(null)} />
          </span>
        </div>
      )}

      <div className="ws-body">
        {/* Phones: the task sits above the topology and terminals instead of beside them. */}
        <PersistedGroup key={`${layout.taskSide}-${stacked}`} orientation={stacked ? 'vertical' : 'horizontal'} storageId={stacked ? 'ct.ws.stacked' : `ct.ws.h.${layout.taskSide}`}>
          {layout.taskSide === 'left' && taskPanel}
          {layout.taskSide === 'left' && <Separator className={cn('splitter', stacked ? 'splitter-h' : 'splitter-v')} />}
          <Panel id="main" minSize="40%">
            <PersistedGroup orientation="vertical" storageId="ct.ws.v" onLayoutChange={onVerticalLayout}>
              <Panel id="topo" panelRef={topoRef} collapsible collapsedSize="0%" minSize="15%" defaultSize="30%" maxSize="60%" className="ws-topo-panel">
                <div className="ws-topo">
                  <div className="ws-topo-head">
                    <span className="xs subtle">Topology · click a node to open its console · right-click a link (or Tab to it and press Enter) to capture</span>
                    <span className="row" style={{ gap: 8 }}>
                      {s?.nodes.map((n) => (
                        <span key={n.name} className="row xs mono muted" style={{ gap: 4 }} title={`${n.name}: ${n.status}${n.ip ? ` · ${n.ip}` : ''}`}>
                          <StatusDot status={n.status} /> {n.name}
                        </span>
                      ))}
                    </span>
                  </div>
                  {!layout.topoCollapsed && <TopologyCanvas topology={l.spec.topology} nodeStates={s?.nodes} onOpenNode={(name, access) => terminals.openConsole(name, access)} onCapture={onCapture} onImpair={onImpair} />}
                </div>
              </Panel>
              <Separator className="splitter splitter-h" />
              <Panel id="terminals" minSize="30%">
                {isRealApi && !envReady ? (
                  <EnvironmentState session={s} onRestart={() => void navigate({ search: {}, replace: true })} />
                ) : (
                  <TerminalArea lab={l} model={terminals.model} onFocus={terminals.focus} onClose={terminals.closeTab} onOpenConsole={terminals.openConsole} onCapture={onCapture} onSplit={terminals.split} ownsKey={ownsKey} sessionId={isRealApi ? s?.id : undefined} />
                )}
              </Panel>
            </PersistedGroup>
          </Panel>
          {layout.taskSide === 'right' && <Separator className={cn('splitter', stacked ? 'splitter-h' : 'splitter-v')} />}
          {layout.taskSide === 'right' && taskPanel}
        </PersistedGroup>
      </div>

    </div>
  );
}

function NoticeBar({ notice, onDismiss }: { notice: SessionNotice; onDismiss: () => void }) {
  const hint = notice.kind === 'hint';
  const control = notice.kind === 'extended' || notice.kind === 'reset' || notice.kind === 'terminated';
  return (
    <div className={cn('ws-notice', hint && 'ws-notice-hint', control && 'ws-notice-control')} role="status">
      <span className="row small" style={{ gap: 8, minWidth: 0 }}>
        {hint ? <Lightbulb size={13} /> : <Megaphone size={13} />}
        <strong>{notice.from?.name ?? 'Instructor'}</strong>
        <span className="muted truncate">{notice.message}</span>
      </span>
      <Button variant="ghost" size="sm" iconOnly aria-label="Dismiss" icon={<X size={12} />} onClick={onDismiss} />
    </div>
  );
}

const phaseLabel: Record<NonNullable<LabSession['phase']>, string> = {
  pending: 'Queued',
  provisioning: 'Provisioning',
  ready: 'Ready',
  grading: 'Grading',
  hibernated: 'Hibernated',
  expired: 'Ended',
  failed: 'Failed',
};

/** Real API mode: what stands in for the terminals until the environment is ready (or after it failed). */
function EnvironmentState({ session, onRestart }: { session: LabSession | undefined; onRestart: () => void }) {
  const failed = session?.status === 'failed' || session?.phase === 'failed';
  const over = session?.status === 'expired' || session?.phase === 'expired';
  const ready = session?.nodes.filter((n) => n.status === 'ready').length ?? 0;
  const total = session?.nodes.length ?? 0;
  return (
    <div className="ws-env" role="status" aria-live="polite">
      <div className="ws-env-card">
        <div className="row" style={{ gap: 8 }}>
          {failed ? <AlertTriangle size={15} className="text-err" /> : over ? <Power size={15} className="subtle" /> : <Loader2 size={15} className="spin subtle" aria-hidden />}
          <strong>{failed ? 'The lab environment could not start' : over ? 'This session has ended' : session ? `Starting your lab environment · ${ready}/${total} nodes ready` : 'Requesting a lab environment'}</strong>
          {session?.phase && <Badge tone={failed ? 'err' : 'neutral'}>{phaseLabel[session.phase]}</Badge>}
        </div>
        {session?.message && <p className="small muted ws-env-msg">{session.message}</p>}
        {session && session.nodes.length > 0 && (
          <ul className="ws-env-nodes">
            {session.nodes.map((n) => (
              <li key={n.name} className="row small" style={{ gap: 8 }}>
                <StatusDot status={n.status} />
                <span className="mono">{n.name}</span>
                <span className="subtle xs">{n.status}</span>
                {n.ip && <span className="subtle xs mono">{n.ip}</span>}
                {n.message && <span className="subtle xs truncate">{n.message}</span>}
              </li>
            ))}
          </ul>
        )}
        {(failed || over) && (
          <div className="row" style={{ gap: 8 }}>
            <Button variant="primary" size="sm" onClick={onRestart}>
              Start a new session
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
