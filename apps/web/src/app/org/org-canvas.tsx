'use client';
import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { buildFlowGraph, subtreeIds, type OrgUser, type OrgTreeDatum } from './org-layout';
import { OrgNodeCard, type OrgNodeActions } from './org-node-card';

interface Props {
  users: OrgUser[];
  canEdit: boolean;
  onSetManager: (userId: string, managerId: string | null) => void;
  onReset: (userId: string) => void;
  onSetHidden: (userId: string, hidden: boolean) => void;
  onSetRoot: (userId: string) => void;
  onSetLeft: (userId: string, left: boolean) => void;
}

const nodeTypes = { orgCard: OrgNodeCard };

export function OrgCanvas({ users, canEdit, onSetManager, onReset, onSetHidden, onSetRoot, onSetLeft }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const actions: OrgNodeActions = useMemo(
    () => ({ canEdit, onToggle: toggle, onReset, onSetHidden, onSetRoot, onSetLeft }),
    [canEdit, toggle, onReset, onSetHidden, onSetRoot, onSetLeft],
  );

  const { nodes, edges } = useMemo(() => {
    const g = buildFlowGraph(users, collapsed);
    // 把交互回调注入每个节点 data（React Flow 节点渲染只拿 data）
    const nodesWithActions = g.nodes.map((n) => ({
      ...n,
      draggable: canEdit,
      data: { ...(n.data as OrgTreeDatum), __actions: actions },
    })) as Node<OrgTreeDatum>[];
    return { nodes: nodesWithActions, edges: g.edges as Edge[] };
  }, [users, collapsed, canEdit, actions]);

  // 拖拽落定：命中的目标节点 = 新上级；落到自己子树内则忽略（防环）
  const onNodeDragStop: OnNodeDrag = useCallback(
    (evt, node) => {
      if (!canEdit) return;
      const forbidden = subtreeIds(users, node.id);
      const dropX = node.position.x;
      const dropY = node.position.y;
      let best: { id: string; dist: number } | null = null;
      for (const n of nodes) {
        if (n.id === node.id || forbidden.has(n.id)) continue;
        const dx = n.position.x - dropX;
        const dy = n.position.y - dropY;
        if (Math.abs(dx) >= 200 || Math.abs(dy) >= 60) continue; // within tolerance box
        const dist = dx * dx + dy * dy;
        if (!best || dist < best.dist) best = { id: n.id, dist };
      }
      if (best) onSetManager(node.id, best.id);
    },
    [canEdit, users, nodes, onSetManager],
  );

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 220px)' }} data-testid="org-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeDragStop={onNodeDragStop}
        nodesConnectable={false}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
