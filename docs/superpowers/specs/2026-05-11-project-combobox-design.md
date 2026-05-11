# 项目下拉 Combobox 化 设计文档

- **日期**: 2026-05-11
- **状态**: Draft（待用户 review）
- **范围**: 4 处项目下拉 + 1 处 region 下拉 → 统一 `<Combobox>` 原子组件
- **依赖**: `cmdk` (新增) + `tiny-pinyin` (已有)

---

## 1. 背景与目标

`/projects` 页改造后，**项目选择体验**和**新页**风格反差刺眼：
- 4 处项目下拉用原生 `<select>` — 没搜索、原生灰底
- 1 处 region 下拉（project-modal）同病

**目标**：
1. 引入一个**可复用的可搜索下拉**原子组件，对齐 `/projects` 页视觉语言
2. 替换全部 5 处原生 `<select>`
3. 为 Phase 2（5 处人员 popover 重构）打下组件基础（本次不做，下次做）

## 2. 范围

### In Scope（5 处替换）
- `apps/web/src/app/tasks/create/page.tsx:274-284` — 任务创建页 项目选择
- `apps/web/src/app/tasks/[task_uid]/page.tsx:704-717` — 任务详情页 项目选择
- `apps/web/src/components/quick-add-task.tsx:187-194` — 快速添加任务 项目选择
- `apps/web/src/components/project-modal.tsx:115-125` — 项目编辑 modal region 选择
- 新增 `apps/web/src/components/ui/combobox.tsx`

### Out of Scope
- Phase 2：人员 popover 重构（assignee/leader/collaborator × 5 处）
- priority / status 等 4-6 项的小下拉（无搜索价值）
- 多选 Combobox（暂不需要）

## 3. 设计决策（已确认）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 范围 | M：4 项目 + 1 region = 5 处 |
| 2 | 行内容（项目） | 色点(category) + 名 + 副标签 + "板块·国家" 二级文字 |
| 3 | 行内容（region） | 纯文字（5 个固定值） |
| 4 | 搜索算法 | 子串 + 拼音（tiny-pinyin），大小写不敏感 |
| 5 | 展开时机 | 聚焦即展开全部 |
| 6 | 已选态 | 色点 + 名（紧凑） |
| 7 | 组件文件 | `apps/web/src/components/ui/combobox.tsx` |
| 8 | 库 | `cmdk`（vercel 维护，~10KB） |

## 4. 组件 API

### 4.1 类型签名

```ts
// apps/web/src/components/ui/combobox.tsx

export interface ComboboxOption {
  value: string;
  label: string;                          // 主标签（必填）
  searchText?: string;                    // 额外参与搜索的隐藏文本（如 "yindu xtindu"）
  leadingDot?: string;                    // 行头色点的 CSS color（如 "var(--cat-zy)"）
  badge?: string;                         // 副标签（如 "NBFC × 2" / "默认"）
  badgeVariant?: 'subtitle' | 'default';  // subtitle=蓝底，default=灰边框
  trailing?: string;                      // 行右二级文字（如 "自营 · 印度"）
}

export interface ComboboxProps {
  value: string | null;
  onChange: (value: string | null) => void;
  options: ComboboxOption[];
  placeholder?: string;                   // 未选中时的灰色提示
  searchPlaceholder?: string;             // 搜索框 placeholder
  emptyText?: string;                     // 无结果文案
  disabled?: boolean;
  className?: string;                     // 触发按钮额外 class
  allowClear?: boolean;                   // 是否允许清空（默认 false — 必填场景）
  align?: 'start' | 'center' | 'end';     // Popover 对齐
}

export function Combobox(props: ComboboxProps): JSX.Element
```

### 4.2 行为

- **聚焦/点击触发按钮**：弹出 Popover，自动 focus 搜索框，列表显示全部 options
- **输入框**：实时过滤（debounce 不必要，cmdk 自带性能优化）
- **键盘**：`↑↓` 导航、`Enter` 选中、`Esc` 关闭（cmdk 内置）
- **选中**：调用 `onChange(value)` 后自动关闭 popover
- **空结果**：渲染 `emptyText`（默认 "无匹配项"）
- **disabled**：触发按钮变灰，不响应点击
- **allowClear**：true 时显示一个 "×" 清空按钮（在 trigger 内右侧）

### 4.3 搜索匹配算法

```ts
function matchOption(option: ComboboxOption, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  const haystack = [
    option.label,
    option.searchText ?? '',
    option.badge ?? '',
    option.trailing ?? '',
  ].join(' ').toLowerCase();
  if (haystack.includes(q)) return true;
  // 拼音 fallback：把 label + searchText 转拼音再匹配
  const pinyin = TinyPinyin.convertToPinyin(option.label + (option.searchText ?? ''), '', true).toLowerCase();
  return pinyin.includes(q);
}
```

cmdk 用法：`<Command filter={(value, search) => matchOption(byValue.get(value)!, search) ? 1 : 0}>`

## 5. 视觉规范

### 5.1 触发按钮（trigger）

```
┌─────────────────────────────────┐
│ ● XT 印度                    ⌄  │   ← 选中态：色点 + 名 + chevron
└─────────────────────────────────┘
```

- 高 36px，圆角 8px，背景 `var(--bg-surface)`，边框 `var(--border)`
- 未选中时显示 `placeholder` 灰色文字
- focus / open 时边框变 `var(--accent-blue)`

### 5.2 Popover 内容

```
┌─────────────────────────────────┐
│ 🔍 搜索项目（中文/英文/拼音）    │   ← Command.Input
├─────────────────────────────────┤
│ ● XT 印度          自营 · 印度  │   ← Command.Item (selected: bg-blue/10)
│ ● cash 印度  NBFC×2  合作 · 印度│
│ ● 公司建设          集团 · 默认  │
│ ...                              │
└─────────────────────────────────┘
```

- 宽度匹配 trigger 宽度（radix Popover `sideOffset=4`，`align="start"`）
- 最大高 320px，超出滚动
- 行高 36px，hover `bg-var(--bg-hover)`，选中行 `bg-var(--accent-blue)/10`
- 色点 8×8 圆，根据 `leadingDot` CSS color
- badge：subtitle 变体 = `bg-#2563eb text-white text-[11px]`；default 变体 = `border bg-blue-soft text-blue text-[10px]`
- trailing：`text-[11px] text-var(--text-muted)`

## 6. 调用点改造

### 6.1 项目下拉（4 处统一）

```tsx
// 在调用点
const projectOptions: ComboboxOption[] = useMemo(() =>
  (projects ?? []).map((p) => ({
    value: p.projectUid,
    label: p.name,
    leadingDot: p.category ? `var(--cat-${p.category})` : 'var(--text-muted)',
    badge: p.subtitle ?? (p.isDefault ? '默认' : undefined),
    badgeVariant: p.subtitle ? 'subtitle' : 'default',
    trailing: [p.category && CATEGORY_LABEL[p.category], p.region].filter(Boolean).join(' · '),
  })),
[projects]);

<Combobox
  value={projectUid}
  onChange={(v) => setProjectUid(v ?? '')}
  options={projectOptions}
  placeholder="选择项目"
  searchPlaceholder="搜索项目"
/>
```

### 6.2 Region 下拉（1 处）

```tsx
const REGION_OPTIONS: ComboboxOption[] = ProjectRegionList.map((r) => ({
  value: r, label: r,
}));
// 额外加 "无" 占位（项目模型允许空 region）
const REGION_OPTIONS_WITH_NONE = [
  { value: '', label: '无' },
  ...REGION_OPTIONS,
];

<Combobox
  value={v.region ?? ''}
  onChange={(val) => setV(s => ({ ...s, region: (val || null) as ProjectRegion | null }))}
  options={REGION_OPTIONS_WITH_NONE}
  placeholder="选择国家/地区"
  searchPlaceholder="搜索"
/>
```

### 6.3 现有 `<select>` 删除

每处删 8-10 行原生 select，换成 1 个 Combobox JSX。

## 7. 实施步骤（高层）

1. `pnpm --filter @leader-sync/web add cmdk`
2. 写 `combobox.tsx`（TDD）
3. 写 unit test：`combobox.test.tsx`（render / search / pinyin / keyboard）
4. 替换 4 处项目 + 1 处 region
5. 起本地 dev → 目视 → screenshot audit
6. 部署（同 Phase 1 流程：build → rsync → restart → smoke）

## 8. 测试计划

### 8.1 Vitest + RTL（`combobox.test.tsx`）

- ✓ render with options, no selection → shows placeholder
- ✓ click trigger → popover open + first option focused
- ✓ type query → list filtered
- ✓ type pinyin "yd" → matches "印度"
- ✓ ArrowDown + Enter → onChange called with correct value
- ✓ Escape → closes popover
- ✓ disabled → trigger not clickable
- ✓ no match → shows emptyText

### 8.2 Visual audit (Playwright)

- 截图 `03b-projects-create-modal` 重新生成（region 改为 Combobox 后视觉变了）
- 加 `06-tasks-create-with-project-combobox` 截图（任务创建页项目 dropdown 打开态）

### 8.3 集成测试（手动 in dev）

- 任务创建页 → 选项目 → 提交 → 后端 `task.project_uid` 正确写入
- 任务详情页 → 改项目 → PATCH 成功
- quick-add → 选项目 → 默认值切换 OK
- project-modal → 改 region → 保存生效

## 9. 风险与回滚

| 风险 | 缓解 |
|---|---|
| cmdk 与 radix Popover 冲突 | 它们设计上兼容（shadcn/ui 也这么用），有兜底就 fallback radix Popover 自建列表 |
| 拼音库性能（项目少时不是问题） | 21 项目 + 5 region — 完全可忽略；将来 100+ 项目时改成 `useMemo` 预计算拼音 |
| 已有 inline 人员 popover 风格不一致（Phase 2 才统一） | 接受短期不一致，spec 备注 |
| 部署后样式跑掉（dark/light theme） | 截图审计 + 在 dev 切换 theme 目视 |

回滚：
- `git revert <combobox commit>`（5 处原生 select 都恢复）
- 卸 cmdk：`pnpm --filter @leader-sync/web remove cmdk`

## 10. 验收清单

- [ ] cmdk 已加入 `apps/web` 依赖
- [ ] `combobox.tsx` 实现 + 单测 ≥ 8 个全绿
- [ ] 4 处项目下拉换成 Combobox
- [ ] 1 处 region 下拉换成 Combobox
- [ ] 任务创建/编辑/快速添加 三个流的项目选择 e2e 验证
- [ ] 截图审计 2 张（修改的 + 新增的）
- [ ] dark / light theme 均无样式回归
- [ ] 部署到生产 + 烟雾测试通过
