# Dashboard UI Improvements Design

Date: 2026-04-09

## Overview

Four improvements to the dashboard page for better usability and visual consistency.

## 1. Period Selector — Tab + Dropdown

**Current:** 月/季/年 pill 切换 + 硬编码枚举按钮（月份只显示最近 3 个月）。

**Target:**

```
[月 | 季]    [▼ 2026年4月]
```

- 两个 tab：月 / 季（去掉年模式）
- 默认选中当月
- 右侧下拉选择器：
  - 月模式：当年 1-12 月（`2026年1月` ... `2026年12月`）
  - 季模式：当年 Q1-Q4（`2026年 Q1` ... `2026年 Q4`）
- 下拉用标准 select 样式，点击展开选项列表

**涉及组件:** `PeriodSelector`，`DashboardPeriod` type（去掉 `year` mode）。

## 2. Person Overview — 排行榜表格

**Current:** `PersonCard` 卡片网格（3列），每人一张卡，信息密度低。

**Target:** 紧凑排行榜表格，固定按完成率降序排列。

| 姓名 | Leader | 总任务 | 完成 | 延期 | 风险 | 新增 | 完成率 |
|------|--------|--------|------|------|------|------|--------|
| 张三 | 王总 | 12 | 10 | 0 | 1 | 2 | ████████░░ 83% |

- 延期 > 0：红色 badge
- 风险 > 0：橙色 badge
- 完成率行内进度条，颜色阈值：>=80% 绿 / 50-79% 蓝 / <50% 红
- 无交互排序，无行展开
- Leader 分组 / 项目分组切换保留，分组时表头加 Leader section header

**涉及组件:** `PersonCards` → `PersonTable`，`PersonCard` 删除。

## 3. Person Filter Combobox — 下拉列表 + 搜索 + 拼音

**Current:** `FilterBar` 人员下拉是纯 checkbox 列表，无搜索。

**Target:** Combobox 模式。

```
┌─────────────────────┐
│ 🔍 搜索人员...       │  ← 自动聚焦
├─────────────────────┤
│ ☑ 张三              │  ← 完整人员列表，实时过滤
│ ☐ 李四              │
│ ☑ 王五              │
├─────────────────────┤
│ 全选    清除         │
└─────────────────────┘

按钮显示: [张三, 王五 ▼]  （最多 2 个名字 + "+N"）
```

- 默认展开完整人员列表
- 搜索支持中文 + 拼音首字母
- 人员 > 10 时列表加 max-height 滚动
- 底部「全选 | 清除」快捷操作
- 引入 `tiny-pinyin` 库（~4KB gzip）

**涉及组件:** `FilterBar` 重写人员选择部分。

## 4. Light Mode Theme Fixes

**Current:** 多处硬编码深色值，白色模式下对比度不足。

### 4a. HeroStats 主题适配
- 移除硬编码 `from-[#12121a] to-[#1a1a2e]`
- 深色模式保持现有深色渐变
- 白色模式改为浅蓝渐变 `from-[#eff6ff] to-[#f0f9ff]`
- 内部卡片：深色 `bg-[#0a0a0f]/60` → 白色 `bg-white/80`
- 文字 `text-white` → `text-[var(--text-primary)]`

### 4b. Dropdown 浮层
- 面板 `bg-[var(--bg-surface)]` → `bg-[var(--bg-card)]`
- 增加 `shadow-lg` 投影

### 4c. 甘特图网格线
- 新增 CSS 变量 `--border-strong`
  - 深色：`#3a3a4a`
  - 白色：`#d1d5db`
- 甘特图网格线使用 `--border-strong`

### 4d. 状态 Badge 透明度
- 白色模式下 badge 底色透明度从 `/10` 提升到 `/15`
- 或用 CSS 变量定义各状态 badge 底色

### 4e. Accent 颜色变量化
- 全局替换硬编码 `#3b82f6` → `var(--accent-blue)`
- 同理 `#22c55e` → `var(--accent-green)`，`#ef4444` → `var(--accent-red)`，`#f59e0b` → `var(--accent-orange)`

## Files Affected

| File | Changes |
|------|---------|
| `apps/web/src/app/globals.css` | 新增 `--border-strong`，HeroStats 主题变量 |
| `apps/web/src/app/dashboard/page.tsx` | PeriodSelector、PersonTable、FilterBar、HeroStats、accent 变量化 |
| `apps/web/src/components/gantt-chart.tsx` | 网格线变量化、accent 变量化 |
| `apps/web/package.json` | 新增 `tiny-pinyin` 依赖 |

## Dependencies

- `tiny-pinyin`：拼音首字母匹配库
