# Dashboard V2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Compress hero stats to one line, replace person/leader/project overview with expandable tree + priority quadrant grouping + inline status actions.

**Architecture:** Backend API enriched to return per-person task details. Frontend rewritten: HeroStats → compact single row, PersonTable → expandable accordion with four-quadrant task grouping, inline complete/status-change actions. Default landing page is already `/tasks` (no change needed).

**Tech Stack:** NestJS (API), Next.js 15, React 19, Tailwind CSS 4, SWR

---

### Task 1: Enrich dashboard API — add weekly stats + per-person tasks

**Files:**
- Modify: `apps/api/src/modules/dashboard/dashboard.service.ts`

**Step 1: Add `weeklyNewCount`, `weeklyDoneCount`, `riskCount` to global stats**

In the `getBossDashboard` method, after line 403 (carryOverTasks), add:

```ts
const riskTaskCount = riskTasks.length;
const weeklyNewTasks = tasks.filter((t) => t.createdAt >= thisMonday).length;
const weeklyDoneTasks = tasks.filter(
  (t) => t.status === 'done' && t.completedAt && t.completedAt >= thisMonday,
).length;
```

Update the `stats` return object (around line 427) to:
```ts
stats: {
  total: totalTasks,
  done: doneTasks,
  overdue: overdueTasks,
  carryOver: carryOverTasks,
  riskCount: riskTaskCount,
  weeklyNewCount: weeklyNewTasks,
  weeklyDoneCount: weeklyDoneTasks,
  doneRate: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
  overdueRate: totalTasks > 0 ? Math.round((overdueTasks / totalTasks) * 100) : 0,
},
```

**Step 2: Add `tasks` array to each person in `personSummary`**

In the `personMap` type (around line 282), expand to include a `tasks` array:

```ts
const personMap = new Map<
  string,
  {
    name: string;
    leaderName: string;
    total: number;
    done: number;
    overdue: number;
    riskCount: number;
    weeklyNewCount: number;
    tasks: {
      taskUid: string;
      title: string;
      status: string;
      priority: string;
      dueAt: Date | null;
      daysToDue: number | null;
      isOverdue: boolean;
      bossAttentionFlag: boolean;
      progressPercent: number;
      version: number;
    }[];
  }
>();
```

In the personMap loop (line 288-313), initialize `tasks: []` and push each task:

```ts
personMap.set(userId, {
  ...prev,  // keep existing fields
  name: prev.name || t.assigneeName || '',
  leaderName: prev.leaderName || t.leaderName || '',
  total: prev.total + 1,
  done: prev.done + (isDone ? 1 : 0),
  overdue: prev.overdue + (isOverdue ? 1 : 0),
  riskCount: prev.riskCount + (isRisk ? 1 : 0),
  weeklyNewCount: prev.weeklyNewCount + (isWeeklyNew ? 1 : 0),
  tasks: [...prev.tasks, {
    taskUid: t.taskUid,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueAt: t.dueAt,
    daysToDue: t.daysToDue,
    isOverdue: t.isOverdue && !DONE_STATUSES.includes(t.status),
    bossAttentionFlag: t.bossAttentionFlag ?? false,
    progressPercent: t.progressPercent ?? 0,
    version: t.version ?? 1,
  }],
});
```

Include `tasks` in the `personSummary` output (around line 316-328):

```ts
const personSummary = [...personMap.entries()]
  .map(([userId, data]) => ({
    userId,
    name: data.name || userId,
    leaderName: data.leaderName,
    total: data.total,
    done: data.done,
    overdue: data.overdue,
    riskCount: data.riskCount,
    weeklyNewCount: data.weeklyNewCount,
    doneRate: data.total > 0 ? Math.round((data.done / data.total) * 100) : 0,
    tasks: data.tasks,
  }))
  .sort((a, b) => b.total - a.total);
```

**Step 3: Build and verify**

Run: `cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync && pnpm build --filter=@leader-sync/api 2>&1 | tail -5`

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add apps/api/src/modules/dashboard/dashboard.service.ts
git commit -m "feat: enrich dashboard API with weekly stats and per-person task details"
```

---

### Task 2: Compress HeroStats to single row

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx` — HeroStats component (~lines 160-215)

**Step 1: Update MonthlyStats interface**

Add `weeklyDoneCount` field:
```ts
interface MonthlyStats {
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly carryOver: number;
  readonly riskCount?: number;
  readonly weeklyNewCount?: number;
  readonly weeklyDoneCount?: number;
}
```

**Step 2: Replace HeroStats with compact single row**

Delete `STAT_ACCENT_COLORS` array and the current `HeroStats` component. Replace with:

```tsx
function HeroStats({ stats, periodLabel }: { readonly stats: MonthlyStats; readonly periodLabel: string }) {
  const weeklyNew = stats.weeklyNewCount ?? 0;
  const weeklyDone = stats.weeklyDoneCount ?? 0;
  const doneRate = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  const overdueRate = stats.total > 0 ? Math.round((stats.overdue / stats.total) * 100) : 0;

  return (
    <div
      className="rounded-2xl border border-[var(--border)] px-6 py-4"
      style={{ background: 'linear-gradient(to right, var(--hero-gradient-from), var(--hero-gradient-to))' }}
    >
      <div className="flex items-center justify-between gap-6 flex-wrap">
        {/* Left: period + core stats */}
        <div className="flex items-center gap-6 flex-wrap">
          <span className="text-sm font-semibold text-[var(--hero-text)]">{periodLabel} 督办概览</span>
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue)' }} />
              <span className="tabular-nums font-semibold text-[var(--hero-text)]">{stats.total}</span>
              <span className="text-[var(--text-muted)]">总任务</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--accent-green)' }} />
              <span className="tabular-nums font-semibold text-[var(--hero-text)]">{stats.done}</span>
              <span className="text-[var(--text-muted)]">已完成</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--accent-red)' }} />
              <span className="tabular-nums font-semibold text-[var(--hero-text)]">{stats.overdue}</span>
              <span className="text-[var(--text-muted)]">延期</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="tabular-nums font-medium text-[var(--accent-green)]">{doneRate}%</span>
              <span className="text-[var(--text-muted)]">完成率</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="tabular-nums font-medium text-[var(--accent-red)]">{overdueRate}%</span>
              <span className="text-[var(--text-muted)]">延期率</span>
            </span>
          </div>
        </div>

        {/* Right: weekly stats */}
        <div className="flex items-center gap-4 text-sm">
          <span className="text-[var(--text-muted)]">本周</span>
          <span className="flex items-center gap-1.5">
            <span className="tabular-nums font-semibold text-[var(--hero-text)]">{weeklyNew}</span>
            <span className="text-[var(--text-muted)]">新增</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="tabular-nums font-semibold text-[var(--hero-text)]">{weeklyDone}</span>
            <span className="text-[var(--text-muted)]">完成</span>
          </span>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Update HeroStats usage in DashboardContent**

Update the props passed to HeroStats (around line 1168-1177) to include `weeklyDoneCount`:

```tsx
<HeroStats
  stats={{
    total: data.stats?.total ?? 0,
    done: data.stats?.done ?? 0,
    overdue: data.stats?.overdue ?? 0,
    carryOver: data.stats?.carryOver ?? 0,
    riskCount: data.stats?.riskCount ?? 0,
    weeklyNewCount: data.stats?.weeklyNewCount ?? 0,
    weeklyDoneCount: data.stats?.weeklyDoneCount ?? 0,
  }}
  periodLabel={periodLabel}
/>
```

**Step 4: Build and verify**

Run: `cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web && npx next build 2>&1 | tail -5`

**Step 5: Commit**

```bash
git add apps/web/src/app/dashboard/page.tsx
git commit -m "feat: compress HeroStats to single row with weekly stats"
```

---

### Task 3: Rewrite person overview as expandable tree with priority quadrant grouping

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx` — replace PersonTable, update LeaderCards/ProjectCards

This is the largest task. It replaces PersonTable with an expandable accordion where each person row expands to show tasks grouped by priority quadrant, with inline status actions.

**Step 1: Add priority quadrant ordering and label constants**

Near the top helpers section, add:

```tsx
const PRIORITY_QUADRANTS = [
  { key: 'urgent_important', label: '重要紧急' },
  { key: 'important_not_urgent', label: '重要不紧急' },
  { key: 'urgent_not_important', label: '紧急不重要' },
  { key: 'not_urgent_not_important', label: '不紧急不重要' },
  { key: '', label: '未分类' },
] as const;
```

**Step 2: Add PersonTaskItem interface and inline action component**

```tsx
interface PersonTaskItem {
  readonly taskUid: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly dueAt: string | null;
  readonly daysToDue: number | null;
  readonly isOverdue: boolean;
  readonly bossAttentionFlag: boolean;
  readonly progressPercent: number;
  readonly version: number;
}

function TaskInlineRow({
  task,
  onMutate,
}: {
  readonly task: PersonTaskItem;
  readonly onMutate: () => void;
}) {
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setStatusOpen(false);
      }
    }
    if (statusOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [statusOpen]);

  const showFeedback = useCallback((message: string, isError: boolean) => {
    setFeedback({ message, isError });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2000);
  }, []);

  const handleComplete = async () => {
    try {
      await apiFetch(`/api/v1/tasks/${task.taskUid}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'done', version: task.version }),
      });
      showFeedback('已完成', false);
      onMutate();
    } catch (err) {
      const msg = err instanceof ApiError && err.code === 409 ? '版本冲突' : '操作失败';
      showFeedback(msg, true);
      if (err instanceof ApiError && err.code === 409) onMutate();
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      await apiFetch(`/api/v1/tasks/${task.taskUid}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus, version: task.version }),
      });
      showFeedback('已更新', false);
      setStatusOpen(false);
      onMutate();
    } catch (err) {
      const msg = err instanceof ApiError && err.code === 409 ? '版本冲突' : '更新失败';
      showFeedback(msg, true);
      if (err instanceof ApiError && err.code === 409) onMutate();
    }
  };

  const dueStr = task.dueAt ? new Date(task.dueAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '';
  const overdueText = task.isOverdue && task.daysToDue != null && task.daysToDue < 0
    ? `延期${Math.abs(task.daysToDue)}天`
    : '';

  return (
    <div className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--bg-hover)] transition-colors duration-150">
      {/* Title + badges */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {task.bossAttentionFlag && (
          <span className="shrink-0 text-[10px] text-[var(--accent-orange)]">★</span>
        )}
        <a
          href={`/tasks/${task.taskUid}`}
          className="truncate text-sm text-[var(--text-primary)] hover:text-[var(--accent-blue)] hover:underline"
        >
          {task.title}
        </a>
        <StatusBadge status={task.status} />
        {overdueText && (
          <span className="shrink-0 text-xs font-medium text-[var(--accent-red)]">{overdueText}</span>
        )}
      </div>

      {/* Due date */}
      {dueStr && (
        <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">{dueStr}</span>
      )}

      {/* Action: complete + dropdown */}
      <div ref={statusRef} className="relative flex items-center gap-1 shrink-0">
        <button
          onClick={handleComplete}
          className="rounded border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent-green)] hover:bg-[var(--accent-green)]/20 transition-colors"
        >
          完成
        </button>
        <button
          onClick={() => setStatusOpen(!statusOpen)}
          className="rounded border border-[var(--border)] bg-[var(--bg-surface)] px-1 py-0.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          ▼
        </button>
        {statusOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-lg bg-[var(--bg-card)] border border-[var(--border)] shadow-lg py-1">
            {STATUS_OPTIONS.filter((o) => o.value !== task.status).map((o) => (
              <button
                key={o.value}
                onClick={() => handleStatusChange(o.value)}
                className="block w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        {feedback && (
          <span className={`ml-1 text-xs font-medium animate-pulse ${feedback.isError ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}`}>
            {feedback.message}
          </span>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Create PersonAccordion component**

This replaces the old PersonTable:

```tsx
interface PersonWithTasks extends PersonSummary {
  readonly tasks?: readonly PersonTaskItem[];
}

function PersonAccordion({
  persons,
  onMutate,
}: {
  readonly persons: readonly PersonWithTasks[];
  readonly onMutate: () => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  if (persons.length === 0) {
    return <p className="py-12 text-center text-[var(--text-muted)]">暂无人员数据</p>;
  }

  const sorted = [...persons].sort((a, b) => b.doneRate - a.doneRate);

  const togglePerson = (userId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-[var(--bg-card)] border border-[var(--border)]">
      {sorted.map((person) => {
        const expanded = expandedIds.has(person.userId);
        const tasks = person.tasks ?? [];

        // Group tasks by priority quadrant
        const grouped = new Map<string, PersonTaskItem[]>();
        for (const t of tasks) {
          const key = t.priority || '';
          const existing = grouped.get(key) ?? [];
          grouped.set(key, [...existing, t]);
        }

        return (
          <div key={person.userId} className="border-b border-[var(--border)] last:border-b-0">
            {/* Person header row */}
            <div
              onClick={() => togglePerson(person.userId)}
              className="flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors duration-150"
            >
              <span className="text-xs text-[var(--text-muted)]">{expanded ? '▼' : '▶'}</span>
              <span className="font-medium text-[var(--text-primary)] w-20 shrink-0 truncate">{person.name}</span>
              <div className="flex items-center gap-3 text-xs tabular-nums flex-wrap">
                <span className="text-[var(--text-secondary)]">总 {person.total}</span>
                <span className="text-[var(--accent-green)]">完成 {person.done}</span>
                <span className={person.overdue > 0 ? 'font-semibold text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}>
                  延期 {person.overdue}
                </span>
                <span className={person.riskCount > 0 ? 'text-[var(--accent-orange)]' : 'text-[var(--text-secondary)]'}>
                  风险 {person.riskCount}
                </span>
                <span className="text-[var(--text-secondary)]">新增 {person.weeklyNewCount}</span>
              </div>
              <div className="ml-auto flex items-center gap-2 w-36 shrink-0">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-surface)]">
                  <div
                    className="h-full rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${Math.min(person.doneRate, 100)}%`,
                      backgroundColor: rateColor(person.doneRate),
                    }}
                  />
                </div>
                <span className="tabular-nums text-xs font-medium text-[var(--text-primary)] w-10 text-right">{person.doneRate}%</span>
              </div>
            </div>

            {/* Expanded: tasks grouped by priority quadrant */}
            {expanded && tasks.length > 0 && (
              <div className="border-t border-[var(--border)] bg-[var(--bg-page)]">
                {PRIORITY_QUADRANTS.map(({ key, label }) => {
                  const quadrantTasks = grouped.get(key);
                  if (!quadrantTasks || quadrantTasks.length === 0) return null;
                  return (
                    <div key={key || 'none'}>
                      <div className="px-5 py-2 text-xs font-medium text-[var(--text-muted)] bg-[var(--bg-surface)]">
                        {label} ({quadrantTasks.length})
                      </div>
                      {quadrantTasks.map((t) => (
                        <TaskInlineRow key={t.taskUid} task={t} onMutate={onMutate} />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {expanded && tasks.length === 0 && (
              <div className="border-t border-[var(--border)] px-5 py-3">
                <span className="text-xs text-[var(--text-muted)]">暂无任务</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

**Step 4: Delete old PersonTable and rateColor (keep rateColor, delete PersonTable)**

Delete the old `PersonTable` component. Keep `rateColor` helper.

**Step 5: Update DashboardContent render**

Replace `<PersonTable persons={data.personSummary ?? []} />` with:
```tsx
<PersonAccordion persons={data.personSummary ?? []} onMutate={handleMutate} />
```

Also update the `groupMode === 'leader'` branch. The existing `LeaderCard` already has expandable members, but now each member also needs tasks. For now, keep `LeaderCards` as-is — the priority is the person view. The leader/project views can be enhanced in a follow-up.

**Step 6: Build and verify**

Run: `cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web && npx next build 2>&1 | tail -5`

**Step 7: Commit**

```bash
git add apps/web/src/app/dashboard/page.tsx
git commit -m "feat: expandable person tree with priority quadrant grouping and inline actions"
```

---

### Task 4: Final build + push

**Step 1: Full build verification**

Run: `cd /Users/harvey/Documents/AI-APP/task-manger/leader-sync/apps/web && npx next build 2>&1 | tail -15`

**Step 2: Push**

Run: `git push ai-coding-lab main`
