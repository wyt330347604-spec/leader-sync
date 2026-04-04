'use client';
import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useDashboard } from '@/hooks/use-dashboard';
import { useGantt } from '@/hooks/use-gantt';
import type { DashboardPeriod } from '@/hooks/use-dashboard';
import { ensureAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api-client';
import { TaskStatusLabel, PriorityLabel } from '@leader-sync/shared-types';
import { GanttChart } from '@/components/gantt-chart';

/* ---------- helpers ---------- */

function formatMonth(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function buildMonthOptions(): readonly { label: string; value: string }[] {
  const now = new Date();
  const options: { label: string; value: string }[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = formatMonth(d);
    options.push({ label: `${d.getMonth() + 1}月`, value });
  }
  return options;
}

function buildQuarterOptions(): readonly { label: string; value: string }[] {
  const year = new Date().getFullYear();
  return [
    { label: 'Q1', value: `${year}-Q1` },
    { label: 'Q2', value: `${year}-Q2` },
    { label: 'Q3', value: `${year}-Q3` },
    { label: 'Q4', value: `${year}-Q4` },
  ];
}

function buildYearOption(): { label: string; value: string } {
  const year = new Date().getFullYear();
  return { label: `${year}年`, value: String(year) };
}

function getCurrentQuarter(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}

function getPeriodDisplayLabel(period: DashboardPeriod): string {
  if (period.mode === 'month') {
    const parts = period.value.split('-');
    if (parts.length === 2) return `${parseInt(parts[1], 10)}月`;
    return period.value;
  }
  if (period.mode === 'quarter') {
    const parts = period.value.split('-');
    return parts.length === 2 ? parts[1] : period.value;
  }
  return `${period.value}年`;
}

/* ---------- Section A: Period Selector ---------- */

type PeriodMode = 'month' | 'quarter' | 'year';

const MODE_LABELS: readonly { mode: PeriodMode; label: string }[] = [
  { mode: 'month', label: '月' },
  { mode: 'quarter', label: '季' },
  { mode: 'year', label: '年' },
];

function PeriodSelector({
  period,
  onChange,
}: {
  readonly period: DashboardPeriod;
  readonly onChange: (p: DashboardPeriod) => void;
}) {
  const monthOptions = buildMonthOptions();
  const quarterOptions = buildQuarterOptions();
  const yearOption = buildYearOption();

  const handleModeChange = (mode: PeriodMode) => {
    if (mode === period.mode) return;
    if (mode === 'month') {
      onChange({ mode: 'month', value: formatMonth(new Date()) });
    } else if (mode === 'quarter') {
      onChange({ mode: 'quarter', value: getCurrentQuarter() });
    } else {
      onChange({ mode: 'year', value: String(new Date().getFullYear()) });
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      {/* Mode switcher pills */}
      <div className="flex items-center gap-1 rounded-lg bg-[#1e1e2e] border border-[#2a2a3a] p-1">
        {MODE_LABELS.map((m) => (
          <button
            key={m.mode}
            onClick={() => handleModeChange(m.mode)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
              period.mode === m.mode
                ? 'bg-[#3b82f6] text-white shadow-sm'
                : 'text-[#8b8b9e] hover:text-[#e4e4e7] hover:bg-[#2a2a3a]'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Period-specific options */}
      <div className="flex items-center gap-2">
        {period.mode === 'month' &&
          monthOptions.map((o) => (
            <button
              key={o.value}
              onClick={() => onChange({ mode: 'month', value: o.value })}
              className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ease-out ${
                period.value === o.value
                  ? 'bg-[#3b82f6] text-white'
                  : 'bg-[#1e1e2e] text-[#8b8b9e] border border-[#2a2a3a] hover:bg-[#1a1a2e] hover:text-[#e4e4e7]'
              }`}
            >
              {o.label}
            </button>
          ))}

        {period.mode === 'quarter' &&
          quarterOptions.map((o) => (
            <button
              key={o.value}
              onClick={() => onChange({ mode: 'quarter', value: o.value })}
              className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 ease-out ${
                period.value === o.value
                  ? 'bg-[#3b82f6] text-white'
                  : 'bg-[#1e1e2e] text-[#8b8b9e] border border-[#2a2a3a] hover:bg-[#1a1a2e] hover:text-[#e4e4e7]'
              }`}
            >
              {o.label}
            </button>
          ))}

        {period.mode === 'year' && (
          <button
            className="rounded-full px-5 py-2 text-sm font-medium bg-[#3b82f6] text-white"
          >
            {yearOption.label}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Section B: Hero stats ---------- */

interface MonthlyStats {
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly carryOver: number;
  readonly riskCount?: number;
  readonly weeklyNewCount?: number;
}

function pct(part: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

const STAT_ACCENT_COLORS = [
  '#3b82f6', // blue - total
  '#22c55e', // green - done
  '#ef4444', // red - overdue
  '#f59e0b', // orange - risk
  '#8b5cf6', // purple - carry over
  '#3b82f6', // blue - weekly new
  '#22c55e', // green - done rate
  '#ef4444', // red - overdue rate
] as const;

function HeroStats({ stats, periodLabel }: { readonly stats: MonthlyStats; readonly periodLabel: string }) {
  const riskCount = stats.riskCount ?? 0;
  const weeklyNew = stats.weeklyNewCount ?? 0;
  const doneRate = pct(stats.done, stats.total);
  const overdueRate = pct(stats.overdue, stats.total);

  const cards = [
    { label: '总任务', value: stats.total, accent: STAT_ACCENT_COLORS[0] },
    { label: '已完成', value: stats.done, accent: STAT_ACCENT_COLORS[1] },
    { label: '已延期', value: stats.overdue, accent: STAT_ACCENT_COLORS[2] },
    { label: '风险任务', value: riskCount, accent: STAT_ACCENT_COLORS[3] },
    { label: '继承任务', value: stats.carryOver, accent: STAT_ACCENT_COLORS[4] },
    { label: '本周新增', value: weeklyNew, accent: STAT_ACCENT_COLORS[5] },
    { label: '完成率', value: doneRate, accent: STAT_ACCENT_COLORS[6] },
    { label: '延期率', value: overdueRate, accent: STAT_ACCENT_COLORS[7] },
  ] as const;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#12121a] to-[#1a1a2e] border border-[#2a2a3a] px-8 py-10 sm:px-10">
      <div className="relative z-10">
        <p className="mb-1 text-sm font-medium tracking-wide text-[#5a5a6e]">督办概览</p>
        <h2 className="mb-8 text-3xl font-bold tracking-tight text-white">
          {periodLabel} 督办概览
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {cards.map((c) => (
            <div
              key={c.label}
              className="rounded-xl bg-[#0a0a0f]/60 border border-[#2a2a3a] p-4"
            >
              <div className="h-1 w-8 rounded-full mb-3" style={{ backgroundColor: c.accent }} />
              <p className="tabular-nums text-3xl font-bold text-white">{c.value}</p>
              <p className="mt-1 text-xs text-[#5a5a6e]">{c.label}</p>
            </div>
          ))}
        </div>
      </div>
      {/* Decorative gradient orb */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[#3b82f6]/5 blur-3xl" />
    </div>
  );
}

/* ---------- Inline feedback ---------- */

function InlineFeedback({ message, isError }: { readonly message: string; readonly isError?: boolean }) {
  return (
    <span className={`ml-2 text-xs font-medium animate-pulse ${isError ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
      {message}
    </span>
  );
}

/* ---------- Dropdown for status / priority ---------- */

function InlineDropdown({
  options,
  currentValue,
  onSelect,
}: {
  readonly options: readonly { value: string; label: string }[];
  readonly currentValue: string;
  readonly onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="cursor-pointer"
      >
        {options.find((o) => o.value === currentValue)?.label ?? currentValue}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-[140px] rounded-lg bg-[#1e1e2e] border border-[#2a2a3a] shadow-xl py-1">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(o.value);
                setOpen(false);
              }}
              className={`block w-full text-left px-3 py-1.5 text-xs transition-colors duration-150 ${
                o.value === currentValue
                  ? 'bg-[#3b82f6]/20 text-[#3b82f6]'
                  : 'text-[#e4e4e7] hover:bg-[#2a2a3a]'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- FilterBar ---------- */

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
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const togglePerson = (name: string) => {
    const next = selectedPersons.includes(name)
      ? selectedPersons.filter((p) => p !== name)
      : [...selectedPersons, name];
    onPersonsChange(next);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {/* Person multi-select dropdown */}
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="bg-[#1e1e2e] border border-[#2a2a3a] rounded-lg px-3 py-1.5 text-sm text-[#e4e4e7] hover:bg-[#2a2a3a] transition-colors duration-150"
        >
          人员: {selectedPersons.length === 0 ? '全部' : `${selectedPersons.length} 人`} ▼
        </button>
        {dropdownOpen && (
          <div className="absolute z-50 mt-1 min-w-[180px] max-h-[300px] overflow-y-auto rounded-xl bg-[#12121a] border border-[#2a2a3a] shadow-lg py-1">
            {persons.map((name) => {
              const selected = selectedPersons.includes(name);
              return (
                <button
                  key={name}
                  onClick={() => togglePerson(name)}
                  className={`flex items-center gap-2 w-full text-left hover:bg-[#1a1a2e] px-3 py-2 text-sm transition-colors duration-150 ${
                    selected ? 'text-[#3b82f6]' : 'text-[#e4e4e7]'
                  }`}
                >
                  <span className={`inline-flex items-center justify-center w-4 h-4 rounded border text-[10px] ${
                    selected
                      ? 'bg-[#3b82f6] border-[#3b82f6] text-white'
                      : 'border-[#5a5a6e] text-transparent'
                  }`}>
                    ✓
                  </span>
                  {name}
                </button>
              );
            })}
            {persons.length === 0 && (
              <p className="px-3 py-2 text-xs text-[#5a5a6e]">无人员数据</p>
            )}
          </div>
        )}
      </div>

      {/* Task title search */}
      <input
        type="text"
        placeholder="搜索任务标题..."
        value={taskTitle}
        onChange={(e) => onTaskTitleChange(e.target.value)}
        className="bg-[#1e1e2e] border border-[#2a2a3a] rounded-lg px-3 py-1.5 text-sm text-[#e4e4e7] placeholder-[#5a5a6e] w-60 focus:outline-none focus:border-[#3b82f6] transition-colors duration-150"
      />

      {/* Clear button */}
      {(selectedPersons.length > 0 || taskTitle) && (
        <button
          onClick={() => { onPersonsChange([]); onTaskTitleChange(''); }}
          className="text-xs text-[#5a5a6e] hover:text-[#e4e4e7] transition-colors duration-150"
        >
          清除筛选
        </button>
      )}
    </div>
  );
}

/* ---------- Section C: Risk tasks table ---------- */

interface RiskTask {
  readonly taskUid: string;
  readonly title: string;
  readonly assigneeName: string;
  readonly leaderName: string;
  readonly status: string;
  readonly priority: string;
  readonly dueAt: string | null;
  readonly daysToDue: number;
  readonly isOverdue: boolean;
  readonly carryOverCount: number;
  readonly riskReasons?: readonly string[];
  readonly bossAttentionFlag?: boolean;
  readonly version?: number;
}

const RISK_REASON_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  '延期': { bg: 'bg-[#ef4444]/10', text: 'text-[#ef4444]', border: 'border-[#ef4444]/20' },
  '继承': { bg: 'bg-[#f59e0b]/10', text: 'text-[#f59e0b]', border: 'border-[#f59e0b]/20' },
  '停滞': { bg: 'bg-[#8b5cf6]/10', text: 'text-[#8b5cf6]', border: 'border-[#8b5cf6]/20' },
  '临期': { bg: 'bg-[#eab308]/10', text: 'text-[#eab308]', border: 'border-[#eab308]/20' },
  '重点无进度': { bg: 'bg-[#3b82f6]/10', text: 'text-[#3b82f6]', border: 'border-[#3b82f6]/20' },
};

const STATUS_OPTIONS = Object.entries(TaskStatusLabel).map(([value, label]) => ({ value, label }));
const PRIORITY_OPTIONS = Object.entries(PriorityLabel).map(([value, label]) => ({ value, label }));

function RiskReasonTags({ reasons }: { readonly reasons: readonly string[] }) {
  if (reasons.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reasons.map((r) => {
        const style = RISK_REASON_STYLES[r] || { bg: 'bg-[#5a5a6e]/10', text: 'text-[#5a5a6e]', border: 'border-[#5a5a6e]/20' };
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

function RiskTaskRow({
  task,
  onMutate,
}: {
  readonly task: RiskTask;
  readonly onMutate: () => void;
}) {
  const [feedback, setFeedback] = useState<{ message: string; isError: boolean } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = useCallback((message: string, isError: boolean) => {
    setFeedback({ message, isError });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2000);
  }, []);

  const handleToggleImportant = async () => {
    try {
      await apiFetch(`/api/v1/tasks/${task.taskUid}/toggle-important`, { method: 'POST' });
      showFeedback('已更新', false);
      onMutate();
    } catch (err) {
      const msg = err instanceof ApiError && err.code === 409 ? '版本冲突，已刷新' : '操作失败';
      showFeedback(msg, true);
      if (err instanceof ApiError && err.code === 409) onMutate();
    }
  };

  const handleNotifyLeader = async () => {
    try {
      await apiFetch(`/api/v1/tasks/${task.taskUid}/notify-leader`, { method: 'POST' });
      showFeedback('已催办', false);
    } catch {
      showFeedback('催办失败', true);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      await apiFetch(`/api/v1/tasks/${task.taskUid}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus, version: task.version }),
      });
      showFeedback('已更新', false);
      onMutate();
    } catch (err) {
      const msg = err instanceof ApiError && err.code === 409 ? '版本冲突，已刷新' : '更新失败';
      showFeedback(msg, true);
      if (err instanceof ApiError && err.code === 409) onMutate();
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    try {
      await apiFetch(`/api/v1/tasks/${task.taskUid}/priority`, {
        method: 'PATCH',
        body: JSON.stringify({ priority: newPriority, version: task.version }),
      });
      showFeedback('已更新', false);
      onMutate();
    } catch (err) {
      const msg = err instanceof ApiError && err.code === 409 ? '版本冲突，已刷新' : '更新失败';
      showFeedback(msg, true);
      if (err instanceof ApiError && err.code === 409) onMutate();
    }
  };

  return (
    <tr className="transition-colors duration-200 hover:bg-[#1a1a2e]">
      <td className="px-5 py-4 font-medium text-[#e4e4e7]">
        <span>{task.title}</span>
        <RiskReasonTags reasons={task.riskReasons ?? []} />
      </td>
      <td className="px-5 py-4 text-[#e4e4e7]">{task.assigneeName || '-'}</td>
      <td className="px-5 py-4 text-[#8b8b9e]">{task.leaderName || '-'}</td>
      <td className="px-5 py-4">
        <InlineDropdown
          options={STATUS_OPTIONS}
          currentValue={task.status}
          onSelect={handleStatusChange}
        />
      </td>
      <td className="px-5 py-4">
        <InlineDropdown
          options={PRIORITY_OPTIONS}
          currentValue={task.priority}
          onSelect={handlePriorityChange}
        />
      </td>
      <td className="whitespace-nowrap px-5 py-4 tabular-nums text-[#8b8b9e]">
        {task.dueAt ? new Date(task.dueAt).toLocaleDateString('zh-CN') : '-'}
      </td>
      <td className={`px-5 py-4 tabular-nums ${task.isOverdue ? 'font-semibold text-[#ef4444]' : 'text-[#8b8b9e]'}`}>
        {task.daysToDue && task.daysToDue < 0 ? `${Math.abs(task.daysToDue)}天` : '-'}
      </td>
      <td className={`px-5 py-4 tabular-nums ${task.carryOverCount >= 2 ? 'font-semibold text-[#f59e0b]' : 'text-[#8b8b9e]'}`}>
        {task.carryOverCount}
      </td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-1.5">
          {/* Star toggle */}
          <button
            onClick={handleToggleImportant}
            title={task.bossAttentionFlag ? '取消重点' : '标记重点'}
            className={`rounded-lg border px-2 py-1 text-xs transition-colors duration-200 ${
              task.bossAttentionFlag
                ? 'text-[#f59e0b] border-[#f59e0b]/30 bg-[#f59e0b]/10 hover:bg-[#f59e0b]/20'
                : 'text-[#5a5a6e] border-[#2a2a3a] bg-[#1e1e2e] hover:bg-[#2a2a3a] hover:text-[#f59e0b]'
            }`}
          >
            ★
          </button>
          {/* Notify leader */}
          <button
            onClick={handleNotifyLeader}
            title="催办"
            className="rounded-lg border border-[#2a2a3a] bg-[#1e1e2e] px-2 py-1 text-xs text-[#5a5a6e] transition-colors duration-200 hover:bg-[#2a2a3a] hover:text-[#e4e4e7]"
          >
            催办
          </button>
          {/* Inline feedback */}
          {feedback && <InlineFeedback message={feedback.message} isError={feedback.isError} />}
        </div>
      </td>
    </tr>
  );
}

function RiskTable({ tasks, onMutate }: { readonly tasks: readonly RiskTask[]; readonly onMutate: () => void }) {
  const [expandedPersons, setExpandedPersons] = useState<Set<string>>(() => new Set());

  const personGroups = useMemo(() => {
    const grouped = new Map<string, RiskTask[]>();
    for (const task of tasks) {
      const name = task.assigneeName || '未分配';
      const existing = grouped.get(name);
      if (existing) {
        existing.push(task);
      } else {
        grouped.set(name, [task]);
      }
    }
    return Array.from(grouped.entries()).map(([name, personTasks]) => {
      let overdueCount = 0;
      let stalledCount = 0;
      let nearDueCount = 0;
      for (const t of personTasks) {
        const reasons = t.riskReasons ?? [];
        if (reasons.includes('延期')) overdueCount++;
        if (reasons.includes('停滞')) stalledCount++;
        if (reasons.includes('临期')) nearDueCount++;
      }
      return { name, tasks: personTasks, overdueCount, stalledCount, nearDueCount };
    });
  }, [tasks]);

  if (tasks.length === 0) {
    return <p className="py-12 text-center text-[#5a5a6e]">暂无风险任务</p>;
  }

  const togglePerson = (name: string) => {
    setExpandedPersons((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const allPersonKeys = personGroups.map(g => g.name);
  const allExpanded = allPersonKeys.length > 0 && allPersonKeys.every(k => expandedPersons.has(k));

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-xl font-semibold tracking-tight text-[#e4e4e7]">风险任务</h3>
        <button
          onClick={() => {
            if (allExpanded) {
              setExpandedPersons(new Set());
            } else {
              setExpandedPersons(new Set(allPersonKeys));
            }
          }}
          className="text-xs text-[#5a5a6e] hover:text-[#e4e4e7] transition-colors"
        >
          {allExpanded ? '全部收起' : '全部展开'}
        </button>
      </div>
      <div className="overflow-hidden rounded-2xl bg-[#12121a] border border-[#2a2a3a]">
        {personGroups.map((group) => {
          const expanded = expandedPersons.has(group.name);
          return (
            <div key={group.name}>
              {/* Person summary row */}
              <div
                onClick={() => togglePerson(group.name)}
                className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-[#1a1a2e] border-b border-[#2a2a3a]"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[#5a5a6e]">{expanded ? '▼' : '▶'}</span>
                  <span className="font-medium text-[#e4e4e7]">{group.name}</span>
                  <span className="text-xs text-[#5a5a6e]">({group.tasks.length} 项风险任务)</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {group.overdueCount > 0 && <span className="text-[#ef4444]">延期 {group.overdueCount}</span>}
                  {group.stalledCount > 0 && <span className="text-[#8b5cf6]">停滞 {group.stalledCount}</span>}
                  {group.nearDueCount > 0 && <span className="text-[#f59e0b]">临期 {group.nearDueCount}</span>}
                </div>
              </div>

              {/* Expanded task detail rows */}
              {expanded && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-[#1e1e2e]">
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">标题</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">负责人</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">Leader</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">状态</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">优先级</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">截止时间</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">延期天数</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">继承次数</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[#5a5a6e]">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2a2a3a]">
                      {group.tasks.map((t, idx) => (
                        <RiskTaskRow key={t.taskUid || `${t.title}-${idx}`} task={t} onMutate={onMutate} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Section D-0: Person card (flat view) ---------- */

interface PersonSummary {
  readonly userId: string;
  readonly name: string;
  readonly leaderName: string;
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly riskCount: number;
  readonly weeklyNewCount: number;
  readonly doneRate: number;
}

function PersonCard({ person }: { readonly person: PersonSummary }) {
  return (
    <div className="rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-6 transition-all duration-300 ease-out hover:bg-[#1a1a2e]">
      <p className="text-xl font-semibold text-[#e4e4e7]">{person.name}</p>
      {person.leaderName && (
        <p className="mt-0.5 text-xs text-[#5a5a6e]">Leader: {person.leaderName}</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#3b82f6]" />
          <span className="tabular-nums text-[#e4e4e7]">{person.total}</span>
          <span className="text-[#5a5a6e]">总</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#22c55e]" />
          <span className="tabular-nums text-[#e4e4e7]">{person.done}</span>
          <span className="text-[#5a5a6e]">完成</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#ef4444]" />
          <span className="tabular-nums text-[#e4e4e7]">{person.overdue}</span>
          <span className="text-[#5a5a6e]">延期</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
          <span className="tabular-nums text-[#e4e4e7]">{person.riskCount}</span>
          <span className="text-[#5a5a6e]">风险</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#06b6d4]" />
          <span className="tabular-nums text-[#e4e4e7]">{person.weeklyNewCount}</span>
          <span className="text-[#5a5a6e]">新增</span>
        </span>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-[#5a5a6e]">
          <span>完成率</span>
          <span className="tabular-nums font-medium text-[#e4e4e7]">{person.doneRate}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#1e1e2e]">
          <div
            className="h-full rounded-full bg-[#22c55e] transition-all duration-500 ease-out"
            style={{
              width: `${Math.min(person.doneRate, 100)}%`,
              boxShadow: '0 0 8px rgba(34,197,94,0.4)',
            }}
          />
        </div>
      </div>
    </div>
  );
}

function PersonCards({ persons }: { readonly persons: readonly PersonSummary[] }) {
  if (persons.length === 0) {
    return <p className="py-12 text-center text-[#5a5a6e]">暂无人员数据</p>;
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {persons.map((p) => (
        <PersonCard key={p.userId} person={p} />
      ))}
    </div>
  );
}

/* ---------- Grouping toggle ---------- */

type GroupMode = 'person' | 'leader';

const GROUP_MODE_LABELS: readonly { mode: GroupMode; label: string }[] = [
  { mode: 'person', label: '全部人员' },
  { mode: 'leader', label: '按 Leader 分组' },
];

function GroupToggle({
  groupMode,
  onChange,
}: {
  readonly groupMode: GroupMode;
  readonly onChange: (m: GroupMode) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-[#1e1e2e] border border-[#2a2a3a] p-1">
      {GROUP_MODE_LABELS.map((m) => (
        <button
          key={m.mode}
          onClick={() => onChange(m.mode)}
          className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all duration-200 ${
            groupMode === m.mode
              ? 'bg-[#3b82f6] text-white shadow-sm'
              : 'text-[#8b8b9e] hover:text-[#e4e4e7] hover:bg-[#2a2a3a]'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Section D: Leader cards with expandable members ---------- */

interface MemberSummary {
  readonly userId: string;
  readonly name: string;
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
}

interface LeaderSummary {
  readonly leaderName: string;
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly carryOver: number;
  readonly doneRate: number;
  readonly riskCount?: number;
  readonly weeklyNewCount?: number;
  readonly members: readonly MemberSummary[];
}

function LeaderCard({ leader }: { readonly leader: LeaderSummary }) {
  const [expanded, setExpanded] = useState(false);
  const riskCount = leader.riskCount ?? 0;
  const weeklyNew = leader.weeklyNewCount ?? 0;

  return (
    <div className="group rounded-2xl bg-[#12121a] border border-[#2a2a3a] p-6 transition-all duration-300 ease-out hover:bg-[#1a1a2e]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <div className="flex items-center justify-between">
          <p className="text-xl font-semibold text-[#e4e4e7]">{leader.leaderName}</p>
          <span className="text-xs text-[#5a5a6e] transition-all duration-300 ease-out">
            {expanded ? '收起' : '展开'}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#3b82f6]" />
            <span className="tabular-nums text-[#e4e4e7]">{leader.total}</span>
            <span className="text-[#5a5a6e]">总计</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#22c55e]" />
            <span className="tabular-nums text-[#e4e4e7]">{leader.done}</span>
            <span className="text-[#5a5a6e]">完成</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#ef4444]" />
            <span className="tabular-nums text-[#e4e4e7]">{leader.overdue}</span>
            <span className="text-[#5a5a6e]">延期</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#f59e0b]" />
            <span className="tabular-nums text-[#e4e4e7]">{leader.carryOver}</span>
            <span className="text-[#5a5a6e]">继承</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#8b5cf6]" />
            <span className="tabular-nums text-[#e4e4e7]">{riskCount}</span>
            <span className="text-[#5a5a6e]">风险</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#06b6d4]" />
            <span className="tabular-nums text-[#e4e4e7]">{weeklyNew}</span>
            <span className="text-[#5a5a6e]">本周新增</span>
          </span>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-[#5a5a6e]">
            <span>完成率</span>
            <span className="tabular-nums font-medium text-[#e4e4e7]">{leader.doneRate}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#1e1e2e]">
            <div
              className="h-full rounded-full bg-[#22c55e] transition-all duration-500 ease-out"
              style={{
                width: `${Math.min(leader.doneRate, 100)}%`,
                boxShadow: '0 0 8px rgba(34,197,94,0.4)',
              }}
            />
          </div>
        </div>
      </button>

      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          expanded && leader.members.length > 0 ? 'mt-5 max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="border-t border-[#2a2a3a] pt-4">
          <p className="mb-3 text-xs font-medium text-[#5a5a6e]">团队成员明细</p>
          <div className="space-y-2">
            {leader.members.map((m) => (
              <div key={m.userId} className="flex items-center justify-between rounded-xl bg-[#1e1e2e] px-4 py-2.5">
                <span className="text-sm font-medium text-[#e4e4e7]">{m.name}</span>
                <div className="flex items-center gap-4 text-xs tabular-nums">
                  <span className="text-[#8b8b9e]">总 {m.total}</span>
                  <span className="text-[#22c55e]">完 {m.done}</span>
                  <span className={m.overdue > 0 ? 'font-semibold text-[#ef4444]' : 'text-[#8b8b9e]'}>
                    延 {m.overdue}
                  </span>
                  <a
                    href={`/tasks?assignee=${m.userId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[#3b82f6] hover:text-[#60a5fa] hover:underline transition-colors duration-150"
                  >
                    查看任务
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LeaderCards({ leaders }: { readonly leaders: readonly LeaderSummary[] }) {
  if (leaders.length === 0) {
    return <p className="py-12 text-center text-[#5a5a6e]">暂无负责人数据</p>;
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {leaders.map((l) => (
        <LeaderCard key={l.leaderName} leader={l} />
      ))}
    </div>
  );
}

/* ---------- View Switcher ---------- */

type DashboardView = 'overview' | 'gantt';

const VIEW_TABS: readonly { view: DashboardView; label: string }[] = [
  { view: 'overview', label: '概览' },
  { view: 'gantt', label: '甘特图' },
];

function ViewSwitcher({
  activeView,
  onChange,
}: {
  readonly activeView: DashboardView;
  readonly onChange: (v: DashboardView) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-[#1e1e2e] border border-[#2a2a3a] p-1">
      {VIEW_TABS.map((tab) => (
        <button
          key={tab.view}
          onClick={() => onChange(tab.view)}
          className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all duration-200 ${
            activeView === tab.view
              ? 'bg-[#3b82f6] text-white shadow-sm'
              : 'text-[#8b8b9e] hover:text-[#e4e4e7] hover:bg-[#2a2a3a]'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Gantt View Wrapper ---------- */

function GanttView({
  period,
  filterPersons,
  filterTaskTitle,
}: {
  readonly period: DashboardPeriod;
  readonly filterPersons: readonly string[];
  readonly filterTaskTitle: string;
}) {
  const { data, error, isLoading } = useGantt(period);

  return (
    <GanttChart
      data={data}
      isLoading={isLoading}
      error={error}
      filterPersons={filterPersons}
      filterTaskTitle={filterTaskTitle}
    />
  );
}

/* ---------- Main ---------- */

function DashboardContent() {
  const [authed, setAuthed] = useState(false);
  const [period, setPeriod] = useState<DashboardPeriod>(() => ({
    mode: 'month',
    value: formatMonth(new Date()),
  }));
  const [activeView, setActiveView] = useState<DashboardView>('overview');
  const [groupMode, setGroupMode] = useState<GroupMode>('person');
  const [filterPersons, setFilterPersons] = useState<string[]>([]);
  const [filterTaskTitle, setFilterTaskTitle] = useState('');

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data, error, isLoading, mutate } = useDashboard(period);

  const handleMutate = useCallback(() => {
    mutate();
  }, [mutate]);

  // Extract all unique person names from dashboard data
  const allPersonNames = useMemo(() => {
    if (!data) return [];
    const names = new Set<string>();
    for (const p of data.personSummary ?? []) {
      if (p.name) names.add(p.name);
    }
    for (const t of data.riskTasks ?? []) {
      if (t.assigneeName) names.add(t.assigneeName);
    }
    return Array.from(names).sort();
  }, [data]);

  // Filter risk tasks based on filterPersons and filterTaskTitle
  const filteredRiskTasks = useMemo(() => {
    const tasks: readonly RiskTask[] = data?.riskTasks ?? [];
    return tasks.filter((t) => {
      if (filterPersons.length > 0 && !filterPersons.includes(t.assigneeName)) {
        return false;
      }
      if (filterTaskTitle && !t.title.toLowerCase().includes(filterTaskTitle.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [data?.riskTasks, filterPersons, filterTaskTitle]);

  if (!authed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#5a5a6e]">正在验证登录状态...</p>
      </div>
    );
  }

  const periodLabel = getPeriodDisplayLabel(period);

  return (
    <div className="pb-16">
      <div className="mb-8 flex items-center justify-between gap-4 pt-8">
        <h2 className="sr-only">驾驶舱</h2>
        <PeriodSelector period={period} onChange={setPeriod} />
        <ViewSwitcher activeView={activeView} onChange={setActiveView} />
      </div>

      {activeView === 'gantt' ? (
        <>
          <FilterBar
            persons={allPersonNames}
            selectedPersons={filterPersons}
            onPersonsChange={setFilterPersons}
            taskTitle={filterTaskTitle}
            onTaskTitleChange={setFilterTaskTitle}
          />
          <GanttView
            period={period}
            filterPersons={filterPersons}
            filterTaskTitle={filterTaskTitle}
          />
        </>
      ) : isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[#5a5a6e]">加载中...</p>
        </div>
      ) : error ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-[#ef4444]">加载失败: {error.message}</p>
        </div>
      ) : data ? (
        <>
          <HeroStats
            stats={{
              total: data.stats?.total ?? 0,
              done: data.stats?.done ?? 0,
              overdue: data.stats?.overdue ?? 0,
              carryOver: data.stats?.carryOver ?? 0,
              riskCount: data.stats?.riskCount ?? 0,
              weeklyNewCount: data.stats?.weeklyNewCount ?? 0,
            }}
            periodLabel={periodLabel}
          />
          <div className="mt-10">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-xl font-semibold tracking-tight text-[#e4e4e7]">
                {groupMode === 'person' ? '人员概览' : 'Leader 概览'}
              </h3>
              <GroupToggle groupMode={groupMode} onChange={setGroupMode} />
            </div>
            {groupMode === 'person' ? (
              <PersonCards persons={data.personSummary ?? []} />
            ) : (
              <LeaderCards leaders={data.leaderSummary ?? []} />
            )}
          </div>
          <div className="mt-10">
            <FilterBar
              persons={allPersonNames}
              selectedPersons={filterPersons}
              onPersonsChange={setFilterPersons}
              taskTitle={filterTaskTitle}
              onTaskTitleChange={setFilterTaskTitle}
            />
          </div>
          <RiskTable tasks={filteredRiskTasks} onMutate={handleMutate} />
        </>
      ) : null}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-[#5a5a6e]">加载中...</p>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
