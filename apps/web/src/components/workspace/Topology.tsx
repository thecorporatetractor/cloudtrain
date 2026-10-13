import { Background, BackgroundVariant, Handle, Position, ReactFlow, useNodesState, useReactFlow, useStore, type Edge, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { Activity, Gauge, Terminal as TerminalIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccessKind, SessionNodeState, Topology, TopologyLink, TopologyNode } from '@/api/types';
import { DriverIcon, StatusDot } from '@/components/domain';
import { cn } from '@/lib/utils';

interface NodeData extends Record<string, unknown> {
  node: TopologyNode;
  status?: SessionNodeState['status'];
  ip?: string;
  isEntry: boolean;
  readOnly: boolean;
  onOpen?: (name: string, access: AccessKind) => void;
}

interface EdgeData extends Record<string, unknown> {
  link: TopologyLink;
}

export interface TopologyCanvasProps {
  topology: Topology;
  nodeStates?: SessionNodeState[];
  readOnly?: boolean;
  /** Small preview: tighter layout, no link labels, and a zoom floor so node text stays legible. */
  compact?: boolean;
  onOpenNode?: (name: string, access: AccessKind) => void;
  onCapture?: (link: TopologyLink) => void;
  onImpair?: (link: TopologyLink) => void;
}

function nodeSubtitle(node: TopologyNode): string {
  if (node.driver === 'k8s-cluster') {
    return node.cluster?.nodes ? `${node.cluster.nodes.length} nodes · ${node.cluster.mode ?? 'kubeadm'} ${node.cluster.version ?? ''}` : `${node.cluster?.mode ?? 'virtual'} ${node.cluster?.version ?? ''}`;
  }
  return node.image ?? node.driver;
}

/* Approximate glyph widths for the fonts used on the canvas (nodes are not measured before layout). */
const NAME_PX = 7.6; // JetBrains Mono 12.5px, weight 500
const SUB_PX = 5.7; // Inter 10.5px
const LABEL_PX = 6.1; // JetBrains Mono 10px edge labels

function estimateNodeWidth(node: TopologyNode, compact: boolean): number {
  const name = node.name.length * NAME_PX + 14; // status dot + gap
  const sub = nodeSubtitle(node).length * SUB_PX;
  // padding 10 + icon 28 + gap 10 + text + padding 12 + border 2
  return Math.max(compact ? 148 : 168, 62 + Math.max(name, sub));
}

/**
 * Layer nodes left-to-right from the entry node using BFS over links. The column pitch is the
 * widest node plus room for the longest link label, so labels never sit on a node border.
 */
function layout(topology: Topology, compact: boolean): Map<string, { x: number; y: number }> {
  const adj = new Map<string, Set<string>>();
  for (const n of topology.nodes) adj.set(n.name, new Set());
  for (const l of topology.links ?? []) {
    const a = l.a.split(':')[0]!;
    const b = l.b.split(':')[0]!;
    adj.get(a)?.add(b);
    adj.get(b)?.add(a);
  }
  const entry = topology.entry ?? topology.nodes[0]?.name;
  const depth = new Map<string, number>();
  if (entry) {
    depth.set(entry, 0);
    const q = [entry];
    while (q.length) {
      const cur = q.shift()!;
      for (const nxt of adj.get(cur) ?? []) {
        if (!depth.has(nxt)) {
          depth.set(nxt, depth.get(cur)! + 1);
          q.push(nxt);
        }
      }
    }
  }
  let maxDepth = 0;
  for (const n of topology.nodes) {
    if (!depth.has(n.name)) depth.set(n.name, ++maxDepth);
    maxDepth = Math.max(maxDepth, depth.get(n.name)!);
  }
  const byLayer = new Map<number, string[]>();
  for (const n of topology.nodes) {
    const d = depth.get(n.name)!;
    byLayer.set(d, [...(byLayer.get(d) ?? []), n.name]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  const maxNodeW = Math.max(0, ...topology.nodes.map((n) => estimateNodeWidth(n, compact)));
  const labelW = compact ? 0 : Math.max(0, ...(topology.links ?? []).map((l) => (l.subnet?.length ?? 0) * LABEL_PX + 12));
  const gap = Math.max(compact ? 36 : 56, labelW + 28);
  const colW = maxNodeW + gap;
  const rowH = compact ? 76 : 92;
  const maxRows = Math.max(...Array.from(byLayer.values()).map((v) => v.length));
  for (const [d, names] of byLayer) {
    names.forEach((name, i) => {
      const y = (i - (names.length - 1) / 2) * rowH + ((maxRows - 1) * rowH) / 2;
      pos.set(name, { x: d * colW, y });
    });
  }
  return pos;
}

const TopoNode = memo(function TopoNode({ data, selected }: NodeProps<Node<NodeData>>) {
  const { node, status, isEntry, readOnly, onOpen } = data;
  const sub = nodeSubtitle(node);
  const primaryAccess = node.access?.[0];
  return (
    <div
      className={cn('topo-node', `topo-node-${node.driver}`, isEntry && 'topo-node-entry', selected && 'is-selected', status && `topo-status-${status}`, !readOnly && primaryAccess && 'topo-node-click')}
      role={!readOnly && primaryAccess ? 'button' : undefined}
      tabIndex={!readOnly && primaryAccess ? 0 : undefined}
      onClick={() => !readOnly && primaryAccess && onOpen?.(node.name, primaryAccess)}
      onKeyDown={(e) => {
        if (!readOnly && primaryAccess && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen?.(node.name, primaryAccess);
        }
      }}
      aria-label={`${node.name}${status ? `, ${status}` : ''}${primaryAccess && !readOnly ? `, open ${primaryAccess}` : ''}`}
    >
      <Handle type="target" position={Position.Left} className="topo-handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="topo-handle" isConnectable={false} />
      <span className="topo-icon">
        <DriverIcon driver={node.driver} size={15} />
      </span>
      <span className="topo-body">
        <span className="topo-name mono">
          {status && <StatusDot status={status} />}
          {node.name}
        </span>
        <span className="topo-sub">{sub}</span>
      </span>
      {!readOnly && node.access && node.access.length > 0 && (
        <span className="topo-access" aria-hidden>
          <TerminalIcon size={11} />
        </span>
      )}
    </div>
  );
});

const nodeTypes: NodeTypes = { topo: TopoNode };

/** Re-fit whenever the canvas is resized (panels, collapse, window) or the topology changes. */
function AutoFit({ padding, minZoom, topologyKey }: { padding: number; minZoom: number; topologyKey: unknown }) {
  const { fitView } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  useEffect(() => {
    if (!width || !height) return;
    const id = requestAnimationFrame(() => void fitView({ padding, minZoom, maxZoom: 1, duration: 0 }));
    return () => cancelAnimationFrame(id);
  }, [width, height, padding, minZoom, topologyKey, fitView]);
  return null;
}

interface LinkMenu {
  x: number;
  y: number;
  link: TopologyLink;
  /** Element to refocus when the menu closes from the keyboard. */
  returnTo?: HTMLElement | null;
}

export function TopologyCanvas({ topology, nodeStates, readOnly, compact, onOpenNode, onCapture, onImpair }: TopologyCanvasProps) {
  const positions = useMemo(() => layout(topology, !!compact), [topology, compact]);
  const stateOf = useMemo(() => new Map(nodeStates?.map((s) => [s.name, s]) ?? []), [nodeStates]);
  // A compact preview must not shrink below a legible size; the canvas pans instead.
  const minZoom = compact ? 0.6 : readOnly ? 0.35 : 0.4;

  const computedNodes = useMemo<Node<NodeData>[]>(
    () =>
      topology.nodes.map((n) => ({
        id: n.name,
        type: 'topo',
        position: positions.get(n.name) ?? { x: 0, y: 0 },
        draggable: !readOnly,
        selectable: !readOnly,
        focusable: false,
        data: { node: n, status: stateOf.get(n.name)?.status, ip: stateOf.get(n.name)?.ip, isEntry: n.name === topology.entry, readOnly: !!readOnly, onOpen: onOpenNode },
      })),
    [topology, positions, stateOf, readOnly, onOpenNode],
  );

  // Controlled nodes: React Flow applies measurement/drag changes; we merge in status updates
  // without discarding measured sizes or positions the learner dragged.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(computedNodes);
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return computedNodes.map((n) => {
        const old = byId.get(n.id);
        return old ? { ...old, ...n, position: old.position, measured: old.measured, selected: old.selected } : n;
      });
    });
  }, [computedNodes, setNodes]);

  const edges = useMemo<Edge<EdgeData>[]>(
    () =>
      (topology.links ?? []).map((l, i) => {
        const a = l.a.split(':')[0]!;
        const b = l.b.split(':')[0]!;
        const impaired = !!(l.impair && (l.impair.latencyMs || l.impair.lossPct || l.impair.mtu));
        return {
          id: `${l.a}--${l.b}-${i}`,
          source: a,
          target: b,
          type: 'default',
          label: compact ? undefined : l.subnet,
          className: cn('topo-edge', impaired && 'topo-edge-impaired'),
          data: { link: l },
          // Links are keyboard-reachable in a live workspace: Enter or Shift+F10 opens the capture menu.
          focusable: !readOnly,
          selectable: !readOnly,
          ariaLabel: `Link ${a} to ${b}${l.subnet ? `, ${l.subnet}` : ''}${impaired ? ', impaired' : ''}${readOnly ? '' : '. Press Enter to capture or impair.'}`,
        };
      }),
    [topology, readOnly, compact],
  );

  const [menu, setMenu] = useState<LinkMenu | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const openMenuFor = useCallback(
    (edgeEl: HTMLElement, pointer?: { x: number; y: number }) => {
      const rect = wrap.current?.getBoundingClientRect();
      const edge = edges.find((x) => x.id === edgeEl.dataset.id);
      const link = edge?.data?.link;
      if (!link || !rect) return;
      const er = edgeEl.getBoundingClientRect();
      const at = pointer ?? { x: er.left + er.width / 2, y: er.top + er.height / 2 };
      setMenu({ x: at.x - rect.left, y: at.y - rect.top, link, returnTo: pointer ? null : edgeEl });
    },
    [edges],
  );

  const onEdgeContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      e.preventDefault();
      const edgeEl = (e.target as Element).closest<HTMLElement>('.react-flow__edge');
      if (!edgeEl) return;
      // A contextmenu raised from the keyboard carries no useful pointer position.
      const fromPointer = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined;
      openMenuFor(edgeEl, fromPointer);
    },
    [readOnly, openMenuFor],
  );

  const onCanvasKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (readOnly) return;
      const edgeEl = (e.target as Element).closest<HTMLElement>('.react-flow__edge');
      if (!edgeEl) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        openMenuFor(edgeEl);
      }
    },
    [readOnly, openMenuFor],
  );

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
      menu.returnTo?.focus();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <div ref={wrap} className={cn('topo', readOnly && 'topo-readonly', compact && 'topo-compact')} onKeyDown={onCanvasKeyDown}>
      <ReactFlow<Node<NodeData>, Edge<EdgeData>>
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: readOnly ? 0.25 : 0.3, minZoom, maxZoom: 1 }}
        minZoom={minZoom}
        maxZoom={1.6}
        panOnScroll
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        nodesConnectable={false}
        elementsSelectable={!readOnly}
        nodesDraggable={!readOnly}
        panOnDrag={!readOnly}
        preventScrolling={false}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={() => setMenu(null)}
        defaultEdgeOptions={{ type: 'default' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--fg-faint)" />
        <AutoFit padding={readOnly ? 0.2 : 0.3} minZoom={minZoom} topologyKey={topology} />
      </ReactFlow>
      {menu && (
        <div className="menu topo-menu" role="menu" aria-label={`Link ${menu.link.a} to ${menu.link.b}`} style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="menu-label mono" style={{ textTransform: 'none', letterSpacing: 0 }}>
            {menu.link.a} ↔ {menu.link.b}
          </div>
          <button
            className="menu-item"
            role="menuitem"
            autoFocus
            onClick={() => {
              onCapture?.(menu.link);
              setMenu(null);
              menu.returnTo?.focus();
            }}
          >
            <Activity size={14} /> Capture on this link
          </button>
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              onImpair?.(menu.link);
              setMenu(null);
              menu.returnTo?.focus();
            }}
          >
            <Gauge size={14} /> Impair (latency, loss)…
          </button>
          {menu.link.subnet && <div className="menu-label xs">{menu.link.subnet}</div>}
        </div>
      )}
    </div>
  );
}
