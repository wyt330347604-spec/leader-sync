import { hierarchy, tree } from 'd3-hierarchy';
import type { Node, Edge } from '@xyflow/react';

export interface OrgUser {
  user_id: string;
  open_id: string | null;
  user_name: string | null;
  manager_user_id: string | null;
  manager_name: string | null;
  manager_source: string;
  current_grade: string | null;
  left_at?: string | null;
  hidden_at?: string | null;
}

export interface OrgTreeDatum {
  user: OrgUser;
  childCount: number;
  hiddenDescendantCount: number;
  collapsed: boolean;
  unresolvedManager: boolean;
  [key: string]: unknown;
}

const NODE_W = 240;
const NODE_H = 84;
const H_GAP = 28;
const V_GAP = 64;

function canonicalId(u: OrgUser): string {
  if (u.open_id && u.open_id.startsWith('ou_')) return u.open_id;
  if (u.user_id && u.user_id.startsWith('ou_')) return u.user_id;
  return u.user_id;
}

function richness(u: OrgUser): number {
  let s = 0;
  if (u.manager_user_id) s += 4;
  if (u.manager_source === 'manual') s += 2;
  if (u.current_grade) s += 1;
  if (u.user_name) s += 1;
  return s;
}

export function dedupeUsers(users: readonly OrgUser[]): OrgUser[] {
  const byCanon = new Map<string, OrgUser>();
  for (const u of users) {
    const k = canonicalId(u);
    const prev = byCanon.get(k);
    if (!prev || richness(u) > richness(prev)) byCanon.set(k, u);
  }
  return [...byCanon.values()];
}

interface RawNode {
  user: OrgUser;
  children: RawNode[];
  unresolvedManager: boolean;
}

function buildForest(rawUsers: readonly OrgUser[]): RawNode[] {
  const users = dedupeUsers(rawUsers);
  const nodes: RawNode[] = users.map((user) => ({ user, children: [], unresolvedManager: false }));
  const byKey = new Map<string, RawNode>();
  for (const n of nodes) {
    if (n.user.user_id) byKey.set(n.user.user_id, n);
    if (n.user.open_id && !byKey.has(n.user.open_id)) byKey.set(n.user.open_id, n);
  }
  const roots: RawNode[] = [];
  for (const n of nodes) {
    const mid = n.user.manager_user_id;
    const parent = mid ? byKey.get(mid) : undefined;
    if (parent && parent !== n) parent.children.push(n);
    else {
      n.unresolvedManager = Boolean(mid && !parent);
      roots.push(n);
    }
  }
  const byName = (a: RawNode, b: RawNode) =>
    (a.user.user_name ?? '').localeCompare(b.user.user_name ?? '', 'zh');
  const sortRec = (list: RawNode[]) => {
    list.sort(byName);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function countDescendants(n: RawNode): number {
  let c = 0;
  for (const child of n.children) c += 1 + countDescendants(child);
  return c;
}

/** 自己 + 全部后代的 key 集合（拖拽防环客户端预检） */
export function subtreeIds(rawUsers: readonly OrgUser[], rootUserId: string): Set<string> {
  const forest = buildForest(rawUsers);
  const ids = new Set<string>();
  const find = (list: RawNode[]): RawNode | null => {
    for (const n of list) {
      if (n.user.user_id === rootUserId || n.user.open_id === rootUserId) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  };
  const walk = (n: RawNode) => {
    ids.add(n.user.user_id);
    if (n.user.open_id) ids.add(n.user.open_id);
    n.children.forEach(walk);
  };
  const root = find(forest);
  if (root) walk(root);
  return ids;
}

/** 森林 → d3 tidy-tree 布局 → React Flow nodes/edges。collapsed 里的节点不展开子级。 */
export function buildFlowGraph(
  rawUsers: readonly OrgUser[],
  collapsed: Set<string>,
): { nodes: Node<OrgTreeDatum>[]; edges: Edge[] } {
  const forest = buildForest(rawUsers);
  // 隐形虚拟根挂所有森林根，统一布局；输出时跳过虚拟根
  const vroot: RawNode = { user: null as unknown as OrgUser, children: forest, unresolvedManager: false };
  const root = hierarchy<RawNode>(vroot, (d) => {
    if (!d.user) return d.children; // 虚拟根
    if (collapsed.has(d.user.user_id)) return []; // 折叠 → 不展开子级
    return d.children;
  });
  const layout = tree<RawNode>().nodeSize([NODE_W + H_GAP, NODE_H + V_GAP]);
  const laidRoot = layout(root);

  const nodes: Node<OrgTreeDatum>[] = [];
  const edges: Edge[] = [];
  laidRoot.each((n) => {
    if (!n.data.user) return; // 跳过虚拟根
    const key = n.data.user.user_id;
    const allChildren = n.data.children.length;
    const isCollapsed = collapsed.has(key) && allChildren > 0;
    nodes.push({
      id: key,
      type: 'orgCard',
      position: { x: n.x, y: n.y },
      data: {
        user: n.data.user,
        childCount: allChildren,
        hiddenDescendantCount: isCollapsed ? countDescendants(n.data) : 0,
        collapsed: isCollapsed,
        unresolvedManager: n.data.unresolvedManager,
      },
    });
    if (n.parent && n.parent.data.user) {
      edges.push({
        id: `${n.parent.data.user.user_id}->${key}`,
        source: n.parent.data.user.user_id,
        target: key,
        type: 'smoothstep',
      });
    }
  });
  return { nodes, edges };
}
