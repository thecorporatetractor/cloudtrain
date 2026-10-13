import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Activity, Columns2, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccessKind, Lab, TopologyLink } from '@/api/types';
import { DriverIcon } from '@/components/domain';
import { Dropdown, Tooltip } from '@/components/ui';
import { clusterMembers, findConsoleNode } from '@/lib/personalize';
import { cn } from '@/lib/utils';
import { TerminalView, type TerminalSource } from './TerminalView';

export interface TermTab {
  id: string;
  title: string;
  source: TerminalSource;
}
export interface Pane {
  id: string;
  tabs: TermTab[];
  active: string;
}
export interface TermModel {
  panes: Pane[];
  activePane: string;
}

/** Return keyboard focus to the active terminal, e.g. after a toolbar click. */
export function focusActiveTerminal() {
  requestAnimationFrame(() => document.querySelector<HTMLElement>('.pane.is-active .xterm-helper-textarea')?.focus());
}

let counter = 0;
const uid = (p: string) => `${p}-${++counter}`;

/** `real`: consoles may also open on kubeadm cluster members (ssh from the jumphost). */
export function useTerminalModel(lab: Lab | undefined, real = false) {
  const [model, setModel] = useState<TermModel>({ panes: [], activePane: '' });

  const entry = lab?.spec.topology.entry ?? lab?.spec.topology.nodes[0]?.name;

  const openConsole = useCallback(
    (nodeName: string, access?: AccessKind) => {
      const node = lab && findConsoleNode(lab, nodeName, real);
      if (!node) return;
      const acc = access ?? node.access?.[0] ?? 'shell';
      setModel((m) => {
        for (const p of m.panes) {
          const existing = p.tabs.find((t) => t.source.kind === 'console' && t.source.node.name === nodeName && t.source.access === acc);
          if (existing) return { panes: m.panes.map((x) => (x.id === p.id ? { ...x, active: existing.id } : x)), activePane: p.id };
        }
        const tab: TermTab = { id: uid('tab'), title: acc === 'shell' ? node.name : `${node.name} · ${acc}`, source: { kind: 'console', node, access: acc } };
        if (!m.panes.length) {
          const pane: Pane = { id: uid('pane'), tabs: [tab], active: tab.id };
          return { panes: [pane], activePane: pane.id };
        }
        const target = m.panes.find((p) => p.id === m.activePane) ?? m.panes[0]!;
        return { ...m, panes: m.panes.map((p) => (p.id === target.id ? { ...p, tabs: [...p.tabs, tab], active: tab.id } : p)), activePane: target.id };
      });
    },
    [lab, real],
  );

  const openCapture = useCallback((link: TopologyLink) => {
    setModel((m) => {
      const tab: TermTab = { id: uid('tab'), title: `capture ${link.a.split(':')[0]}↔${link.b.split(':')[0]}`, source: { kind: 'capture', link } };
      // Captures open in a second pane so the shell stays visible.
      if (m.panes.length < 2) {
        const pane: Pane = { id: uid('pane'), tabs: [tab], active: tab.id };
        return { panes: [...m.panes, pane], activePane: pane.id };
      }
      const target = m.panes[m.panes.length - 1]!;
      return { panes: m.panes.map((p) => (p.id === target.id ? { ...p, tabs: [...p.tabs, tab], active: tab.id } : p)), activePane: target.id };
    });
  }, []);

  const split = useCallback(() => {
    if (!lab || !entry) return;
    const node = lab.spec.topology.nodes.find((n) => n.name === entry)!;
    setModel((m) => {
      if (m.panes.length >= 3) return m;
      const tab: TermTab = { id: uid('tab'), title: node.name, source: { kind: 'console', node, access: node.access?.[0] ?? 'shell' } };
      const pane: Pane = { id: uid('pane'), tabs: [tab], active: tab.id };
      const idx = m.panes.findIndex((p) => p.id === m.activePane);
      const panes = [...m.panes];
      panes.splice(idx + 1, 0, pane);
      return { panes, activePane: pane.id };
    });
  }, [lab, entry]);

  const closeTab = useCallback((paneId?: string, tabId?: string) => {
    setModel((m) => {
      const pane = m.panes.find((p) => p.id === (paneId ?? m.activePane));
      if (!pane) return m;
      const tid = tabId ?? pane.active;
      const tabs = pane.tabs.filter((t) => t.id !== tid);
      if (!tabs.length) {
        if (m.panes.length === 1) return m; // keep the last console
        const panes = m.panes.filter((p) => p.id !== pane.id);
        return { panes, activePane: panes[Math.max(0, m.panes.indexOf(pane) - 1)]!.id };
      }
      const idx = pane.tabs.findIndex((t) => t.id === tid);
      const active = pane.active === tid ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? tabs[0]!.id) : pane.active;
      return { ...m, panes: m.panes.map((p) => (p.id === pane.id ? { ...p, tabs, active } : p)) };
    });
  }, []);

  const focus = useCallback((paneId: string, tabId?: string) => {
    setModel((m) => ({ activePane: paneId, panes: tabId ? m.panes.map((p) => (p.id === paneId ? { ...p, active: tabId } : p)) : m.panes }));
  }, []);

  const cycleTab = useCallback((dir: 1 | -1) => {
    setModel((m) => {
      const pane = m.panes.find((p) => p.id === m.activePane);
      if (!pane || pane.tabs.length < 2) return m;
      const idx = pane.tabs.findIndex((t) => t.id === pane.active);
      const next = pane.tabs[(idx + dir + pane.tabs.length) % pane.tabs.length]!;
      return { ...m, panes: m.panes.map((p) => (p.id === pane.id ? { ...p, active: next.id } : p)) };
    });
  }, []);

  const selectTab = useCallback((index: number) => {
    setModel((m) => {
      const pane = m.panes.find((p) => p.id === m.activePane);
      const t = pane?.tabs[index];
      if (!pane || !t) return m;
      return { ...m, panes: m.panes.map((p) => (p.id === pane.id ? { ...p, active: t.id } : p)) };
    });
  }, []);

  // Open the entry node once the lab is known.
  useEffect(() => {
    if (lab && entry && model.panes.length === 0) openConsole(entry);
  }, [lab, entry, model.panes.length, openConsole]);

  return useMemo(() => ({ model, openConsole, openCapture, split, closeTab, focus, cycleTab, selectTab }), [model, openConsole, openCapture, split, closeTab, focus, cycleTab, selectTab]);
}

interface AreaProps {
  lab: Lab;
  model: TermModel;
  onFocus: (paneId: string, tabId?: string) => void;
  onClose: (paneId: string, tabId: string) => void;
  onOpenConsole: (node: string, access?: AccessKind) => void;
  /** Start a capture on a topology link (also reachable from the + menu, for keyboard and screen-reader users). */
  onCapture?: (link: TopologyLink) => void;
  onSplit: () => void;
  ownsKey: (e: KeyboardEvent) => boolean;
  /** Real API mode: the lab session the consoles attach to. */
  sessionId?: string;
}

const nodeOf = (endpoint: string) => endpoint.split(':')[0]!;

export function TerminalArea({ lab, model, onFocus, onClose, onOpenConsole, onCapture, onSplit, ownsKey, sessionId }: AreaProps) {
  const consoleNodes = sessionId ? [...lab.spec.topology.nodes, ...clusterMembers(lab)] : lab.spec.topology.nodes;
  const accessPoints = consoleNodes.flatMap((n) => (n.access ?? []).map((a) => ({ node: n, access: a })));
  const links = lab.spec.topology.links ?? [];
  // The last console must stay open, so its close button is not offered.
  const canClose = (pane: Pane) => !(model.panes.length === 1 && pane.tabs.length === 1);

  const selectTab = (pane: Pane, tab: TermTab, list: HTMLElement | null, focusTerminal: boolean) => {
    onFocus(pane.id, tab.id);
    if (focusTerminal) focusActiveTerminal();
    else requestAnimationFrame(() => list?.querySelector<HTMLElement>(`[role="tab"][data-tab="${tab.id}"]`)?.focus());
  };

  // Roving tabindex with arrow keys; Delete closes the current tab.
  const onTablistKeyDown = (pane: Pane) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).matches('[role="tab"]')) return;
    const idx = Math.max(0, pane.tabs.findIndex((t) => t.id === pane.active));
    const n = pane.tabs.length;
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % n;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Delete') {
      if (canClose(pane)) {
        e.preventDefault();
        onClose(pane.id, pane.active);
      }
      return;
    } else return;
    e.preventDefault();
    const tab = pane.tabs[next];
    if (tab) selectTab(pane, tab, e.currentTarget, false);
  };

  return (
    <div className="termarea">
      <PanelGroup direction="horizontal" autoSaveId={undefined}>
        {model.panes.map((pane, i) => (
          <PaneSlot key={pane.id} id={pane.id} index={i}>
            <div className={cn('pane', model.activePane === pane.id && 'is-active')} onMouseDown={() => onFocus(pane.id)} onFocusCapture={() => model.activePane !== pane.id && onFocus(pane.id)}>
              <div className="tabstrip" role="tablist" aria-label="Consoles" onKeyDown={onTablistKeyDown(pane)}>
                {pane.tabs.map((t, idx) => (
                  <div
                    key={t.id}
                    role="tab"
                    data-tab={t.id}
                    aria-selected={pane.active === t.id}
                    tabIndex={pane.active === t.id ? 0 : -1}
                    className={cn('tab', pane.active === t.id && 'is-active')}
                    onClick={(e) => selectTab(pane, t, e.currentTarget.parentElement, true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectTab(pane, t, null, true);
                      }
                    }}
                    onAuxClick={(e) => e.button === 1 && canClose(pane) && onClose(pane.id, t.id)}
                    title={t.source.kind === 'console' ? `${t.source.node.name} via ${t.source.access}${i === 0 && idx < 9 ? ` · Alt+${idx + 1}` : ''}` : t.title}
                  >
                    {t.source.kind === 'console' ? <DriverIcon driver={t.source.node.driver} size={12} className="tab-icon" /> : <Activity size={12} className="tab-icon tab-icon-capture" />}
                    <span className="tab-title truncate">{t.title}</span>
                    {canClose(pane) && (
                      <button
                        className="tab-close"
                        aria-label={`Close ${t.title}`}
                        title="Close (Delete)"
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          onClose(pane.id, t.id);
                        }}
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                ))}
                <Dropdown.Root>
                  <Tooltip content="New console" shortcut="mod+shift+o">
                    <Dropdown.Trigger asChild>
                      <button className="tab-action" aria-label="Open console on a node or capture on a link">
                        <Plus size={13} />
                      </button>
                    </Dropdown.Trigger>
                  </Tooltip>
                  <Dropdown.Content align="start" sideOffset={4}>
                    <Dropdown.Label>Access points</Dropdown.Label>
                    {accessPoints.map(({ node, access }) => (
                      <Dropdown.Item
                        key={`${node.name}:${access}`}
                        onSelect={() => {
                          onFocus(pane.id);
                          onOpenConsole(node.name, access);
                        }}
                      >
                        <DriverIcon driver={node.driver} size={13} className="muted" />
                        <span className="mono grow">{node.name}</span>
                        <span className="xs subtle">{access}</span>
                      </Dropdown.Item>
                    ))}
                    {onCapture && links.length > 0 && (
                      <>
                        <Dropdown.Separator />
                        <Dropdown.Label>Capture on link</Dropdown.Label>
                        {links.map((l, k) => (
                          <Dropdown.Item key={`${l.a}--${l.b}-${k}`} onSelect={() => onCapture(l)}>
                            <Activity size={13} className="muted" />
                            <span className="mono grow">
                              {nodeOf(l.a)} ↔ {nodeOf(l.b)}
                            </span>
                            {l.subnet && <span className="xs subtle mono">{l.subnet}</span>}
                          </Dropdown.Item>
                        ))}
                      </>
                    )}
                  </Dropdown.Content>
                </Dropdown.Root>
                <div className="grow" />
                {i === model.panes.length - 1 && model.panes.length < 3 && (
                  <Tooltip content="Split pane" shortcut="mod+shift+d">
                    <button className="tab-action" aria-label="Split pane" onClick={onSplit}>
                      <Columns2 size={13} />
                    </button>
                  </Tooltip>
                )}
              </div>
              <div className="pane-body">
                {pane.tabs.map((t) => (
                  <TerminalView key={t.id} lab={lab} source={t.source} active={pane.active === t.id} onOpenNode={(n) => onOpenConsole(n)} ownsKey={ownsKey} sessionId={sessionId} />
                ))}
              </div>
            </div>
          </PaneSlot>
        ))}
      </PanelGroup>
    </div>
  );
}

function PaneSlot({ id, index, children }: { id: string; index: number; children: React.ReactNode }) {
  return (
    <>
      {index > 0 && <PanelResizeHandle className="splitter splitter-v" />}
      <Panel id={id} minSize={20} order={index}>
        {children}
      </Panel>
    </>
  );
}
