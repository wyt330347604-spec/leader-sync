import { describe, it, expect } from 'vitest';
import { dedupeUsers, buildFlowGraph, subtreeIds, type OrgUser } from '../org-layout';

const u = (over: Partial<OrgUser>): OrgUser => ({
  user_id: over.user_id!,
  open_id: over.open_id ?? over.user_id!,
  user_name: over.user_name ?? over.user_id!,
  manager_user_id: over.manager_user_id ?? null,
  manager_name: over.manager_name ?? null,
  manager_source: over.manager_source ?? 'feishu',
  current_grade: over.current_grade ?? null,
  left_at: over.left_at ?? null,
  hidden_at: over.hidden_at ?? null,
});

describe('dedupeUsers', () => {
  it('同一人多行按信息量保留最全的一行', () => {
    const rows = [
      u({ user_id: 'ou_a', manager_user_id: null }),
      u({ user_id: 'emp_a', open_id: 'ou_a', manager_user_id: 'ou_boss', manager_source: 'manual' }),
    ];
    const out = dedupeUsers(rows);
    expect(out).toHaveLength(1);
    expect(out[0].manager_user_id).toBe('ou_boss');
  });
});

describe('buildFlowGraph', () => {
  const users = [
    u({ user_id: 'ou_boss' }),
    u({ user_id: 'ou_a', manager_user_id: 'ou_boss' }),
    u({ user_id: 'ou_b', manager_user_id: 'ou_boss' }),
  ];

  it('生成 3 节点 2 边，上级在上方（y 更小）', () => {
    const { nodes, edges } = buildFlowGraph(users, new Set());
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
    const boss = nodes.find((n) => n.id === 'ou_boss')!;
    const a = nodes.find((n) => n.id === 'ou_a')!;
    expect(boss.position.y).toBeLessThan(a.position.y);
    expect(boss.data.childCount).toBe(2);
  });

  it('折叠父节点：子节点不出现，父带 collapsed + hiddenDescendantCount', () => {
    const { nodes, edges } = buildFlowGraph(users, new Set(['ou_boss']));
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0);
    expect(nodes[0].data.collapsed).toBe(true);
    expect(nodes[0].data.hiddenDescendantCount).toBe(2);
  });

  it('多根：两个无上级的人各成一棵树', () => {
    const multi = [u({ user_id: 'ou_x' }), u({ user_id: 'ou_y' })];
    const { nodes, edges } = buildFlowGraph(multi, new Set());
    expect(nodes.map((n) => n.id).sort()).toEqual(['ou_x', 'ou_y']);
    expect(edges).toHaveLength(0);
  });

  it('上级指向不存在的人 → 挂根 + unresolvedManager', () => {
    const orphan = [u({ user_id: 'ou_z', manager_user_id: 'ou_ghost' })];
    const { nodes } = buildFlowGraph(orphan, new Set());
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.unresolvedManager).toBe(true);
  });
});

describe('subtreeIds', () => {
  it('返回自己 + 全部后代的 id（防环预检）', () => {
    const users = [
      u({ user_id: 'ou_boss' }),
      u({ user_id: 'ou_a', manager_user_id: 'ou_boss' }),
      u({ user_id: 'ou_a1', manager_user_id: 'ou_a' }),
    ];
    const ids = subtreeIds(users, 'ou_boss');
    expect([...ids].sort()).toEqual(['ou_a', 'ou_a1', 'ou_boss']);
  });
});
