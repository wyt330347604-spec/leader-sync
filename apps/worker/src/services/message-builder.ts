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

export function buildLeaderOverdueNotice(leaderName: string, employeeName: string, taskTitle: string, daysOverdue: number): object {
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '团队成员任务延期通知' }, template: 'orange' },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**${employeeName}** 的任务 **${taskTitle}** 已延期 **${Math.abs(daysOverdue)}** 天。` } },
      { tag: 'hr' },
      { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '查看详情' }, type: 'default', url: `${config.appBaseUrl}/tasks` }] },
    ],
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
