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
  /** Small preview: hides link labels. */
  compact?: boolean;
  onOpenNode?: (name: string, access: AccessKind) => void;
  onCapture?: (link: TopologyLink) => void;
  onImpair?: (link: TopologyLink) => void;
}

/** Layer nodes left-to-right from the entry node using BFS over links. */
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
  const colW = compact ? 232 : 272;
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
  const sub =
    node.driver === 'k8s-cluster'
      ? node.cluster?.nodes
        ? `${node.cluster.nodes.length} nodes · ${node.cluster.mode ?? 'kubeadm'} ${node.cluster.version ?? ''}`
        : `${node.cluster?.mode ?? 'virtual'} ${node.cluster?.version ?? ''}`
      : node.image ?? node.driver;
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
function AutoFit({ padding, topologyKey }: { padding: number; topologyKey: unknown }) {
  const { fitView } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  useEffect(() => {
    if (!width || !height) return;
    const id = requestAnimationFrame(() => void fitView({ padding, maxZoom: 1, duration: 0 }));
    return () => cancelAnimationFrame(id);
  }, [width, height, padding, topologyKey, fitView]);
  return null;
}

export function TopologyCanvas({ topology, nodeStates, readOnly, compact, onOpenNode, onCapture, onImpair }: TopologyCanvasProps) {
  const positions = useMemo(() => layout(topology, !!readOnly), [topology, readOnly]);
  const stateOf = useMemo(() => new Map(nodeStates?.map((s) => [s.name, s]) ?? []), [nodeStates]);

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
          label: l.subnet,
          className: cn('topo-edge', impaired && 'topo-edge-impaired'),
          data: { link: l },
          focusable: false,
          selectable: !readOnly,
        };
      }),
    [topology, readOnly],
  );

  const [menu, setMenu] = useState<{ x: number; y: number; link: TopologyLink } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const onEdgeContextMenu = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      if (readOnly) return;
      e.preventDefault();
      const rect = wrap.current?.getBoundingClientRect();
      const link = (edge.data as EdgeData | undefined)?.link;
      if (!link || !rect) return;
      setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, link });
    },
    [readOnly],
  );

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <div ref={wrap} className={cn('topo', readOnly && 'topo-readonly', compact && 'topo-compact')}>
      <ReactFlow<Node<NodeData>, Edge<EdgeData>>
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: readOnly ? 0.25 : 0.3, maxZoom: 1 }}
        minZoom={readOnly ? 0.3 : 0.4}
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
        <AutoFit padding={readOnly ? 0.2 : 0.3} topologyKey={topology} />
      </ReactFlow>
      {menu && (
        <div className="menu topo-menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
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
