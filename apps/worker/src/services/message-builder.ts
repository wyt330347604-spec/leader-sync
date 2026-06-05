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
