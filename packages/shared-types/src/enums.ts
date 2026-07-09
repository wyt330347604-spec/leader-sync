// All enums are the single source of truth in code,
// aligned with docs/02-data/enum-dictionary.md
// Status and Priority values adapted to match existing Bitable field values.

export const TaskStatus = {
  PENDING: 'pending',             // 待办
  NOT_STARTED: 'not_started',     // 待开始
  IN_PROGRESS: 'in_progress',     // 进行中
  STALLED: 'stalled',             // 已停滞
  DONE: 'done',                   // 已完成
  SHELVED: 'shelved',             // 已搁置
  // Reserved for future (not in Bitable MVP)
  PENDING_REVIEW: 'pending_review',
  REOPENED: 'reopened',
  CLOSED: 'closed',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskStatusLabel: Record<string, string> = {
  pending: '待办',
  not_started: '待开始',
  in_progress: '进行中',
  stalled: '已停滞',
  done: '已完成',
  shelved: '已搁置',
  pending_review: '待验收',
  reopened: '重新打开',
  closed: '已归档',
};

// Bitable Chinese → system value
export const BitableStatusMap: Record<string, string> = {
  '待办': 'pending',
  '待开始': 'not_started',
  '进行中': 'in_progress',
  '已停滞': 'stalled',
  '已完成': 'done',
  '已搁置': 'shelved',
};

export const Priority = {
  URGENT_IMPORTANT: 'urgent_important',
  IMPORTANT_NOT_URGENT: 'important_not_urgent',
  URGENT_NOT_IMPORTANT: 'urgent_not_important',
  NOT_URGENT_NOT_IMPORTANT: 'not_urgent_not_important',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export const PriorityLabel: Record<string, string> = {
  urgent_important: '重要紧急',
  important_not_urgent: '重要不紧急',
  urgent_not_important: '紧急不重要',
  not_urgent_not_important: '不紧急不重要',
};

export const BitablePriorityMap: Record<string, string> = {
  '重要紧急': 'urgent_important',
  '重要不紧急': 'important_not_urgent',
  '紧急不重要': 'urgent_not_important',
  '不紧急不重要': 'not_urgent_not_important',
};

export const TaskType = {
  CARRY_OVER: 'carry_over',  // 上月遗留
  NEW: 'new',                // 本月新增
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const TaskTypeLabel: Record<string, string> = {
  carry_over: '上月遗留',
  new: '本月新增',
};

// 任务可见性：public=公司共享（计入统计+同步多维表格）；private=个人仅自己可见（不计入统计、不同步）
export const TaskVisibility = {
  PUBLIC: 'public',
  PRIVATE: 'private',
} as const;
export type TaskVisibility = (typeof TaskVisibility)[keyof typeof TaskVisibility];

export const AssignmentType = {
  BOSS_ASSIGN: 'boss_assign',
  MANAGER_ASSIGN: 'manager_assign',
  PEER_COLLABORATION: 'peer_collaboration',
  SELF_CLAIM: 'self_claim',
  CARRY_OVER: 'carry_over',
} as const;
export type AssignmentType = (typeof AssignmentType)[keyof typeof AssignmentType];

export const SyncStatus = {
  PENDING: 'pending',
  SYNCING: 'syncing',
  RETRYING: 'retrying',
  SUCCESS: 'success',
  FAILED: 'failed',
  CONFLICT: 'conflict',
  MANUAL_REVIEW: 'manual_review',
  SKIPPED: 'skipped',
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

export const SourceType = {
  BITABLE: 'bitable',
  TASK: 'task',
  CALENDAR: 'calendar',
  CARD: 'card',
  API: 'api',
  SYSTEM: 'system',
} as const;
export type SourceType = (typeof SourceType)[keyof typeof SourceType];

export const RoleScope = {
  EMPLOYEE: 'employee',
  LEADER: 'leader',
  COMPANY: 'company',
} as const;
export type RoleScope = (typeof RoleScope)[keyof typeof RoleScope];

export const ConflictResolutionStatus = {
  RESOLVED_KEEP_LOCAL: 'resolved_keep_local',
  RESOLVED_ACCEPT_REMOTE: 'resolved_accept_remote',
  RESOLVED_MERGE: 'resolved_merge',
  RESOLVED_MANUAL_OVERRIDE: 'resolved_manual_override',
  UNRESOLVED_PENDING_REVIEW: 'unresolved_pending_review',
} as const;
export type ConflictResolutionStatus = (typeof ConflictResolutionStatus)[keyof typeof ConflictResolutionStatus];

export const UserRole = {
  EMPLOYEE: 'employee',
  LEADER: 'leader',
  BOSS: 'boss',
  PMO: 'pmo',
  ADMIN: 'admin',
  // 绩效模块申诉受理人（建议绑杨平）。仅角色类型/常量，权限逻辑另行接入。
  HR: 'hr',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const ProjectCategory = {
  GROUP: 'jt',      // 集团
  SELF: 'zy',       // 自营
  SERVICE: 'fw',    // 服务
  INVEST: 'tz',     // 投资
  COOP: 'hz',       // 合作
} as const;
export type ProjectCategory = (typeof ProjectCategory)[keyof typeof ProjectCategory];

export const ProjectCategoryLabel: Record<string, string> = {
  jt: '集团',
  zy: '自营',
  fw: '服务',
  tz: '投资',
  hz: '合作',
};

// 显示顺序（页面渲染用）
export const ProjectCategoryOrder: ProjectCategory[] = ['jt', 'zy', 'fw', 'tz', 'hz'];

export const ProjectRegion = {
  INDIA: '印度',
  INDONESIA: '印尼',
  PAKISTAN: '巴基斯坦',
  BANGLADESH: '孟加拉',
  SHENZHEN: '深圳',
} as const;
export type ProjectRegion = (typeof ProjectRegion)[keyof typeof ProjectRegion];

export const ProjectRegionList: ProjectRegion[] = ['印度', '印尼', '巴基斯坦', '孟加拉', '深圳'];

// ─── Incident module enums ───────────────────────────────────────────────────

export const IncidentSeverity = {
  P0: 'P0',  // 生产崩溃 / 重大财务损失
  P1: 'P1',  // 严重违规（显著影响团队协作或业务进展）
  P2: 'P2',  // 一般违规（需整改但不紧急）
  P3: 'P3',  // 轻微问题（记录备案，不影响正常运营）
} as const;
export type IncidentSeverity = (typeof IncidentSeverity)[keyof typeof IncidentSeverity];

export const IncidentConfirmStatus = {
  PENDING_CONFIRM: 'pending_confirm',  // 待 PMO/Boss 确认（P0/P1 创建时）
  CONFIRMED: 'confirmed',              // 已确认生效
  REJECTED: 'rejected',               // 已驳回（永不生效）
} as const;
export type IncidentConfirmStatus = (typeof IncidentConfirmStatus)[keyof typeof IncidentConfirmStatus];

export const IncidentInvolvement = {
  INVOLVED: 'involved',  // 普通涉及（默认）
  PRIMARY: 'primary',    // 主要责任人
} as const;
export type IncidentInvolvement = (typeof IncidentInvolvement)[keyof typeof IncidentInvolvement];

// ─── Grade module enums ──────────────────────────────────────────────────────

// 职级变更触发类型（三种：初始录入 / 半年度晋升 / 手动调整）
// T4.0–T8.3，共 20 级；格式校验正则：/^T[4-8]\.[0-3]$/
export const GradeTriggerType = {
  INITIAL_ENTRY: 'initial_entry',          // 初始录入（上线前 Harvey/PMO 手动填入存量员工职级）
  BIANNUAL_PROMOTION: 'biannual_promotion', // 半年度晋升（常规晋升周期）
  MANUAL_ADJUSTMENT: 'manual_adjustment',   // 手动调整（含降级 / 纠错 / 特殊情况，需填写 note）
} as const;
export type GradeTriggerType = (typeof GradeTriggerType)[keyof typeof GradeTriggerType];

// ── 需求轴（项目驱动 R1）──────────────────────────────────────────────
export const RequirementSource = {
  BIZ: 'biz',          // 业务方提报
  PLAN: 'plan',        // 产品规划
  TECH: 'tech',        // 技术优化
  FEEDBACK: 'feedback',// 用户反馈
} as const;
export type RequirementSource = (typeof RequirementSource)[keyof typeof RequirementSource];
export const RequirementSourceLabel: Record<string, string> = {
  biz: '业务方提报', plan: '产品规划', tech: '技术优化', feedback: '用户反馈',
};

export const RequirementPriority = { P0: 'P0', P1: 'P1', P2: 'P2' } as const;
export type RequirementPriority = (typeof RequirementPriority)[keyof typeof RequirementPriority];

// 生命周期状态（对齐《需求管理规范》两图）
export const RequirementStatus = {
  COLLECTED: 'collected',         // 收集/待收口
  ANALYZING: 'analyzing',         // 分析(PM·出PRD)
  REQ_REVIEW: 'req_review',       // 需求评审(PM×技术)
  TECH_REVIEW: 'tech_review',     // 技术评审(研发·分解+工时)
  SCHEDULED: 'scheduled',         // 排期(PM·定版本)
  DEVELOPING: 'developing',       // 开发(研发·单元自测)
  TESTING: 'testing',             // 测试(用例评审→冒烟→功能→集成→回归)
  PRODUCT_ACCEPT: 'product_accept', // 产品验收(PM·预发)
  TECH_RELEASE: 'tech_release',   // 技术上线
  BIZ_ACCEPT: 'biz_accept',       // 业务验收(业务方·生产)
  RELEASED: 'released',           // 业务上线
  RETRO: 'retro',                 // 复盘
  CLOSED: 'closed',               // 关闭
  REJECTED: 'rejected',           // 驳回
} as const;
export type RequirementStatus = (typeof RequirementStatus)[keyof typeof RequirementStatus];
export const RequirementStatusLabel: Record<string, string> = {
  collected: '收集', analyzing: '分析', req_review: '需求评审', tech_review: '技术评审',
  scheduled: '排期', developing: '开发', testing: '测试', product_accept: '产品验收',
  tech_release: '技术上线', biz_accept: '业务验收', released: '已上线', retro: '复盘',
  closed: '关闭', rejected: '驳回',
};
// 流程元信息（单一数据源）：每个状态的负责人 / 是否评审验收闸门 / 该步要做什么。
// 看板列、需求详情提示条、流程说明图例共用，避免“流程知识”散落在用户脑子里。
export interface RequirementStatusMetaItem {
  owner: string;     // 这一步谁负责/谁动它
  gate?: boolean;    // 是否评审/验收闸门（不通过会退回）
  hint: string;      // 这一步要做什么
}
export const RequirementStatusMeta: Record<string, RequirementStatusMetaItem> = {
  collected: { owner: '提出人 · 待 PM 认领', hint: '提交后等 PM 认领收口' },
  analyzing: { owner: 'PM', hint: 'PM 出 PRD' },
  req_review: { owner: 'PM × 技术', gate: true, hint: '产品技术对齐，不过退回分析' },
  tech_review: { owner: '研发', gate: true, hint: '任务分解 + 估工时，不过退回分析' },
  scheduled: { owner: 'PM', hint: '定目标版本 / 迭代' },
  developing: { owner: '研发', hint: '编码 + 单元自测' },
  testing: { owner: '测试', gate: true, hint: '用例→冒烟→功能→集成→回归，缺陷退开发' },
  product_accept: { owner: 'PM', gate: true, hint: '预发验收，不过退开发' },
  tech_release: { owner: '研发 / 运维', hint: '上线到技术环境' },
  biz_accept: { owner: '业务方', gate: true, hint: '生产验收，不过退开发' },
  released: { owner: '系统', hint: '业务上线完成' },
  retro: { owner: 'PM', hint: 'PM 复盘总结' },
  closed: { owner: '—', hint: '已关闭（终态）' },
  rejected: { owner: 'PM', hint: '已驳回，可重开回收集' },
};
// 看板顺序（不含 closed/rejected 末态）
export const RequirementStatusOrder: string[] = [
  'collected','analyzing','req_review','tech_review','scheduled','developing',
  'testing','product_accept','tech_release','biz_accept','released','retro',
];
// 合法状态流转（含回退）。键=from，值=允许 to 集合。任意态→rejected 另行允许。
export const RequirementTransitions: Record<string, string[]> = {
  collected: ['analyzing'],
  analyzing: ['req_review'],
  req_review: ['tech_review', 'analyzing'],        // 评审不过 → 退回分析
  tech_review: ['scheduled', 'analyzing'],         // 技术评审不过 → 退回分析
  scheduled: ['developing'],
  developing: ['testing'],
  testing: ['product_accept', 'developing'],       // 缺陷 → 退回开发
  product_accept: ['tech_release', 'developing'],  // 验收不过 → 退回开发
  tech_release: ['biz_accept'],
  biz_accept: ['released', 'developing'],           // 业务验收不过 → 退回开发
  released: ['retro'],
  retro: ['closed'],
  closed: [],
  rejected: ['collected'],                          // 驳回后可重开
};
