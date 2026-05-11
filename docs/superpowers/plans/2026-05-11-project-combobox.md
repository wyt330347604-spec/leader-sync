# 项目下拉 Combobox 化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 `cmdk` + 自建 `<Combobox>` 原子组件替换 4 处项目下拉 + 1 处 region 下拉，对齐 `/projects` 页视觉语言并提供搜索（中文/英文/拼音）。

**Architecture:** 新增 1 个原子组件（`combobox.tsx`，~120 行 + 测试），5 处调用点逐一替换原生 `<select>`。Popover 复用现有 radix `popover.tsx`，列表用 `cmdk` 的 `Command/Command.Input/Command.List/Command.Item`，拼音匹配用现有 `tiny-pinyin`。

**Tech Stack:** Next.js 15 + React 19 + radix-ui Popover + cmdk + tiny-pinyin + Tailwind CSS + Vitest + Playwright

**Spec 来源:** `docs/superpowers/specs/2026-05-11-project-combobox-design.md`

---

## File Structure

### 新增
- **Create** `apps/web/src/components/ui/combobox.tsx` — 通用 Combobox 原子组件
- **Create** `apps/web/src/components/ui/__tests__/combobox.test.tsx` — vitest + RTL 单测

### 修改
- **Modify** `apps/web/package.json` — 加 `cmdk` 依赖
- **Modify** `apps/web/src/app/tasks/create/page.tsx` (line ~271-284) — 项目 select → Combobox
- **Modify** `apps/web/src/app/tasks/[task_uid]/page.tsx` (line ~702-719) — 项目 select → Combobox
- **Modify** `apps/web/src/components/quick-add-task.tsx` (line ~187-194) — 项目 select → Combobox
- **Modify** `apps/web/src/components/project-modal.tsx` (line ~115-125) — region select → Combobox
- **Modify** `apps/web/e2e/desktop.spec.ts` — 加 2 个 modal 打开态截图

---

## Task 1: 加 cmdk 依赖

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync
pnpm --filter @leader-sync/web add cmdk
```

Expected: `cmdk` 出现在 `apps/web/package.json` 的 `dependencies` 里（版本 `^1.x`）；`pnpm-lock.yaml` 更新。

- [ ] **Step 2: 验证 import 可用**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web
pnpm exec tsc -e "import { Command } from 'cmdk'; console.log(typeof Command);" 2>&1 | head -3 || true
```

如果 tsc -e 不可用，直接确认 `ls node_modules/cmdk/dist/index.js` 有文件即可。

- [ ] **Step 3: Commit**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync
git add apps/web/package.json pnpm-lock.yaml
git commit -m "deps(web): add cmdk for command-palette combobox"
```

---

## Task 2: 写 Combobox 单测（TDD RED）

**Files:**
- Create: `apps/web/src/components/ui/__tests__/combobox.test.tsx`

- [ ] **Step 1: 写完整测试文件**

创建 `apps/web/src/components/ui/__tests__/combobox.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Combobox, type ComboboxOption } from '../combobox';

const SIMPLE_OPTIONS: ComboboxOption[] = [
  { value: 'p1', label: 'XT 印度', leadingDot: '#DC2626', trailing: '自营 · 印度' },
  { value: 'p2', label: 'cash 印度', leadingDot: '#2563EB', badge: 'NBFC × 2', badgeVariant: 'subtitle', trailing: '合作 · 印度' },
  { value: 'p3', label: '公司建设', leadingDot: '#475569', badge: '默认', badgeVariant: 'default', trailing: '集团' },
];

function renderWith(props: Partial<Parameters<typeof Combobox>[0]> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <Combobox
      value={null}
      onChange={onChange}
      options={SIMPLE_OPTIONS}
      placeholder="选择项目"
      searchPlaceholder="搜索"
      {...props}
    />,
  );
  return { ...utils, onChange };
}

describe('Combobox — render', () => {
  it('shows placeholder when no value selected', () => {
    renderWith();
    expect(screen.getByText('选择项目')).toBeInTheDocument();
  });

  it('shows label of selected option', () => {
    renderWith({ value: 'p1' });
    expect(screen.getByText('XT 印度')).toBeInTheDocument();
  });
});

describe('Combobox — open / search', () => {
  it('opens popover on trigger click and lists all options', async () => {
    renderWith();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('搜索')).toBeInTheDocument();
    });
    expect(screen.getByText('XT 印度')).toBeInTheDocument();
    expect(screen.getByText('cash 印度')).toBeInTheDocument();
    expect(screen.getByText('公司建设')).toBeInTheDocument();
  });

  it('filters list by substring match', async () => {
    renderWith();
    fireEvent.click(screen.getByRole('button'));
    const input = await screen.findByPlaceholderText('搜索');
    fireEvent.change(input, { target: { value: '印度' } });
    await waitFor(() => {
      expect(screen.queryByText('公司建设')).not.toBeInTheDocument();
    });
    expect(screen.getByText('XT 印度')).toBeInTheDocument();
    expect(screen.getByText('cash 印度')).toBeInTheDocument();
  });

  it('filters by pinyin (yd → 印度)', async () => {
    renderWith();
    fireEvent.click(screen.getByRole('button'));
    const input = await screen.findByPlaceholderText('搜索');
    fireEvent.change(input, { target: { value: 'yd' } });
    await waitFor(() => {
      expect(screen.queryByText('公司建设')).not.toBeInTheDocument();
    });
    expect(screen.getByText('XT 印度')).toBeInTheDocument();
  });

  it('shows emptyText on no match', async () => {
    renderWith({ emptyText: '没有匹配' });
    fireEvent.click(screen.getByRole('button'));
    const input = await screen.findByPlaceholderText('搜索');
    fireEvent.change(input, { target: { value: 'zzzzz' } });
    await waitFor(() => {
      expect(screen.getByText('没有匹配')).toBeInTheDocument();
    });
  });
});

describe('Combobox — selection', () => {
  it('calls onChange with value when option clicked', async () => {
    const { onChange } = renderWith();
    fireEvent.click(screen.getByRole('button'));
    const opt = await screen.findByText('XT 印度');
    fireEvent.click(opt);
    expect(onChange).toHaveBeenCalledWith('p1');
  });
});

describe('Combobox — disabled', () => {
  it('does not open when disabled', () => {
    renderWith({ disabled: true });
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByPlaceholderText('搜索')).not.toBeInTheDocument();
  });
});

describe('Combobox — badge variants', () => {
  it('renders subtitle badge with blue style', async () => {
    renderWith();
    fireEvent.click(screen.getByRole('button'));
    const badge = await screen.findByText('NBFC × 2');
    expect(badge).toBeInTheDocument();
    // 视觉断言只验证存在，颜色样式 e2e 截图覆盖
  });

  it('renders default badge', async () => {
    renderWith();
    fireEvent.click(screen.getByRole('button'));
    const badge = await screen.findByText('默认');
    expect(badge).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试，确认 RED**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web
pnpm vitest run src/components/ui/__tests__/combobox.test.tsx
```

Expected: 测试报错 "Cannot find module '../combobox'" 或类似。

---

## Task 3: 实现 Combobox 组件（GREEN）

**Files:**
- Create: `apps/web/src/components/ui/combobox.tsx`

- [ ] **Step 1: 写组件代码**

创建 `apps/web/src/components/ui/combobox.tsx`：

```tsx
'use client';
import * as React from 'react';
import { Command } from 'cmdk';
import TinyPinyin from 'tiny-pinyin';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface ComboboxOption {
  value: string;
  label: string;
  searchText?: string;
  leadingDot?: string;
  badge?: string;
  badgeVariant?: 'subtitle' | 'default';
  trailing?: string;
}

export interface ComboboxProps {
  value: string | null;
  onChange: (value: string | null) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  allowClear?: boolean;
  align?: 'start' | 'center' | 'end';
}

function toPinyin(s: string): string {
  try {
    return TinyPinyin.convertToPinyin(s, '', true).toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

function matchOption(option: ComboboxOption, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const haystack = [option.label, option.searchText ?? '', option.badge ?? '', option.trailing ?? '']
    .join(' ')
    .toLowerCase();
  if (haystack.includes(q)) return true;
  const pinyin = toPinyin(option.label + (option.searchText ?? ''));
  return pinyin.includes(q);
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = '选择…',
  searchPlaceholder = '搜索…',
  emptyText = '无匹配项',
  disabled = false,
  className = '',
  allowClear = false,
  align = 'start',
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const byValue = React.useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const selected = value ? byValue.get(value) : null;

  const filter = React.useCallback(
    (val: string, search: string) => (matchOption(byValue.get(val)!, search) ? 1 : 0),
    [byValue],
  );

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`flex w-full items-center justify-between rounded-xl bg-[var(--bg-surface)] border px-4 py-3 text-sm transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/40 ${
            open ? 'border-[var(--accent-blue)]/50' : 'border-[var(--border)]'
          } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className}`}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {selected ? (
              <>
                {selected.leadingDot && (
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: selected.leadingDot }}
                  />
                )}
                <span className="truncate text-[var(--text-primary)]">{selected.label}</span>
              </>
            ) : (
              <span className="text-[var(--text-muted)]">{placeholder}</span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[var(--text-muted)]">
            {allowClear && selected && !disabled && (
              <span
                role="button"
                aria-label="清空选择"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
                className="rounded p-0.5 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <ClearIcon />
              </span>
            )}
            <ChevronDownIcon />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] p-0 bg-[var(--bg-card)] border-[var(--border)]"
      >
        <Command filter={filter} className="overflow-hidden rounded-lg">
          <div className="border-b border-[var(--border)] px-3">
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder={searchPlaceholder}
              className="h-10 w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
          <Command.List className="max-h-[320px] overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
              {emptyText}
            </Command.Empty>
            {options.map((opt) => (
              <Command.Item
                key={opt.value}
                value={opt.value}
                onSelect={(val) => {
                  onChange(val);
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-sm text-[var(--text-primary)] aria-selected:bg-[var(--accent-blue)]/10 hover:bg-[var(--bg-hover)]"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {opt.leadingDot && (
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: opt.leadingDot }}
                    />
                  )}
                  <span className="truncate">{opt.label}</span>
                  {opt.badge && (
                    <span
                      className={
                        opt.badgeVariant === 'subtitle'
                          ? 'shrink-0 rounded-md bg-[#2563eb] px-1.5 py-0.5 text-[11px] font-semibold text-white'
                          : 'shrink-0 rounded-full border border-[#3b82f6]/20 bg-[#3b82f6]/10 px-2 py-0.5 text-[10px] text-[#3b82f6]'
                      }
                    >
                      {opt.badge}
                    </span>
                  )}
                </span>
                {opt.trailing && (
                  <span className="ml-2 shrink-0 text-[11px] text-[var(--text-muted)]">{opt.trailing}</span>
                )}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: 跑测试，确认 GREEN**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web
pnpm vitest run src/components/ui/__tests__/combobox.test.tsx
```

Expected: 10 PASS (8 个 describe block，10 个 it)。

**如果失败常见情况：**
- `cmdk` 的 `Command.Empty` 在 query 为空时默认不显示 → 测试期望可能要调整：在 emptyText 测试里强制输入 zzzzz
- pinyin 测试失败：检查 `TinyPinyin.convertToPinyin` 的导出方式（可能要 `TinyPinyin.default` 或 `* as TinyPinyin`）
- radix Popover 默认不自动渲染到 DOM 直到 open=true → fireEvent.click 后用 await waitFor

- [ ] **Step 3: 全 web 测试通跑**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web
pnpm test 2>&1 | tail -10
```

Expected: 之前 16 + 现在新增 10 = 26 tests 全过。

- [ ] **Step 4: Commit**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync
git add apps/web/src/components/ui/combobox.tsx apps/web/src/components/ui/__tests__/combobox.test.tsx
git commit -m "feat(web): add Combobox atom (cmdk + pinyin + radix popover)"
```

---

## Task 4: 替换 tasks/create 项目下拉

**Files:**
- Modify: `apps/web/src/app/tasks/create/page.tsx`

- [ ] **Step 1: 加 import**

文件顶部 import 段（看现有 import 位置，约 line 1-15）增加：

```ts
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { ProjectCategoryLabel } from '@leader-sync/shared-types';
```

- [ ] **Step 2: 在组件函数体内（紧挨着 `const { data: projects } = ...` 行后面）加 options 派生**

找到 `projects` 数据加载处（搜 `useSWR.*projects`），紧接着添加：

```ts
const projectOptions: ComboboxOption[] = React.useMemo(
  () =>
    (projects ?? []).map((p) => ({
      value: p.projectUid,
      label: p.name,
      leadingDot: p.category ? `var(--cat-${p.category})` : 'var(--text-muted)',
      badge: p.subtitle ?? (p.isDefault ? '默认' : undefined),
      badgeVariant: p.subtitle ? 'subtitle' : 'default',
      trailing: [p.category && ProjectCategoryLabel[p.category], p.region].filter(Boolean).join(' · ') || undefined,
    })),
  [projects],
);
```

如果文件未 import React 的 `useMemo` / `React`，加 import：`import * as React from 'react';` 或者直接 `import { useMemo } from 'react';`（看现有风格而定，匹配同文件其他 hook 的 import 形式）。

- [ ] **Step 3: 替换 JSX**

找到 line ~271-284（搜 `<label htmlFor="project_uid">`），把整段：

```tsx
{/* Project */}
<div>
  <label htmlFor="project_uid" className={labelClass}>所属项目</label>
  <select
    id="project_uid"
    value={projectUid}
    onChange={(e) => setProjectUid(e.target.value)}
    className={inputClass}
  >
    {projects.map(p => (
      <option key={p.projectUid} value={p.projectUid}>{p.name}{p.isDefault ? ' (默认)' : ''}</option>
    ))}
  </select>
</div>
```

替换为：

```tsx
{/* Project */}
<div>
  <label htmlFor="project_uid" className={labelClass}>所属项目</label>
  <Combobox
    value={projectUid || null}
    onChange={(v) => setProjectUid(v ?? '')}
    options={projectOptions}
    placeholder="选择项目"
    searchPlaceholder="搜索项目"
  />
</div>
```

- [ ] **Step 4: 类型检查**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web
pnpm tsc --noEmit 2>&1 | head -10
```

Expected: 0 errors。

- [ ] **Step 5: Commit**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync
git add apps/web/src/app/tasks/create/page.tsx
git commit -m "feat(web): use Combobox for project picker on /tasks/create"
```

---

## Task 5: 替换 tasks/[task_uid] 项目下拉

**Files:**
- Modify: `apps/web/src/app/tasks/[task_uid]/page.tsx`

- [ ] **Step 1: 加 import**

文件顶部加：

```ts
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { ProjectCategoryLabel } from '@leader-sync/shared-types';
```

如未 import `useMemo`，按现有 hook import 风格加上。

- [ ] **Step 2: 加 options 派生**

在组件函数体内、紧挨着 projects 数据来源（搜 `projects` 用法），添加：

```ts
const projectOptions: ComboboxOption[] = React.useMemo(
  () => [
    { value: '', label: '无' },
    ...(projects ?? []).map((p) => ({
      value: p.projectUid,
      label: p.name,
      leadingDot: p.category ? `var(--cat-${p.category})` : 'var(--text-muted)',
      badge: p.subtitle ?? (p.isDefault ? '默认' : undefined),
      badgeVariant: (p.subtitle ? 'subtitle' : 'default') as 'subtitle' | 'default',
      trailing: [p.category && ProjectCategoryLabel[p.category], p.region].filter(Boolean).join(' · ') || undefined,
    })),
  ],
  [projects],
);
```

注意此处比 Task 4 多了一项 `{ value: '', label: '无' }`，因为详情页允许把任务从项目剥离。

- [ ] **Step 3: 替换 JSX**

找到 line ~702-719（搜 `htmlFor="edit_project"`），整段：

```tsx
<div>
  <label htmlFor="edit_project" className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">归属项目</label>
  <select
    id="edit_project"
    value={editProjectUid}
    onChange={(e) => setEditProjectUid(e.target.value)}
    className={inputClass}
  >
    <option value="">无</option>
    {projects?.map((p) => (
      <option key={p.projectUid} value={p.projectUid}>
        {p.name}{p.isDefault ? ' (默认)' : ''}
      </option>
    ))}
  </select>
</div>
```

替换为：

```tsx
<div>
  <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">归属项目</label>
  <Combobox
    value={editProjectUid || ''}
    onChange={(v) => setEditProjectUid(v ?? '')}
    options={projectOptions}
    placeholder="选择项目"
    searchPlaceholder="搜索项目"
  />
</div>
```

- [ ] **Step 4: 类型检查**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web
pnpm tsc --noEmit 2>&1 | head -10
```

Expected: 0 errors。

- [ ] **Step 5: Commit**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync
git add apps/web/src/app/tasks/\[task_uid\]/page.tsx
git commit -m "feat(web): use Combobox for project picker on task detail edit"
```

---

## Task 6: 替换 quick-add-task 项目下拉

**Files:**
- Modify: `apps/web/src/components/quick-add-task.tsx`

- [ ] **Step 1: 加 import**

```ts
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { ProjectCategoryLabel } from '@leader-sync/shared-types';
```

如未 import `useMemo`，加上。

- [ ] **Step 2: 加 options 派生**

在组件函数体内（projects 数据来源后），添加：

```ts
const projectOptions: ComboboxOption[] = React.useMemo(
  () => [
    { value: '', label: '选择项目' },
    ...projects.map((p) => ({
      value: p.projectUid,
      label: p.name,
      leadingDot: p.category ? `var(--cat-${p.category})` : 'var(--text-muted)',
      badge: p.subtitle ?? (p.isDefault ? '默认' : undefined),
      badgeVariant: (p.subtitle ? 'subtitle' : 'default') as 'subtitle' | 'default',
      trailing: [p.category && ProjectCategoryLabel[p.category], p.region].filter(Boolean).join(' · ') || undefined,
    })),
  ],
  [projects],
);
```

- [ ] **Step 3: 替换 JSX**

找到 line ~187-194（搜 `value={projectUid}`），整段：

```tsx
{/* Project */}
<select value={projectUid} onChange={(e) => setProjectUid(e.target.value)} className={inputCls}>
  <option value="">选择项目</option>
  {projects.map((p) => (
    <option key={p.projectUid} value={p.projectUid}>
      {p.name}{p.isDefault ? ' (默认)' : ''}
    </option>
  ))}
</select>
```

替换为：

```tsx
{/* Project */}
<Combobox
  value={projectUid || ''}
  onChange={(v) => setProjectUid(v ?? '')}
  options={projectOptions}
  placeholder="选择项目"
  searchPlaceholder="搜索项目"
/>
```

- [ ] **Step 4: 类型检查**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web
pnpm tsc --noEmit 2>&1 | head -10
```

Expected: 0 errors。

- [ ] **Step 5: Commit**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync
git add apps/web/src/components/quick-add-task.tsx
git commit -m "feat(web): use Combobox for project picker in quick-add-task"
```

---

## Task 7: 替换 project-modal region 下拉

**Files:**
- Modify: `apps/web/src/components/project-modal.tsx`

- [ ] **Step 1: 加 import**

文件顶部已 import `ProjectRegionList`，再加：

```ts
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
```

如未 import `useMemo`，加上。

- [ ] **Step 2: 加 region options 常量**

文件顶部（在 `EMPTY` 常量旁边）添加：

```ts
const REGION_OPTIONS: ComboboxOption[] = [
  { value: '', label: '无' },
  ...ProjectRegionList.map((r) => ({ value: r, label: r })),
];
```

- [ ] **Step 3: 替换 JSX**

找到 line ~115-125（搜 `<Field label="国家/地区">`），整段：

```tsx
<Field label="国家/地区">
  <select
    value={v.region ?? ''}
    onChange={(e) => setV((s) => ({ ...s, region: (e.target.value || null) as ProjectRegion | null }))}
    className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--accent-blue)]"
  >
    <option value="">无</option>
    {ProjectRegionList.map((r) => (
      <option key={r} value={r}>{r}</option>
    ))}
  </select>
</Field>
```

替换为：

```tsx
<Field label="国家/地区">
  <Combobox
    value={v.region ?? ''}
    onChange={(val) => setV((s) => ({ ...s, region: (val || null) as ProjectRegion | null }))}
    options={REGION_OPTIONS}
    placeholder="无"
    searchPlaceholder="搜索国家"
  />
</Field>
```

- [ ] **Step 4: 类型检查**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web
pnpm tsc --noEmit 2>&1 | head -10
```

Expected: 0 errors。

- [ ] **Step 5: Commit**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync
git add apps/web/src/components/project-modal.tsx
git commit -m "feat(web): use Combobox for region picker in project-modal"
```

---

## Task 8: 跑完整测试 + tsc 闸口

**Files:** 无新增

- [ ] **Step 1: 全 web 测试**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web
pnpm test 2>&1 | tail -15
```

Expected: 26 tests pass（含新增的 10 个 combobox 测试，原有的 8 avatar + 7 projects-page + 1 sanity）。

- [ ] **Step 2: 全 web tsc**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web
pnpm tsc --noEmit; echo "exit=$?"
```

Expected: `exit=0`。

- [ ] **Step 3: 全项目测试（顺手验证 api 还正常）**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync
pnpm --filter @leader-sync/api --filter @leader-sync/web test 2>&1 | tail -10
```

Expected: api 36 + web 26 = 62 tests pass。

- [ ] **Step 4: 如有失败，修复并重 commit**

如失败 stack trace 显示是新增的 Combobox 问题，修 `combobox.tsx`；如显示是某个 page 文件 import 问题，修对应 page。

修复后：

```bash
git add -A
git commit -m "fix(web): <具体修了啥>"
```

---

## Task 9: Playwright e2e + screenshot audit

**Files:**
- Modify: `apps/web/e2e/desktop.spec.ts`

- [ ] **Step 1: 加 2 个 screenshot 测试**

找到 e2e/desktop.spec.ts 中 `02-tasks-create` 那段（约第 16-19 行），在它之后插入：

```ts
  test('02b-tasks-create-project-combobox-open', async ({ page }) => {
    await visit(page, '/tasks/create');
    // Combobox 触发按钮是 <button>，包裹 "所属项目" 输入区域
    await page.locator('label:has-text("所属项目") + button, label:has-text("所属项目") ~ button').first().click();
    await page.waitForTimeout(300);
    await snap(page, '02b-tasks-create-project-combobox-open');
  });
```

找到 `03b-projects-create-modal` 那段，在它之后插入：

```ts
  test('03d-projects-edit-modal-region-combobox', async ({ page }) => {
    await visit(page, '/projects');
    const firstCard = page.locator('.group').first();
    await firstCard.hover();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: '编辑项目' }).first().click({ force: true });
    await page.waitForTimeout(300);
    // 点开 region 下拉
    await page.locator('label:has-text("国家/地区") ~ button').first().click();
    await page.waitForTimeout(300);
    await snap(page, '03d-projects-edit-modal-region-combobox');
  });
```

- [ ] **Step 2: 起 dev API + Web**

确保 SSH 隧道仍开（`pnpm dev:tunnel:status`），然后：

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync
# Terminal A
cd apps/api && NODE_ENV=development \
  DATABASE_URL='postgresql://leader_sync:leader_sync@localhost:5432/leader_sync_dev' \
  pnpm dev

# Terminal B
cd apps/web && pnpm dev
```

等 API "Nest application successfully started" + Web "Ready in" 后再走下一步。

- [ ] **Step 3: 跑 e2e --update-snapshots**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web
pnpm exec playwright test --project=desktop --update-snapshots --grep "02b-tasks|03d-projects"
```

Expected: 2 个 test PASS，截图生成在 `screenshots/__baseline__/desktop.spec.ts-snapshots/desktop/`。

- [ ] **Step 4: 主动 Read 两张截图，目视确认**

```bash
ls /Users/harvey/Documents/AI-APP/task-manger/leader-sync/screenshots/__baseline__/desktop.spec.ts-snapshots/desktop/02b*.png
ls /Users/harvey/Documents/AI-APP/task-manger/leader-sync/screenshots/__baseline__/desktop.spec.ts-snapshots/desktop/03d*.png
```

用 Read 工具读 PNG 文件，确认：
- 02b：项目 Combobox 打开，列表显示 21 项目（色点 + 名 + 副标签 + 国家），搜索框聚焦
- 03d：region Combobox 打开，列表显示「无 / 印度 / 印尼 / 巴基斯坦 / 孟加拉 / 深圳」6 项

- [ ] **Step 5: Commit**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync
git add apps/web/e2e/desktop.spec.ts
git commit -m "test(e2e): screenshot audit for project + region comboboxes"
```

---

## Task 10: 终局自检 + 部署准备

**Files:** 无新增

- [ ] **Step 1: 干掉本地 dev API + Web**

```bash
pkill -f "next-server\|next dev\|nest start" 2>/dev/null; sleep 1
lsof -i :3000,3001 -sTCP:LISTEN 2>&1 | tail -3 || echo "all down"
```

- [ ] **Step 2: 全项目类型检查**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web
pnpm tsc --noEmit; echo "exit=$?"
```

Expected: `exit=0`。

- [ ] **Step 3: 全项目测试**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync
pnpm --filter @leader-sync/api --filter @leader-sync/web test 2>&1 | tail -10
```

Expected: 62 tests pass。

- [ ] **Step 4: 检查 commit 历史**

```bash
cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync
git log main..HEAD --oneline
```

Expected: 9 commits（spec + cmdk dep + Combobox 实现 + 4 处替换 + e2e + 任何 fix）。

- [ ] **Step 5: 准备部署清单**

提交一份纸面 checklist（无 commit，用于本地参考或写到 PR description）：

```
[ ] 1. fast-forward merge feat → main: git checkout main && git merge --ff-only feat/project-combobox-2026-05
[ ] 2. 构建：pnpm --filter @leader-sync/web build
[ ] 3. rsync apps/web/.next → /opt/leader-sync/apps/web/.next
[ ] 4. SSH 重启 next-server（注意 SSH 分独立调用避免 pkill 杀连接）
[ ] 5. 烟雾测试：
     - HTTPS /tasks/create 200
     - HTTPS /projects 200
     - 浏览器手测：项目下拉支持搜索 ✓ 拼音 ✓ 风格一致 ✓
[ ] 6. 不变：API + DB schema 无改动，无需重启 API、无需 DB migration
```

**注：本次没动后端（API/DB），只前端，部署面比 Phase 1 小一半。**

---

## Self-Review 检查表

- ✅ **Spec coverage**：spec 12 章每章都对应任务
  - §4 组件 API → Task 2/3
  - §5 视觉规范 → Task 3 + e2e Task 9
  - §6 调用点改造 → Task 4/5/6/7
  - §7 实施步骤 → Task 1/2/3/4/5/6/7/8/9
  - §8 测试计划 → Task 2/3 单测、Task 9 截图、Task 8 整体
  - §9 风险 → Task 10 step 5 部署清单
- ✅ **Placeholder scan**：无 TBD / TODO / "implement later"
- ✅ **类型一致性**：
  - `ComboboxOption` / `ComboboxProps` 在 Task 2 定义 → Task 3-7 引用同名
  - `Combobox` 函数签名（value/onChange/options/placeholder/searchPlaceholder）一致跨 5 个 call site
  - `ProjectCategoryLabel` 来源（shared-types）所有 task 都从同一处 import
  - `value || ''` vs `value ?? ''` 跨 task 4-7 统一使用 `value || ''`（空字符串作为"无选择"）

## Notes for executor

1. **关键的环境依赖**：Task 1 后必须能 import `cmdk`，如果 pnpm install 因 lockfile 冲突失败，先 `pnpm install` 一次再 add。
2. **`React.useMemo` vs `useMemo`**：每个 page 文件可能 import 风格不同，跟随原文件风格写。
3. **`<select>` 删除别留死代码**：删 select 时连带删除 `<option>` 和任何只为 select 服务的 `useState`（一般 projectUid state 还要保留因为 Combobox 也用）。
4. **不要 ouroboros**：测试用 fireEvent + waitFor，不要用 userEvent 替代——既有 RTL 测试都用 fireEvent，保持一致。
5. **Region "无" 选项**：Task 7 的 `{ value: '', label: '无' }` 是把空字符串当作"未选"的语义标记；onChange 收到 '' 时实际上是清空 region。
