import { Link, useNavigate } from '@tanstack/react-router';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { CheckCircle2, ChevronLeft, Keyboard, Maximize2, Minimize2, Network, PanelLeft, PanelLeftClose, PanelRight, Play, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, useLab, useRevealHint, useSession, useStartSession, useValidate } from '@/api/client';
import type { TopologyLink, ValidateResponse } from '@/api/types';
import { useScreenShortcuts, useShell } from '@/app/shell-context';
import { DifficultyBadge, SkillTags, StatusDot } from '@/components/domain';
import { Badge, Button, ErrorState, Kbd, Skeleton, Tooltip } from '@/components/ui';
import { TaskPanel } from '@/components/workspace/TaskPanel';
import { TerminalArea, focusActiveTerminal, useTerminalModel } from '@/components/workspace/TerminalArea';
import { Timer } from '@/components/workspace/Timer';
import { TopologyCanvas } from '@/components/workspace/Topology';
import { useHotkeys } from '@/lib/hotkeys';
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

const WORKSPACE_SHORTCUTS = [
  {
    title: 'Lab',
    items: [
      { keys: 'mod+enter', description: 'Validate' },
      { keys: 'alt+h', description: 'Reveal next hint' },
      { keys: 'alt+b', description: 'Toggle task panel' },
      { keys: 'alt+shift+b', description: 'Dock task panel left / right' },
      { keys: 'alt+g', description: 'Toggle topology' },
      { keys: 'alt+f', description: 'Full-screen terminal' },
    ],
  },
  {
    title: 'Terminals',
    items: [
      { keys: 'alt+t', description: 'New console on the jumphost' },
      { keys: 'alt+w', description: 'Close console tab' },
      { keys: 'alt+d', description: 'Split pane' },
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
  const start = useStartSession(labId);
  const validate = useValidate(search.s);
  const reveal = useRevealHint(search.s);
  const [lastResult, setLastResult] = useState<ValidateResponse | null>(null);

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
        onError: () => {
          startingRef.current = false;
        },
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
  const taskRef = useRef<ImperativePanelHandle>(null);
  const topoRef = useRef<ImperativePanelHandle>(null);
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
  const swapSide = useCallback(() => {
    setLayout((l) => ({ ...l, taskSide: l.taskSide === 'left' ? 'right' : 'left' }));
    focusActiveTerminal();
  }, []);
  const setChromeless = useCallback(
    (v: boolean) => {
      shell.setChromeless(v);
      focusActiveTerminal();
    },
    [shell],
  );

  // Terminals
  const terminals = useTerminalModel(lab.data);
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
        const all = r.summary.passed === r.summary.total;
        toast({ title: all ? 'All checks passed' : `${r.summary.passed} of ${r.summary.total} checks passed`, description: `Score ${r.summary.score} / 100`, tone: all ? 'ok' : r.summary.passed ? 'neutral' : 'warn' });
      },
    });
  }, [search.s, validate, toast]);

  const revealNext = useCallback(() => {
    const hints = lab.data?.spec.hints ?? [];
    const revealed = session.data?.revealedHints ?? [];
    const next = hints.findIndex((_, i) => !revealed.includes(i));
    if (next >= 0) reveal.mutate(next);
  }, [lab.data, session.data, reveal]);

  const ownsKey = useCallback((e: KeyboardEvent) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey) return /^[twdgbfh1-9\[\]]$/i.test(e.key) || e.key === 'Dead';
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key === 'k' || e.key === '/' || (e.shiftKey && e.key.toLowerCase() === 'l'))) return true;
    return false;
  }, []);

  useHotkeys([
    { keys: 'mod+enter', description: 'Validate', group: 'Lab', global: true, handler: runValidate },
    { keys: 'alt+h', description: 'Reveal next hint', group: 'Lab', global: true, handler: revealNext },
    { keys: 'alt+b', description: 'Toggle task panel', group: 'Lab', global: true, handler: toggleTask },
    { keys: 'alt+shift+b', description: 'Swap task panel side', group: 'Lab', global: true, handler: swapSide },
    { keys: 'alt+g', description: 'Toggle topology', group: 'Lab', global: true, handler: toggleTopo },
    { keys: 'alt+f', description: 'Full-screen terminal', group: 'Lab', global: true, handler: () => setChromeless(!chromeless) },
    { keys: 'alt+t', description: 'New console', group: 'Terminals', global: true, handler: () => lab.data && terminals.openConsole(lab.data.spec.topology.entry ?? lab.data.spec.topology.nodes[0]!.name) },
    { keys: 'alt+w', description: 'Close tab', group: 'Terminals', global: true, handler: () => terminals.closeTab() },
    { keys: 'alt+d', description: 'Split pane', group: 'Terminals', global: true, handler: terminals.split },
    { keys: 'alt+]', description: 'Next tab', group: 'Terminals', global: true, handler: () => terminals.cycleTab(1) },
    { keys: 'alt+[', description: 'Previous tab', group: 'Terminals', global: true, handler: () => terminals.cycleTab(-1) },
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ keys: `alt+${n}`, description: `Tab ${n}`, group: 'Terminals', global: true, handler: () => terminals.selectTab(n - 1) })),
    { keys: 'escape', description: 'Exit full-screen', group: 'Lab', handler: () => chromeless && setChromeless(false) },
  ]);
  useScreenShortcuts(WORKSPACE_SHORTCUTS);

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
  if (start.isError) {
    return (
      <div className="page page-narrow">
        <ErrorState title="Could not start the lab environment" error={start.error} onRetry={() => start.reset()} />
      </div>
    );
  }

  const l = lab.data;
  const s = session.data;
  const provisioning = s?.nodes.filter((n) => n.status === 'provisioning').length ?? 0;
  const passedCount = s?.results.filter((r) => r.status === 'pass').length ?? 0;
  const done = s?.status === 'passed';

  const taskPanel = (
    <Panel id="task" ref={taskRef} collapsible collapsedSize={0} minSize={18} defaultSize={28} maxSize={45} order={layout.taskSide === 'left' ? 0 : 2} onCollapse={() => setLayout((x) => ({ ...x, taskCollapsed: true }))} onExpand={() => setLayout((x) => ({ ...x, taskCollapsed: false }))} className="ws-task-panel">
      <TaskPanel lab={l} session={s} validating={validate.isPending} onRevealHint={(i) => reveal.mutate(i)} revealing={reveal.isPending} />
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
        </div>

        <div className="row" style={{ gap: 6 }}>
          {chromeless && (
            <span className="ws-chromeless-hint xs subtle" aria-hidden>
              <Kbd keys="alt+f" /> exit
            </span>
          )}
          {s && (
            <>
              <span className="ws-stat tnum" title="Score">
                <span className="subtle">score</span> {s.score}
              </span>
              <span className="ws-stat tnum" title="Checks passing">
                <span className="subtle">checks</span> {passedCount}/{l.spec.checks.length}
              </span>
              <Timer startedAt={s.startedAt} deadlineMinutes={s.deadlineMinutes} />
              <span className="vdivider" style={{ height: 18, margin: '0 4px' }} />
            </>
          )}
          <Tooltip content="Validate all checks" shortcut="mod+enter">
            <Button variant="primary" size="sm" icon={<Play size={13} />} loading={validate.isPending} disabled={!s || provisioning > 0} onClick={runValidate}>
              Validate
            </Button>
          </Tooltip>
          <span className="vdivider" style={{ height: 18, margin: '0 4px' }} />
          <div className="segmented segmented-sm" role="group" aria-label="Task panel position">
            <Tooltip content="Dock task panel left" shortcut="alt+shift+b">
              <button
                className={cn('segmented-item', layout.taskSide === 'left' && !layout.taskCollapsed && 'is-active')}
                aria-pressed={layout.taskSide === 'left' && !layout.taskCollapsed}
                aria-label="Dock task panel left"
                onClick={() => {
                  setLayout((x) => ({ ...x, taskSide: 'left' }));
                  taskRef.current?.expand();
                  focusActiveTerminal();
                }}
              >
                <PanelLeft size={13} />
              </button>
            </Tooltip>
            <Tooltip content="Hide task panel" shortcut="alt+b">
              <button className={cn('segmented-item', layout.taskCollapsed && 'is-active')} aria-pressed={layout.taskCollapsed} aria-label="Hide task panel" onClick={() => {
                  taskRef.current?.collapse();
                  focusActiveTerminal();
                }}>
                <PanelLeftClose size={13} />
              </button>
            </Tooltip>
            <Tooltip content="Dock task panel right" shortcut="alt+shift+b">
              <button
                className={cn('segmented-item', layout.taskSide === 'right' && !layout.taskCollapsed && 'is-active')}
                aria-pressed={layout.taskSide === 'right' && !layout.taskCollapsed}
                aria-label="Dock task panel right"
                onClick={() => {
                  setLayout((x) => ({ ...x, taskSide: 'right' }));
                  taskRef.current?.expand();
                  focusActiveTerminal();
                }}
              >
                <PanelRight size={13} />
              </button>
            </Tooltip>
          </div>
          <Tooltip content={layout.topoCollapsed ? 'Show topology' : 'Hide topology'} shortcut="alt+g">
            <Button variant="ghost" size="sm" iconOnly aria-label="Toggle topology" aria-pressed={!layout.topoCollapsed} onClick={toggleTopo} icon={<Network size={14} />} />
          </Tooltip>
          <Tooltip content={chromeless ? 'Exit full-screen' : 'Full-screen terminal'} shortcut="alt+f">
            <Button variant="ghost" size="sm" iconOnly aria-label="Toggle full-screen terminal" aria-pressed={chromeless} onClick={() => setChromeless(!chromeless)} icon={chromeless ? <Minimize2 size={14} /> : <Maximize2 size={14} />} />
          </Tooltip>
          <Tooltip content="Keyboard shortcuts" shortcut="?">
            <Button variant="ghost" size="sm" iconOnly aria-label="Keyboard shortcuts" onClick={() => shell.setShortcutsOpen(true)} icon={<Keyboard size={14} />} />
          </Tooltip>
        </div>
      </header>

      {lastResult && (
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
        <PanelGroup key={layout.taskSide} direction="horizontal" autoSaveId={`ct.ws.h.${layout.taskSide}`}>
          {layout.taskSide === 'left' && taskPanel}
          {layout.taskSide === 'left' && <PanelResizeHandle className="splitter splitter-v" />}
          <Panel id="main" minSize={40} order={1}>
            <PanelGroup direction="vertical" autoSaveId="ct.ws.v">
              <Panel id="topo" ref={topoRef} collapsible collapsedSize={0} minSize={15} defaultSize={30} maxSize={60} order={0} onCollapse={() => setLayout((x) => ({ ...x, topoCollapsed: true }))} onExpand={() => setLayout((x) => ({ ...x, topoCollapsed: false }))} className="ws-topo-panel">
                <div className="ws-topo">
                  <div className="ws-topo-head">
                    <span className="xs subtle">Topology · click a node to open its console · right-click a link to capture</span>
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
              <PanelResizeHandle className="splitter splitter-h" />
              <Panel id="terminals" minSize={30} order={1}>
                <TerminalArea lab={l} model={terminals.model} onFocus={terminals.focus} onClose={terminals.closeTab} onOpenConsole={terminals.openConsole} onSplit={terminals.split} ownsKey={ownsKey} />
              </Panel>
            </PanelGroup>
          </Panel>
          {layout.taskSide === 'right' && <PanelResizeHandle className="splitter splitter-v" />}
          {layout.taskSide === 'right' && taskPanel}
        </PanelGroup>
      </div>

    </div>
  );
}
