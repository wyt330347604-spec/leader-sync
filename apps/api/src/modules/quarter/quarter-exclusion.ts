// 管理层评分「关联的一级部门领导除外」纯逻辑（无 I/O，可单测）
// 依据：spec 2026-07-08 performance-review-module §2.3 §4 §10.2
//
// 排除对象 = 被评人一级部门 leader + 被评人直属 + 被评人本人；
// 部门数据缺失（无 deptId / 部门查不到 / 一级部门无 leader）时回退：
//   「管理链上的管理层成员全排除」（沿 org_cache.manager_user_id 向上）。
// 用哪条规则记入 rule 供 quarter_task.mgmt_trace 留痕。
//
// id 双命名空间（user_id / open_id）：管理层成员以 idForms 列出全部形态，
// 任一形态落入排除集即视为被排除。

const ROOT_DEPT_ID = '0';
const CHAIN_GUARD = 20; // 防环上限

export interface DeptNode {
  deptId: string;
  parentDeptId: string | null;
  leaderUserId: string | null;
  level: number; // 根=0
}

export interface OrgNode {
  userId: string;
  openId: string | null;
  managerUserId: string | null;
  deptId: string | null;
}

export interface MgmtMember {
  raterUserId: string; // 规范身份（建 sheet 用）
  raterName: string | null;
  idForms: string[]; // 该成员的全部 id 形态（user_id + open_id）
}

export interface ExclusionInput {
  ratee: OrgNode;
  management: MgmtMember[];
  deptsById: Map<string, DeptNode>;
  orgByAnyId: Map<string, OrgNode>; // 按 user_id 和 open_id 双键索引
}

export interface ExclusionResult {
  rule: 'first_level_dept' | 'manager_chain_fallback';
  excludedIds: string[]; // 被排除的管理层 raterUserId
  raterIds: string[]; // 实际参与评分的管理层 raterUserId（= 管理层 − 排除）
}

/** 沿部门树向上找一级部门（其父为根）。deptId 缺失/查不到返回 null。 */
function findFirstLevelDept(deptId: string | null, deptsById: Map<string, DeptNode>): DeptNode | null {
  if (!deptId) return null;
  let node = deptsById.get(deptId);
  if (!node) return null;
  let guard = 0;
  while (node.parentDeptId && node.parentDeptId !== ROOT_DEPT_ID && guard++ < CHAIN_GUARD) {
    const parent = deptsById.get(node.parentDeptId);
    if (!parent) break; // 断链：当前节点即视为一级
    if (parent.level <= 0) break; // 父为根 → 当前是一级部门
    node = parent;
  }
  return node;
}

/** 收集被评人管理链上的全部 id 形态（含每级的 user_id/open_id）。 */
function collectManagerChain(ratee: OrgNode, orgByAnyId: Map<string, OrgNode>): Set<string> {
  const chain = new Set<string>();
  let curId = ratee.managerUserId;
  let guard = 0;
  while (curId && guard++ < CHAIN_GUARD) {
    chain.add(curId);
    const cur = orgByAnyId.get(curId);
    if (!cur) break;
    if (cur.userId) chain.add(cur.userId);
    if (cur.openId) chain.add(cur.openId);
    curId = cur.managerUserId;
  }
  return chain;
}

function partition(
  management: MgmtMember[],
  excluded: Set<string>,
): { raterIds: string[]; excludedIds: string[] } {
  const raterIds: string[] = [];
  const excludedIds: string[] = [];
  for (const m of management) {
    const hit = m.idForms.some((f) => excluded.has(f));
    if (hit) excludedIds.push(m.raterUserId);
    else raterIds.push(m.raterUserId);
  }
  return { raterIds, excludedIds };
}

export function computeMgmtExclusions(input: ExclusionInput): ExclusionResult {
  const { ratee, management, deptsById, orgByAnyId } = input;

  // 基础排除：本人（各形态）+ 直属
  const baseExcluded = new Set<string>();
  if (ratee.userId) baseExcluded.add(ratee.userId);
  if (ratee.openId) baseExcluded.add(ratee.openId);
  if (ratee.managerUserId) baseExcluded.add(ratee.managerUserId);

  // 一级部门规则
  const firstLevel = findFirstLevelDept(ratee.deptId, deptsById);
  if (firstLevel && firstLevel.leaderUserId) {
    const excluded = new Set(baseExcluded);
    excluded.add(firstLevel.leaderUserId);
    const { raterIds, excludedIds } = partition(management, excluded);
    return { rule: 'first_level_dept', excludedIds: excludedIds.sort(), raterIds };
  }

  // 回退：管理链规则
  const chain = collectManagerChain(ratee, orgByAnyId);
  const excluded = new Set(baseExcluded);
  for (const id of chain) excluded.add(id);
  const { raterIds, excludedIds } = partition(management, excluded);
  return { rule: 'manager_chain_fallback', excludedIds: excludedIds.sort(), raterIds };
}
