import { config } from '../config';

interface TaskSummary {
  title: string;
  dueAt: string;
  daysOverdue?: number;
}

export function buildWeeklyReminderCard(userName: string, dueTasks: TaskSummary[], overdueTasks: TaskSummary[]): object {
  const elements: any[] = [];

  if (dueTasks.length > 0) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '**本周应完成**' } });
    for (const t of dueTasks.slice(0, 10)) {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: `- ${t.title}（截止 ${t.dueAt}）` } });
    }
    if (dueTasks.length > 10) {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: `...还有 ${dueTasks.length - 10} 项` } });
    }
  }

  if (overdueTasks.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '**已延期任务**' } });
    for (const t of overdueTasks.slice(0, 10)) {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: `- ${t.title}（已延期 ${Math.abs(t.daysOverdue || 0)} 天）` } });
    }
  }

  if (dueTasks.length === 0 && overdueTasks.length === 0) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '本周暂无待完成任务，继续保持！' } });
  }

  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'action',
    actions: [{
      tag: 'button',
      text: { tag: 'plain_text', content: '查看我的任务' },
      type: 'primary',
      url: `${config.appBaseUrl}/tasks`,
    }],
  });

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${userName}，你的周任务提醒` },
      template: 'blue',
    },
    elements,
  };
}

export function buildOverdueCard(userName: string, tasks: TaskSummary[]): object {
  const elements: any[] = [];
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: `你有 **${tasks.length}** 项任务已延期：` } });
  for (const t of tasks.slice(0, 10)) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `- ${t.title}（已延期 ${Math.abs(t.daysOverdue || 0)} 天）` } });
  }
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'action',
    actions: [{ tag: 'button', text: { tag: 'plain_text', content: '立即处理' }, type: 'danger', url: `${config.appBaseUrl}/tasks` }],
  });
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: `${userName}，延期任务提醒` }, template: 'red' },
    elements,
  };
}

export interface MemberOverdueRow {
  readonly memberName: string;
  readonly overdueCount: number;
}

export function buildLeaderWeeklyOverdueDigest(leaderName: string, members: MemberOverdueRow[]): object {
  const totalCount = members.reduce((s, m) => s + m.overdueCount, 0);
  const elements: any[] = [
    { tag: 'div', text: { tag: 'lark_md', content: `**${leaderName}**，本周下属共 **${totalCount}** 项任务延期：` } },
  ];
  for (const m of members) {
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `- ${m.memberName}：${m.overdueCount} 项` },
    });
  }
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'action',
    actions: [{ tag: 'button', text: { tag: 'plain_text', content: '查看驾驶舱' }, type: 'primary', url: `${config.appBaseUrl}/dashboard` }],
  });
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '下属任务延期周报' }, template: 'orange' },
    elements,
  };
}

export function buildMonthlyReportCard(recipientName: string, month: string, stats: { done: number; overdue: number; carryOver: number; total: number; doneRate: string }): object {
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: `${month} 月度复盘` }, template: 'green' },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**${recipientName}**，${month} 月结已完成：` } },
      { tag: 'div', text: { tag: 'lark_md', content: `完成 **${stats.done}** 项 | 延期 **${stats.overdue}** 项 | 继承 **${stats.carryOver}** 项` } },
      { tag: 'div', text: { tag: 'lark_md', content: `完成率 **${stats.doneRate}** | 总任务 **${stats.total}** 项` } },
      { tag: 'hr' },
      { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '查看详情' }, type: 'primary', url: `${config.appBaseUrl}/tasks` }] },
    ],
  };
}

/**
 * Feishu card sent to each direct leader when the scoring window opens after monthly close.
 * Spec §5.1: 标题 + 下属待打分人数 + 截止日期 + 行动按钮
 */
export function buildScoreWindowCard(
  leaderName: string,
  scoreMonth: string,
  rateeCount: number,
  deadlineDate: string,
): object {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `【评分窗口开启】${scoreMonth} 月度评分` },
      template: 'violet',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${leaderName}**，您有 **${rateeCount}** 位下属待完成月度打分，请在 **${deadlineDate}**（月结后 7 日）前完成。`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '前往打分' },
          type: 'primary',
          url: `${config.appBaseUrl}/scores?month=${scoreMonth}`,
        }],
      },
    ],
  };
}

/**
 * 季度评分 · 开窗给被评人的「待自评」卡片。
 * spec 2026-07-08 performance-review-module §7：开窗催办；按钮跳自评打分页。
 */
export function buildQuarterSelfWindowCard(
  rateeName: string,
  quarter: string,
  selfDeadlineDate: string,
  selfSheetUid: string,
): object {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `【季度考核·开窗】${quarter} 自评待完成` },
      template: 'violet',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${rateeName}**，${quarter} 季度考核已开窗，请先完成 **自评**（自评提交后解锁同事/直属评价）。请在 **${selfDeadlineDate}** 前完成。`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '前往自评' },
          type: 'primary',
          url: `${config.appBaseUrl}/quarter/sheet/${selfSheetUid}`,
        }],
      },
    ],
  };
}

/**
 * 季度评分 · 截止 T-2d 催办卡片（发当前环节仍有未完成 sheet 的人）。
 * spec §7：截止催办。
 */
export function buildQuarterDeadlineCard(
  userName: string,
  quarter: string,
  pendingCount: number,
  deadlineDate: string,
): object {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `【季度考核·截止提醒】${quarter}` },
      template: 'red',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${userName}**，你还有 **${pendingCount}** 项季度评分未完成，截止 **${deadlineDate}**（还剩不到 2 天），请尽快提交。`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '前往打分' },
          type: 'danger',
          url: `${config.appBaseUrl}/quarter`,
        }],
      },
    ],
  };
}

/**
 * 季度评分 · 评分会前一天给管理层的个人清单卡片。
 * spec §7：评分会前一天给管理层发个人清单卡；按钮跳评分会看板。
 */
export function buildPanelEveCard(
  managerName: string,
  quarter: string,
  panelDate: string,
  rateeNames: string[],
): object {
  const elements: any[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**${managerName}**，${quarter} 评分会将于 **${panelDate}** 召开，你需过目 **${rateeNames.length}** 位被评人：`,
      },
    },
  ];
  for (const name of rateeNames.slice(0, 20)) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `- ${name}` } });
  }
  if (rateeNames.length > 20) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `...还有 ${rateeNames.length - 20} 位` } });
  }
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'action',
    actions: [{
      tag: 'button',
      text: { tag: 'plain_text', content: '打开评分会看板' },
      type: 'primary',
      url: `${config.appBaseUrl}/quarter/panel`,
    }],
  });
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `【季度考核·评分会】${quarter} 明日召开` },
      template: 'violet',
    },
    elements,
  };
}

/**
 * 季度评分 · 评分会召集卡片（worker 自动 job convene-panel-check 触发时发给管理层）。
 * 与 API 侧 quarter-cards.ts buildPanelReminderCard 同语义（跨进程各落一份，与 open-quarter-window
 * / buildQuarterSelfWindowCard 模式一致）。按钮跳评分会看板（带 cycle）。
 */
export function buildPanelConveneCard(
  managerName: string,
  quarter: string,
  cycleUid: string,
  pendingCount: number,
): object {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `【季度考核·评分会召集】${quarter}` },
      template: 'violet',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${managerName}**，${quarter} 季度评分会已召集，请进入评分会看板参与集体评分。本周期需管理层评分 **${pendingCount}** 位被评人。`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '打开评分会看板' },
          type: 'primary',
          url: `${config.appBaseUrl}/quarter/panel?cycle=${cycleUid}`,
        }],
      },
    ],
  };
}

/**
 * Feishu card for escalation notification when a challenge exceeds 48h without response.
 * Spec §5.2: PMO + CC ratee
 */
export function buildEscalationCard(
  rateeName: string,
  raterName: string,
  challengedAt: Date,
  scoreUid: string,
): object {
  const challengedAtStr = challengedAt.toISOString().replace('T', ' ').slice(0, 16);
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '【评分质疑超时提醒】' },
      template: 'orange',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${rateeName}** 于 ${challengedAtStr} 提出质疑，**${raterName}** 尚未响应（已超 48 小时）。`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '查看质疑' },
          type: 'danger',
          url: `${config.appBaseUrl}/scores/${scoreUid}`,
        }],
      },
    ],
  };
}
