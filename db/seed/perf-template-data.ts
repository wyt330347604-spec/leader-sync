// perf-template-data.ts
// 四个打分模板的维度/权重/档位锚定 —— 定稿原文，desc 照录不改写。
//   数据源A（季度 V2.3 精简版，docx NzEGdyapVo4Te1xwFsncN6tmnRf）
//   数据源B（月度 V1.4，绩效考核/月度考核打分工具_V1.4.docx）
// 供 perf-templates.ts 幂等灌库；也可被计分引擎/前端直接读作参照。

import type { GradeBand, DimensionAnchor } from '../src/schema/score-template';

export interface TemplateDimensionSeed {
  code: string;
  name: string;
  description: string;
  weight: number;
  anchors: DimensionAnchor[];
}

export interface ScoreTemplateSeed {
  code: 'monthly_employee' | 'monthly_leader' | 'quarterly_employee' | 'quarterly_leader';
  version: number;
  scale: 'coefficient' | 'one_to_ten';
  goalWeight: number | null;
  gradeBands: GradeBand[];
  dimensions: TemplateDimensionSeed[];
}

// ── 等级表（评级 = 自上而下首个满足下界的档）───────────────────────────────
// 月度（Harvey 已批）：S>100 / A 90–100 / B 80–89 / C 70–79 / D<70
export const MONTHLY_GRADE_BANDS: GradeBand[] = [
  { grade: 'S', min: 100, minInclusive: false, label: '卓越贡献者', display: '>100' },
  { grade: 'A', min: 90, minInclusive: true, label: '优秀贡献者', display: '90–100' },
  { grade: 'B', min: 80, minInclusive: true, label: '良好贡献者', display: '80–89' },
  { grade: 'C', min: 70, minInclusive: true, label: '合格贡献者', display: '70–79' },
  { grade: 'D', min: null, minInclusive: true, label: '待发挥贡献者', display: '<70' },
];
// 季度（V2.3 等级表）：S≥90 / A 80–89 / B 70–79 / C 60–69 / D<60 或触发红线
export const QUARTERLY_GRADE_BANDS: GradeBand[] = [
  { grade: 'S', min: 90, minInclusive: true, label: '卓越贡献者', display: '≥ 90' },
  { grade: 'A', min: 80, minInclusive: true, label: '优秀贡献者', display: '80–89' },
  { grade: 'B', min: 70, minInclusive: true, label: '良好贡献者', display: '70–79' },
  { grade: 'C', min: 60, minInclusive: true, label: '合格贡献者', display: '60–69' },
  { grade: 'D', min: null, minInclusive: true, label: '待发挥贡献者', display: '< 60 或触发红线' },
];

// 便捷构造：档位锚定
const a = (grade: string, range: string, desc: string): DimensionAnchor => ({ grade, range, desc });

// ── 数据源B：月度 V1.4（系数制）────────────────────────────────────────────
const MONTHLY_EMPLOYEE: ScoreTemplateSeed = {
  code: 'monthly_employee',
  version: 1,
  scale: 'coefficient',
  goalWeight: null,
  gradeBands: MONTHLY_GRADE_BANDS,
  dimensions: [
    {
      code: 'workload',
      name: '工作量',
      description: '本月承接的工作量是否饱和、与岗位是否匹配（看负荷，不看活动量多少）。',
      weight: 15,
      anchors: [
        a('A', '1.0 以上', '承接量饱满且接得住，还能主动多担'),
        a('B', '1.0（或者 0.85-1）', '承接量正常，达到岗位应有负荷'),
        a('C', '1.0 以下（0.85 以下）', '承接量不饱和'),
      ],
    },
    {
      code: 'delivery',
      name: '交付质量（含结果）',
      description: '本月该交付的，做出来了没有 + 做得对不对、好不好、合不合规。',
      weight: 85,
      anchors: [
        a('S', '1.0 以上', '该交付的高质量完成，结果达标、几乎无差错，合规无问题'),
        a('A', '0.9 – 1.0', '基本都完成且质量好，结果达标，偶有小瑕疵'),
        a('B', '0.7 – 0.89', '大部分完成、结果基本达标，质量一般、偶有返工'),
        a('C', '0.7 以下', '部分没完成或结果未达标，或质量问题较多、返工多'),
      ],
    },
  ],
};

const MONTHLY_LEADER: ScoreTemplateSeed = {
  code: 'monthly_leader',
  version: 1,
  scale: 'coefficient',
  goalWeight: null,
  gradeBands: MONTHLY_GRADE_BANDS,
  dimensions: [
    {
      code: 'team_workload',
      name: '团队工作量',
      description: '团队本月承接 / 产出的量是否饱满、与团队配置是否匹配（看负荷，不看活动量）。',
      weight: 10,
      anchors: [
        a('A', '1.0 以上', '团队产出饱满，超出基准还接得住'),
        a('B', '0.9 – 1.0', '团队产出正常，与配置匹配'),
        a('C', '0.7 – 0.89', '团队产出未达预期'),
      ],
    },
    {
      code: 'team_delivery',
      name: '团队交付质量（含结果）',
      description: '团队本月该交付的，做出来了没有 + 做得好不好、合不合规。',
      weight: 70,
      anchors: [
        a('S', '1.0 以上', '团队交付高质量完成、结果达标、几乎无差错，合规无问题'),
        a('A', '0.9 – 1.0', '基本完成且质量好，结果达标，偶有小瑕疵'),
        a('B', '0.7 – 0.89', '大部分完成、结果基本达标，质量一般、偶有返工'),
        a('C', '0.5 – 0.69', '部分未完成或未达标，或质量 / 返工问题较多'),
        a('D', '0.5 以下', '大量未完成 / 结果差，或出现严重质量、合规问题'),
      ],
    },
    {
      code: 'leadership',
      name: '领导力',
      description:
        '本月有没有尽到当头儿的职责：日常管理到位（给方向、处理问题、撑住团队）；对下属的评价客观（不和稀泥、不偏袒、敢给真实评价）。',
      weight: 20,
      anchors: [
        a('A', '1.0 以上', '管理到位、主动处理团队问题撑住团队；对下属评价客观真实，敢碰硬'),
        a('B', '0.85 – 1.0', '管理到位，团队运转顺，对下属评价基本客观'),
        a('C', '0.85 以下', '基本尽到管理职责，但有时被动；评价不够客观，甚至有争议'),
      ],
    },
  ],
};

// ── 数据源A：季度 V2.3（1–10 制）───────────────────────────────────────────
const QUARTERLY_EMPLOYEE: ScoreTemplateSeed = {
  code: 'quarterly_employee',
  version: 1,
  scale: 'one_to_ten',
  goalWeight: 45, // 目标达成（个人），满分 45，单独打
  gradeBands: QUARTERLY_GRADE_BANDS,
  dimensions: [
    {
      code: 'expertise',
      name: '专业与解决问题',
      description:
        '专业知识技能扎实、能独立把本职做完；没做过、没人教的事也能自己想清、找到办法办成。',
      weight: 18,
      anchors: [
        a('S', '9–10', '专业过硬，复杂没做过的也能独立理清、拿出完整办法干成，还能带教别人'),
        a('A', '7–8', '专业扎实，本职完全独立完成，大部分新问题能自己解决'),
        a('B', '5–6', '日常能应付，稍难或没做过的常需人点一下'),
        a('C', '3–4', '技能有明显短板，不少工作和新问题要靠别人帮'),
        a('D', '1–2', '必备技能不熟，日常经常做不下来，要人手把手带'),
      ],
    },
    {
      code: 'initiative',
      name: '主动与担当',
      description: '事到手上能不能主动往前推、对结果负责；有没有把事做好的劲头；是不是只顾自己一摊。',
      weight: 15,
      anchors: [
        a('S', '9–10', '主动推进到底、对结果兜底，愿为团队多担，劲头强'),
        a('A', '7–8', '本职主动负责、凡事有交代，也愿多担些'),
        a('B', '5–6', '本职能负责完成，超范围较少主动'),
        a('C', '3–4', '被动，推一下动一下，出事易往外推'),
        a('D', '1–2', '缺主动和责任，只守一摊还常掉链子'),
      ],
    },
    {
      code: 'collaboration',
      name: '协作',
      description: '愿不愿意配合别人、主动帮同事、为共同目标出力。',
      weight: 10,
      anchors: [
        a('S', '9–10', '主动配合、乐于帮人，为共同目标尽全力'),
        a('A', '7–8', '爱护团队，经常主动帮同事'),
        a('B', '5–6', '别人求助会帮，配合度正常'),
        a('C', '3–4', '只在必须时才配合，比较被动'),
        a('D', '1–2', '不配合、各自为政'),
      ],
    },
    {
      code: 'learning',
      name: '学习与自省',
      description:
        '会不会从经验和反馈里成长——既主动复盘、改进做法，也听得进批评、清楚自己的强弱。',
      weight: 12,
      anchors: [
        a('S', '9–10', '主动复盘把教训变改进，也主动求反馈、虚心受教，对自己看得准，能带动他人'),
        a('A', '7–8', '会复盘并改进，能接受批评，自我认知较清'),
        a('B', '5–6', '偶尔复盘、多数批评听得进，认知基本到位'),
        a('C', '3–4', '很少复盘、听批评易有情绪或防御，短板认识不清'),
        a('D', '1–2', '不复盘、错误反复犯，听不进意见、看不到自己的问题'),
      ],
    },
  ],
};

// 注意顺序：拆目标第一（spec §3.1 / task 明确）
const QUARTERLY_LEADER: ScoreTemplateSeed = {
  code: 'quarterly_leader',
  version: 1,
  scale: 'one_to_ten',
  goalWeight: 40, // 团队结果，满分 40，单独打
  gradeBands: QUARTERLY_GRADE_BANDS,
  dimensions: [
    {
      code: 'planning',
      name: '业务拆分和规划',
      description: '把团队的目标拆清楚、排好优先级、让方向一致，并为团队做好规划。',
      weight: 15,
      anchors: [
        a('S', '9–10', '把大目标拆得清清楚楚、优先级排得明白，人人知道干什么为什么，方向高度一致，并为团队做好前瞻规划'),
        a('A', '7–8', '拆解清楚、优先级合理，方向大体一致，偏差能及时纠'),
        a('B', '5–6', '能拆出基本任务，但优先级不够清晰，部分人需反复说明'),
        a('C', '3–4', '拆得含糊、优先级混乱，各干各、方向易飘'),
        a('D', '1–2', '基本不拆、缺规划，团队不知道往哪走'),
      ],
    },
    {
      code: 'team_building',
      name: '团队规划与建设',
      description:
        '包含人才梯队建设、人才筛选和培养（先筛选后培养），以身作则；听得进各方（含下属）反馈。',
      weight: 14,
      anchors: [
        a('S', '9–10', '团队明显成长、能带出独当一面的人，关键人留得住、有梯队；以身作则，主动听反馈肯改'),
        a('A', '7–8', '会带人，下属普遍成长，团队稳定；能接受反馈并调整'),
        a('B', '5–6', '能带上手日常，成长有限、培养不主动；多数反馈听得进'),
        a('C', '3–4', '基本只派活不带人，成长慢偶有流失；反馈防御重'),
        a('D', '1–2', '不带不培养，团队没长进、骨干流失；听不进意见'),
      ],
    },
    {
      code: 'decision',
      name: '业务理解和决策（含解决复杂问题）',
      description: '懂业务、判断准、敢拍板，错了能纠；复杂 / 没先例的事也能想清楚、拿出办法。',
      weight: 12,
      anchors: [
        a('S', '9–10', '懂业务全局，复杂/没先例的局面也能想清楚、拿出办法；判断准、敢拍板，错了能快纠'),
        a('A', '7–8', '业务理解好，多数决策及时靠谱，少数失误能纠'),
        a('B', '5–6', '常规决策没问题，难/模糊时易拖或拿不准'),
        a('C', '3–4', '该决迟迟不决，或常偏差且纠得慢'),
        a('D', '1–2', '不敢/乱决，判断差，反复添乱'),
      ],
    },
    {
      code: 'cross_func',
      name: '跨职能协调（含懂全盘）',
      description: '懂全盘 + 主动拉通产品/技术/运营、识别断点、推动对齐、传准信息。',
      weight: 12,
      anchors: [
        a('S', '9–10', '既懂全盘又能主动拉通各职能，识别断点、推动对齐、传准信息，是打破孤岛的人'),
        a('A', '7–8', '懂主要相关业务怎么和自己挂钩，跨团队配合好、能主动协调'),
        a('B', '5–6', '自己这块熟，必要的跨部门事项能配合，但主动拉通不够'),
        a('C', '3–4', '基本只懂自己一摊，跨部门常推诿或对不上'),
        a('D', '1–2', '只埋头自己的活，不配合，本位主义重'),
      ],
    },
    {
      code: 'innovation',
      name: '落地创新解决方案和解决业务疑难问题',
      description:
        '偏项目方向，更多的是历史问题和新问题是否能提出建设性意见和尝试，是否能有创新想法和方案落地。',
      weight: 7,
      anchors: [
        a('S', '9–10', '历史遗留和全新难题都能提出有价值的建设性方案，推动创新想法真正落地见效，并带动团队一起解题'),
        a('A', '7–8', '多数疑难问题能拿出可行思路并落地，时有创新尝试且见成效'),
        a('B', '5–6', '常规问题能解决，遇到疑难或需要创新时办法有限、落地不够彻底'),
        a('C', '3–4', '疑难问题多靠他人推动，少有主动尝试，方案难以落地'),
        a('D', '1–2', '遇到难题绕着走，既提不出办法也推不动落地'),
      ],
    },
  ],
};

export const PERF_TEMPLATES: ScoreTemplateSeed[] = [
  MONTHLY_EMPLOYEE,
  MONTHLY_LEADER,
  QUARTERLY_EMPLOYEE,
  QUARTERLY_LEADER,
];
