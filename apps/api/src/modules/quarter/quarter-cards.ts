/**
 * quarter-cards.ts
 *
 * 季度评分飞书交互卡片构造器（纯函数，无 I/O，可单测）。
 * 样式对齐 worker apps/worker/src/services/message-builder.ts 的 buildScoreWindowCard：
 *   header template=violet + lark_md 正文 + action 按钮（url=appBaseUrl+path）。
 * 由 QuarterNotifierService 组装 base（WEB_BASE_URL）后调用，经 FeishuMessengerService.sendCardToUser 下发。
 *
 * spec 2026-07-08 performance-review-module §7：公示出分（发本人）/ 申诉提交（发 HR）/ 同事被指定告知。
 */

/** 飞书交互卡片（interactive）最小结构。 */
export interface FeishuCard {
  config: { wide_screen_mode: boolean };
  header: { title: { tag: 'plain_text'; content: string }; template: string };
  elements: unknown[];
}

type ButtonType = 'primary' | 'default' | 'danger';

function md(content: string) {
  return { tag: 'div', text: { tag: 'lark_md', content } };
}

function button(text: string, url: string, type: ButtonType = 'primary') {
  return {
    tag: 'action',
    actions: [{ tag: 'button', text: { tag: 'plain_text', content: text }, type, url }],
  };
}

function card(title: string, elements: unknown[], template = 'violet'): FeishuCard {
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: title }, template },
    elements,
  };
}

export interface PublishCardInfo {
  rateeName: string | null;
  quarter: string | null;
  total: number | null;
  grade: string | null;
  deadlineText: string | null;
  resultUid: string;
}

/** 公示出分 → 本人：季度/总分/评级/申诉截止 + 按钮跳详情页（含申诉入口）。 */
export function buildPublishCard(base: string, info: PublishCardInfo): FeishuCard {
  const elements: unknown[] = [
    md(`**${info.rateeName ?? ''}** 你好，${info.quarter ?? ''} 季度考核成绩已公示：`),
    md(`总分 **${info.total ?? '-'}**　评级 **${info.grade ?? '-'}**`),
  ];
  if (info.deadlineText) elements.push(md(`申诉截止：**${info.deadlineText}**（逾期不可申诉）`));
  elements.push({ tag: 'hr' });
  elements.push(button('查看详情 / 申诉', `${base}/quarter/result/${info.resultUid}`));
  return card(`【季度考核·成绩公示】${info.quarter ?? ''}`, elements);
}

export interface AppealCardInfo {
  rateeName: string | null;
  quarter: string | null;
  content: string;
}

/** 申诉提交 → HR：谁申诉了哪条 + 按钮进申诉台。 */
export function buildAppealCard(base: string, info: AppealCardInfo): FeishuCard {
  const elements: unknown[] = [
    md(`**${info.rateeName ?? '某被评人'}** 对 ${info.quarter ?? ''} 季度成绩提交了申诉：`),
    md(`> ${info.content}`),
    { tag: 'hr' },
    button('前往处理', `${base}/quarter/panel`, 'danger'),
  ];
  return card(`【季度考核·申诉待处理】${info.quarter ?? ''}`, elements, 'orange');
}

export interface PeerAssignedCardInfo {
  peerName: string | null;
  rateeName: string | null;
  quarter: string | null;
  sheetUid: string;
}

/** 同事被指定告知 → 被指定人：为谁打分 + 按钮跳打分页。 */
export function buildPeerAssignedCard(base: string, info: PeerAssignedCardInfo): FeishuCard {
  const elements: unknown[] = [
    md(`**${info.peerName ?? ''}** 你好，你被指定为 **${info.rateeName ?? ''}** 的 ${info.quarter ?? ''} 季度同事评价人。`),
    md('请在打分窗口内完成同事评价（软项各维度打分）。'),
    { tag: 'hr' },
    button('前往打分', `${base}/quarter/sheet/${info.sheetUid}`),
  ];
  return card(`【季度考核·同事评价】${info.quarter ?? ''}`, elements);
}
