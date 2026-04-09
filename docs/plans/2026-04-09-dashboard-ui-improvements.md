# Dashboard UI Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve dashboard usability: simplified period selector, ranked person table, combobox person filter with pinyin, and light mode visual fixes.

**Architecture:** All changes are frontend-only in the Next.js web app. CSS variables drive theming. A new `tiny-pinyin` dependency enables Chinese pinyin search. No API changes needed.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 4, SWR, tiny-pinyin

---

### Task 1: Install tiny-pinyin dependency

**Files:**
- Modify: `apps/web/package.json`

**Step 1: Install the package**

Run: `cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync && pnpm add tiny-pinyin --filter=@leader-sync/web`

Expected: `tiny-pinyin` added to `apps/web/package.json` dependencies.

**Step 2: Verify import works**

Run: `cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web && node -e "const p = require('tiny-pinyin'); console.log(p.isSupported())"`

Expected: `true`

**Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore: add tiny-pinyin dependency for person search"
```

---

### Task 2: Add CSS variables for light mode fixes

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Step 1: Add new variables to both themes**

In `globals.css`, add the following variables to `:root` (dark) and `[data-theme="light"]`:

Dark (`:root`):
```css
  --border-strong: #3a3a4a;
  --hero-gradient-from: #12121a;
  --hero-gradient-to: #1a1a2e;
  --hero-card-bg: rgba(10, 10, 15, 0.6);
  --hero-text: #ffffff;
  --badge-alpha: 0.1;
```

Light (`[data-theme="light"]`):
```css
  --border-strong: #d1d5db;
  --hero-gradient-from: #eff6ff;
  --hero-gradient-to: #f0f9ff;
  --hero-card-bg: rgba(255, 255, 255, 0.8);
  --hero-text: #111827;
  --badge-alpha: 0.15;
```

**Step 2: Verify CSS parses**

Run: `cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web && npx next build 2>&1 | tail -5`

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "feat: add CSS variables for light mode theme support"
```

---

### Task 3: Rewrite PeriodSelector — tab + dropdown

**Files:**
- Modify: `apps/web/src/hooks/use-dashboard.ts:6` — remove `'year'` from type
- Modify: `apps/web/src/hooks/use-gantt.ts:8` — remove `year` branch
- Modify: `apps/web/src/app/dashboard/page.tsx:19-157` — rewrite PeriodSelector and helpers

**Step 1: Update `DashboardPeriod` type in `use-dashboard.ts`**

Change line 6 from:
```ts
readonly mode: 'month' | 'quarter' | 'year';
```
to:
```ts
readonly mode: 'month' | 'quarter';
```

Remove the `year` branch from the `useDashboard` function (line 12):
```ts
// Before:
if (period.mode === 'year') params = `?year=${period.value}`;
else if (period.mode === 'quarter') params = `?quarter=${period.value}`;
else params = `?month=${period.value}`;

// After:
if (period.mode === 'quarter') params = `?quarter=${period.value}`;
else params = `?month=${period.value}`;
```

**Step 2: Update `use-gantt.ts`**

Same removal of `year` branch (line 8):
```ts
// Before:
if (period.mode === 'year') params = `?year=${period.value}`;
else if (period.mode === 'quarter') params = `?quarter=${period.value}`;
else params = `?month=${period.value}`;

// After:
if (period.mode === 'quarter') params = `?quarter=${period.value}`;
else params = `?month=${period.value}`;
```

**Step 3: Rewrite PeriodSelector and helpers in `dashboard/page.tsx`**

Remove functions: `buildMonthOptions`, `buildQuarterOptions`, `buildYearOption`, `getCurrentQuarter`.

Remove type alias `PeriodMode` and constant `MODE_LABELS`.

Replace the entire `PeriodSelector` component (lines ~64-157) with:

```tsx
type PeriodMode = 'month' | 'quarter';

function formatMonth(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function getCurrentQuarter(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}

function buildMonthDropdownOptions(): readonly { label: string; value: string }[] {
  const year = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, i) => ({
    label: `${year}年${i + 1}月`,
    value: `${year}-${String(i + 1).padStart(2, '0')}`,
  }));
}

function buildQuarterDropdownOptions(): readonly { label: string; value: string }[] {
  const year = new Date().getFullYear();
  return [
    { label: `${year}年 Q1`, value: `${year}-Q1` },
    { label: `${year}年 Q2`, value: `${year}-Q2` },
    { label: `${year}年 Q3`, value: `${year}-Q3` },
    { label: `${year}年 Q4`, value: `${year}-Q4` },
  ];
}

function PeriodSelector({
  period,
  onChange,
}: {
  readonly period: DashboardPeriod;
  readonly onChange: (p: DashboardPeriod) => void;
}) {
  const modes: readonly { mode: PeriodMode; label: string }[] = [
    { mode: 'month', label: '月' },
    { mode: 'quarter', label: '季' },
  ];

  const options = period.mode === 'month'
    ? buildMonthDropdownOptions()
    : buildQuarterDropdownOptions();

  const handleModeChange = (mode: PeriodMode) => {
    if (mode === period.mode) return;
    if (mode === 'month') {
      onChange({ mode: 'month', value: formatMonth(new Date()) });
    } else {
      onChange({ mode: 'quarter', value: getCurrentQuarter() });
    }
  };

  return (
    <div className="flex items-center gap-4">
      {/* Mode tab pills */}
      <div className="flex items-center gap-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] p-1">
        {modes.map((m) => (
          <button
            key={m.mode}
            onClick={() => handleModeChange(m.mode)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
              period.mode === m.mode
                ? 'bg-[var(--accent-blue)] text-white shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Dropdown select */}
      <select
        value={period.value}
        onChange={(e) => onChange({ mode: period.mode, value: e.target.value })}
        className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)] transition-colors duration-150 cursor-pointer appearance-none bg-[length:16px] bg-no-repeat bg-[position:right_8px_center] pr-8"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
```

Also update `getPeriodDisplayLabel` to remove the `year` branch:
```ts
function getPeriodDisplayLabel(period: DashboardPeriod): string {
  if (period.mode === 'month') {
    const parts = period.value.split('-');
    if (parts.length === 2) return `${parseInt(parts[1], 10)}月`;
    return period.value;
  }
  // quarter
  const parts = period.value.split('-');
  return parts.length === 2 ? parts[1] : period.value;
}
```

**Step 4: Build and verify**

Run: `cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web && npx next build 2>&1 | tail -5`

Expected: Build succeeds with no type errors.

**Step 5: Commit**

```bash
git add apps/web/src/hooks/use-dashboard.ts apps/web/src/hooks/use-gantt.ts apps/web/src/app/dashboard/page.tsx
git commit -m "feat: simplify period selector to month/quarter tabs with dropdown"
```

---

### Task 4: Replace PersonCards with PersonTable

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx:692-771` — replace PersonCard/PersonCards

**Step 1: Replace `PersonCard` and `PersonCards` components**

Delete `PersonCard` (lines ~706-756) and `PersonCards` (lines ~759-771). Replace with:

```tsx
function rateColor(rate: number): string {
  if (rate >= 80) return 'var(--accent-green)';
  if (rate >= 50) return 'var(--accent-blue)';
  return 'var(--accent-red)';
}

function PersonTable({ persons }: { readonly persons: readonly PersonSummary[] }) {
  if (persons.length === 0) {
    return <p className="py-12 text-center text-[var(--text-muted)]">暂无人员数据</p>;
  }

  const sorted = [...persons].sort((a, b) => b.doneRate - a.doneRate);

  return (
    <div className="overflow-hidden rounded-2xl bg-[var(--bg-card)] border border-[var(--border)]">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-[var(--bg-surface)]">
              <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)]">姓名</th>
              <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)]">Leader</th>
              <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)] text-right">总任务</th>
              <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)] text-right">完成</th>
              <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)] text-right">延期</th>
              <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)] text-right">风险</th>
              <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)] text-right">新增</th>
              <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)] w-48">完成率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {sorted.map((p) => (
              <tr key={p.userId} className="transition-colors duration-150 hover:bg-[var(--bg-hover)]">
                <td className="whitespace-nowrap px-5 py-3 font-medium text-[var(--text-primary)]">{p.name}</td>
                <td className="whitespace-nowrap px-5 py-3 text-[var(--text-secondary)]">{p.leaderName || '-'}</td>
                <td className="whitespace-nowrap px-5 py-3 tabular-nums text-[var(--text-primary)] text-right">{p.total}</td>
                <td className="whitespace-nowrap px-5 py-3 tabular-nums text-[var(--text-primary)] text-right">{p.done}</td>
                <td className="whitespace-nowrap px-5 py-3 tabular-nums text-right">
                  {p.overdue > 0 ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-[var(--accent-red)] px-2 py-0.5 text-xs font-medium text-white min-w-[24px]">{p.overdue}</span>
                  ) : (
                    <span className="text-[var(--text-secondary)]">0</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-5 py-3 tabular-nums text-right">
                  {p.riskCount > 0 ? (
                    <span className="inline-flex items-center justify-center rounded-full bg-[var(--accent-orange)] px-2 py-0.5 text-xs font-medium text-white min-w-[24px]">{p.riskCount}</span>
                  ) : (
                    <span className="text-[var(--text-secondary)]">0</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-5 py-3 tabular-nums text-[var(--text-secondary)] text-right">{p.weeklyNewCount}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-surface)]">
                      <div
                        className="h-full rounded-full transition-all duration-500 ease-out"
                        style={{
                          width: `${Math.min(p.doneRate, 100)}%`,
                          backgroundColor: rateColor(p.doneRate),
                        }}
                      />
                    </div>
                    <span className="tabular-nums text-xs font-medium text-[var(--text-primary)] w-10 text-right">{p.doneRate}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 2: Update usage in DashboardContent**

In the render section (~line 1186), replace:
```tsx
<PersonCards persons={data.personSummary ?? []} />
```
with:
```tsx
<PersonTable persons={data.personSummary ?? []} />
```

**Step 3: Build and verify**

Run: `cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web && npx next build 2>&1 | tail -5`

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add apps/web/src/app/dashboard/page.tsx
git commit -m "feat: replace person cards with ranked table view"
```

---

### Task 5: Rewrite FilterBar with combobox + pinyin search

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx:298-395` — rewrite FilterBar

**Step 1: Add pinyin import at top of file**

Add after existing imports:
```ts
import TinyPinyin from 'tiny-pinyin';
```

**Step 2: Add pinyin match helper**

Add near the helpers section at top:
```ts
/** Check if a person name matches the query (Chinese or pinyin initials) */
function matchesPersonQuery(name: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  // Direct Chinese match
  if (name.toLowerCase().includes(q)) return true;
  // Pinyin initials match
  if (TinyPinyin.isSupported()) {
    const initials = TinyPinyin.convertToPinyin(name, '', { toneType: 'none' }).toLowerCase();
    if (initials.includes(q)) return true;
    // First letter of each character
    const firstLetters = name
      .split('')
      .map((ch) => {
        const py = TinyPinyin.convertToPinyin(ch, '', { toneType: 'none' });
        return py ? py[0] : ch;
      })
      .join('')
      .toLowerCase();
    if (firstLetters.includes(q)) return true;
  }
  return false;
}
```

**Step 3: Replace `FilterBar` component**

Replace the entire FilterBar (lines ~298-395) with:

```tsx
function FilterBar({
  persons,
  selectedPersons,
  onPersonsChange,
  taskTitle,
  onTaskTitleChange,
}: {
  readonly persons: readonly string[];
  readonly selectedPersons: readonly string[];
  readonly onPersonsChange: (p: string[]) => void;
  readonly taskTitle: string;
  readonly onTaskTitleChange: (v: string) => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [personQuery, setPersonQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setPersonQuery('');
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Auto-focus search input when dropdown opens
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const filteredPersons = useMemo(
    () => persons.filter((name) => matchesPersonQuery(name, personQuery)),
    [persons, personQuery],
  );

  const togglePerson = (name: string) => {
    const next = selectedPersons.includes(name)
      ? selectedPersons.filter((p) => p !== name)
      : [...selectedPersons, name];
    onPersonsChange(next);
  };

  // Button label: show up to 2 names + "+N"
  const buttonLabel = useMemo(() => {
    if (selectedPersons.length === 0) return '全部人员';
    const shown = selectedPersons.slice(0, 2).join(', ');
    const remaining = selectedPersons.length - 2;
    return remaining > 0 ? `${shown} +${remaining}` : shown;
  }, [selectedPersons]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {/* Person combobox */}
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors duration-150"
        >
          <span className="max-w-[200px] truncate">{buttonLabel}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-[var(--text-muted)]">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {dropdownOpen && (
          <div className="absolute z-50 mt-1 w-[240px] rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-lg overflow-hidden">
            {/* Search input */}
            <div className="p-2 border-b border-[var(--border)]">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="搜索人员..."
                value={personQuery}
                onChange={(e) => setPersonQuery(e.target.value)}
                className="w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)] transition-colors duration-150"
              />
            </div>
            {/* Person list */}
            <div className="max-h-[240px] overflow-y-auto py-1">
              {filteredPersons.map((name) => {
                const selected = selectedPersons.includes(name);
                return (
                  <button
                    key={name}
                    onClick={() => togglePerson(name)}
                    className={`flex items-center gap-2 w-full text-left hover:bg-[var(--bg-hover)] px-3 py-2 text-sm transition-colors duration-150 ${
                      selected ? 'text-[var(--accent-blue)]' : 'text-[var(--text-primary)]'
                    }`}
                  >
                    <span className={`inline-flex items-center justify-center w-4 h-4 rounded border text-[10px] shrink-0 ${
                      selected
                        ? 'bg-[var(--accent-blue)] border-[var(--accent-blue)] text-white'
                        : 'border-[var(--text-muted)] text-transparent'
                    }`}>
                      ✓
                    </span>
                    {name}
                  </button>
                );
              })}
              {filteredPersons.length === 0 && (
                <p className="px-3 py-2 text-xs text-[var(--text-muted)]">无匹配人员</p>
              )}
            </div>
            {/* Footer: select all / clear */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-[var(--border)] text-xs">
              <button
                onClick={() => onPersonsChange([...persons])}
                className="text-[var(--accent-blue)] hover:underline"
              >
                全选
              </button>
              <button
                onClick={() => onPersonsChange([])}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                清除
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Task title search */}
      <input
        type="text"
        placeholder="搜索任务标题..."
        value={taskTitle}
        onChange={(e) => onTaskTitleChange(e.target.value)}
        className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] w-60 focus:outline-none focus:border-[var(--accent-blue)] transition-colors duration-150"
      />

      {/* Clear button */}
      {(selectedPersons.length > 0 || taskTitle) && (
        <button
          onClick={() => { onPersonsChange([]); onTaskTitleChange(''); }}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-150"
        >
          清除筛选
        </button>
      )}
    </div>
  );
}
```

**Step 4: Build and verify**

Run: `cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web && npx next build 2>&1 | tail -5`

Expected: Build succeeds.

**Step 5: Commit**

```bash
git add apps/web/src/app/dashboard/page.tsx
git commit -m "feat: add person combobox with pinyin search support"
```

---

### Task 6: Light mode — HeroStats theme adaptation

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx:203-227` — HeroStats component

**Step 1: Update HeroStats to use CSS variables**

Replace the HeroStats return JSX (lines ~203-226) with:

```tsx
return (
  <div
    className="relative overflow-hidden rounded-2xl border border-[var(--border)] px-8 py-10 sm:px-10"
    style={{
      background: `linear-gradient(to bottom right, var(--hero-gradient-from), var(--hero-gradient-to))`,
    }}
  >
    <div className="relative z-10">
      <p className="mb-1 text-sm font-medium tracking-wide text-[var(--text-muted)]">督办概览</p>
      <h2 className="mb-8 text-3xl font-bold tracking-tight text-[var(--hero-text)]">
        {periodLabel} 督办概览
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-[var(--border)] p-4"
            style={{ backgroundColor: 'var(--hero-card-bg)' }}
          >
            <div className="h-1 w-8 rounded-full mb-3" style={{ backgroundColor: c.accent }} />
            <p className="tabular-nums text-3xl font-bold text-[var(--hero-text)]">{c.value}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
    {/* Decorative gradient orb */}
    <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[var(--accent-blue)]/5 blur-3xl" />
  </div>
);
```

**Step 2: Update accent colors in STAT_ACCENT_COLORS**

Replace the hardcoded hex values:
```tsx
const STAT_ACCENT_COLORS = [
  'var(--accent-blue)',    // total
  'var(--accent-green)',   // done
  'var(--accent-red)',     // overdue
  'var(--accent-orange)',  // risk
  '#8b5cf6',              // purple - carry over (keep, no variable)
  'var(--accent-blue)',    // weekly new
  'var(--accent-green)',   // done rate
  'var(--accent-red)',     // overdue rate
] as const;
```

**Step 3: Build and verify**

Run: `cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web && npx next build 2>&1 | tail -5`

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add apps/web/src/app/dashboard/page.tsx
git commit -m "feat: adapt HeroStats for light mode with CSS variables"
```

---

### Task 7: Light mode — accent color variable replacement + dropdown fix

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx` — global accent color replacements
- Modify: `apps/web/src/components/gantt-chart.tsx` — accent colors + grid lines

**Step 1: In `dashboard/page.tsx`, replace hardcoded accent colors**

Use find-and-replace across the file:
- `bg-[#3b82f6]` → `bg-[var(--accent-blue)]` (pill selected states, etc.)
- `text-[#3b82f6]` → `text-[var(--accent-blue)]`
- `bg-[#3b82f6]/20` → `bg-[var(--accent-blue)]/20`
- `border-[#3b82f6]` → `border-[var(--accent-blue)]`
- `text-[#22c55e]` → `text-[var(--accent-green)]`
- `bg-[#22c55e]` → `bg-[var(--accent-green)]`
- `text-[#ef4444]` → `text-[var(--accent-red)]`
- `bg-[#ef4444]` → `bg-[var(--accent-red)]`
- `text-[#f59e0b]` → `text-[var(--accent-orange)]`
- `bg-[#f59e0b]` → `bg-[var(--accent-orange)]`
- `border-[#f59e0b]` → `border-[var(--accent-orange)]`

Note: Keep `#8b5cf6` (purple) and `#06b6d4` (cyan) as-is — no variable for them.

Also fix `InlineDropdown` panel: change `bg-[var(--bg-surface)]` to `bg-[var(--bg-card)] shadow-lg`.

Also fix `RiskReasonTags` badge transparency: replace `/10` with a dynamic approach. Update `RISK_REASON_STYLES` to use CSS variable colors:
```tsx
const RISK_REASON_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  '延期': { bg: 'bg-[var(--accent-red)]/[var(--badge-alpha)]', text: 'text-[var(--accent-red)]', border: 'border-[var(--accent-red)]/20' },
  // ... etc
};
```

Note: Tailwind v4 may not support CSS variable in opacity slot. If that doesn't work, use inline styles instead:
```tsx
const RISK_REASON_STYLES: Record<string, { color: string; label: string }> = {
  '延期': { color: 'var(--accent-red)', label: '延期' },
  '继承': { color: 'var(--accent-orange)', label: '继承' },
  '停滞': { color: '#8b5cf6', label: '停滞' },
  '临期': { color: '#eab308', label: '临期' },
  '重点无进度': { color: 'var(--accent-blue)', label: '重点无进度' },
};
```
And render with inline `style={{ backgroundColor: `color-mix(in srgb, ${style.color} calc(var(--badge-alpha) * 100%), transparent)` }}`. Simpler: just use the Tailwind classes and accept slightly different opacity. The safest approach is:

```tsx
function RiskReasonTags({ reasons }: { readonly reasons: readonly string[] }) {
  if (reasons.length === 0) return null;

  const styleMap: Record<string, { bg: string; text: string; border: string }> = {
    '延期': { bg: 'bg-[var(--accent-red)]/10 dark:bg-[var(--accent-red)]/10', text: 'text-[var(--accent-red)]', border: 'border-[var(--accent-red)]/20' },
    '继承': { bg: 'bg-[var(--accent-orange)]/10', text: 'text-[var(--accent-orange)]', border: 'border-[var(--accent-orange)]/20' },
    '停滞': { bg: 'bg-[#8b5cf6]/10', text: 'text-[#8b5cf6]', border: 'border-[#8b5cf6]/20' },
    '临期': { bg: 'bg-[#eab308]/10', text: 'text-[#eab308]', border: 'border-[#eab308]/20' },
    '重点无进度': { bg: 'bg-[var(--accent-blue)]/10', text: 'text-[var(--accent-blue)]', border: 'border-[var(--accent-blue)]/20' },
  };

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reasons.map((r) => {
        const style = styleMap[r] || { bg: 'bg-[var(--text-muted)]/10', text: 'text-[var(--text-muted)]', border: 'border-[var(--text-muted)]/20' };
        return (
          <span
            key={r}
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border ${style.bg} ${style.text} ${style.border}`}
          >
            {r}
          </span>
        );
      })}
    </div>
  );
}
```

**Step 2: In `gantt-chart.tsx`, replace grid line color and accent colors**

Replace all gantt grid line classes:
- `bg-[var(--bg-surface)]` on grid line divs → `bg-[var(--border-strong)]`

Replace accent color hardcodes in `getBarColor`:
```tsx
function getBarColor(status: string, isOverdue: boolean): string {
  if (isOverdue) return 'bg-[var(--accent-red)]';
  switch (status) {
    case 'done':
      return 'bg-[var(--accent-green)]';
    case 'in_progress':
      return 'bg-[var(--accent-blue)]';
    case 'stalled':
      return 'bg-[var(--accent-red)]';
    case 'pending':
    case 'not_started':
      return 'bg-[#5a5a6e]';
    default:
      return 'bg-[#5a5a6e]';
  }
}
```

Replace today line border color:
- `border-[#ef4444]` → `border-[var(--accent-red)]`

Replace tooltip accent colors if any.

**Step 3: Build and verify**

Run: `cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web && npx next build 2>&1 | tail -5`

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add apps/web/src/app/dashboard/page.tsx apps/web/src/components/gantt-chart.tsx
git commit -m "feat: replace hardcoded colors with CSS variables for light mode"
```

---

### Task 8: Final build verification

**Step 1: Full build**

Run: `cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web && npx next build 2>&1 | tail -15`

Expected: Build succeeds, no warnings.

**Step 2: Verify no remaining hardcoded accent colors**

Run: `grep -rn '#3b82f6\|#22c55e\|#ef4444\|#f59e0b' apps/web/src/app/dashboard/page.tsx apps/web/src/components/gantt-chart.tsx`

Expected: Only `#8b5cf6`, `#06b6d4`, `#eab308`, `#5a5a6e` should remain (colors without CSS variables).
