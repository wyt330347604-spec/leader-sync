'use client';
import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useDashboard } from '@/hooks/use-dashboard';
import { useLeaderMonthly } from '@/hooks/use-leader-monthly';
import { useLeaderWeekly } from '@/hooks/use-leader-weekly';
import { useMyMonthly } from '@/hooks/use-my-monthly';
import type { DashboardPeriod } from '@/hooks/use-dashboard';
import { LoadingScreen } from "@/components/loading-screen";
import { ensureAuth } from '@/lib/auth';
import { apiFetch, ApiError } from '@/lib/api-client';
import { TaskStatusLabel, PriorityLabel, UserRole } from '@leader-sync/shared-types';
import { useMe } from '@/hooks/use-me';
import { ProjectPortfolio } from '@/components/project-portfolio';
import { StatusBadge } from '@/components/status-badge';
import { DashboardTabBar } from '@/components/dashboard-tab-bar';
import { LeaderMonthlyCard } from '@/components/leader-monthly-card';
import { LeaderWeeklyPanel } from '@/components/leader-weekly-panel';
import { MyMonthlySummaryCard } from '@/components/my-monthly-summary-card';
import { MemberTaskDrawer } from '@/components/member-task-drawer';
import TinyPinyin from 'tiny-pinyin';

/* ---------- helpers ---------- */

function matchesPersonQuery(name: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (name.toLowerCase().includes(q)) return true;
  if (TinyPinyin.isSupported()) {
    const fullPinyin = TinyPinyin.convertToPinyin(name, '', true);
    if (fullPinyin.includes(q)) return true;
    const firstLetters = name
      .split('')
      .map((ch) => {
        const py = TinyPinyin.convertToPinyin(ch, '', true);
        return py ? py[0] : ch;
      })
      .join('');
    if (firstLetters.includes(q)) return true;
  }
  return false;
}

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

function getPeriodDisplayLabel(period: DashboardPeriod): string {
  if (period.mode === 'month') {
    const parts = period.value.split('-');
    if (parts.length === 2) return `${parseInt(parts[1], 10)}月`;
    return period.value;
  }
  const parts = period.value.split('-');
  return parts.length === 2 ? parts[1] : period.value;
}

/* ---------- Section A: Period Selector ---------- */

type PeriodMode = 'month' | 'quarter';

const CHEVRON_SVG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5l3 3 3-3' fill='none' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;

function buildMonthSelectOptions(): readonly { label: string; value: string }[] {
  const year = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    return { label: `${year}年${i + 1}月`, value: `${year}-${m}` };
  });
}

function buildQuarterSelectOptions(): readonly { label: string; value: string }[] {
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

  const options =
    period.mode === 'month'
      ? buildMonthSelectOptions()
      : buildQuarterSelectOptions();

  const handleModeChange = (mode: PeriodMode) => {
    if (mode === period.mode) return;
    if (mode === 'month') {
      onChange({ mode: 'month', value: formatMonth(new Date()) });
    } else {
      onChange({ mode: 'quarter', value: getCurrentQuarter() });
    }
  };

  return (
    <div className="flex items-center gap-3">
      {/* Tab pills */}
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

      {/* Dropdown */}
      <select
        value={period.value}
        onChange={(e) => onChange({ mode: period.mode, value: e.target.value })}
        className="appearance-none rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 pr-7 text-sm text-[var(--text-primary)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/30"
        style={{
          backgroundImage: CHEVRON_SVG,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.5rem center',
          backgroundSize: '12px 12px',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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
  readonly weeklyDoneCount?: number;
}

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

/* ---------- Inline feedback ---------- */

function InlineFeedback({ message, isError }: { readonly message: string; readonly isError?: boolean }) {
  return (
    <span className={`ml-2 text-xs font-medium animate-pulse ${isError ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}`}>
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
        <div className="absolute z-50 mt-1 min-w-[140px] rounded-lg bg-[var(--bg-card)] border border-[var(--border)] shadow-lg py-1">
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
                  ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]'
                  : 'text-[var(--text-primary)] hover:bg-[var(--border)]'
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
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setSearchQuery('');
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  useEffect(() => {
    if (dropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [dropdownOpen]);

  const filteredPersons = useMemo(
    () => persons.filter((name) => matchesPersonQuery(name, searchQuery)),
    [persons, searchQuery],
  );

  const togglePerson = (name: string) => {
    const next = selectedPersons.includes(name)
      ? selectedPersons.filter((p) => p !== name)
      : [...selectedPersons, name];
    onPersonsChange(next);
  };

  const triggerLabel = (() => {
    if (selectedPersons.length === 0) return '全部人员';
    if (selectedPersons.length <= 2) return selectedPersons.join(', ');
    return `${selectedPersons.slice(0, 2).join(', ')} +${selectedPersons.length - 2}`;
  })();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {/* Person combobox */}
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="inline-flex items-center gap-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--border)] transition-colors duration-150"
        >
          <span>{triggerLabel}</span>
          <svg
            className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform duration-150 ${dropdownOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 4.5l3 3 3-3" />
          </svg>
        </button>
        {dropdownOpen && (
          <div className="absolute z-50 mt-1 min-w-[220px] rounded-xl bg-[var(--bg-card)] border border-[var(--border)] shadow-lg flex flex-col">
            {/* Search input */}
            <div className="p-2">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="搜索人员..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)] transition-colors duration-150"
              />
            </div>
            {/* Person list */}
            <div className="max-h-[240px] overflow-y-auto px-1">
              {filteredPersons.map((name) => {
                const selected = selectedPersons.includes(name);
                return (
                  <button
                    key={name}
                    onClick={() => togglePerson(name)}
                    className={`flex items-center gap-2 w-full text-left hover:bg-[var(--bg-hover)] rounded-lg px-2.5 py-2 text-sm transition-colors duration-150 ${
                      selected ? 'text-[var(--accent-blue)]' : 'text-[var(--text-primary)]'
                    }`}
                  >
                    <span className={`inline-flex items-center justify-center w-4 h-4 rounded border text-[10px] ${
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
                <p className="px-2.5 py-2 text-xs text-[var(--text-muted)]">无匹配人员</p>
              )}
            </div>
            {/* Footer actions */}
            <div className="flex items-center justify-between border-t border-[var(--border)] px-2.5 py-2">
              <button
                onClick={() => onPersonsChange(searchQuery ? [...filteredPersons] : [...persons])}
                className="text-xs text-[var(--accent-blue)] hover:underline"
              >
                全选
              </button>
              <button
                onClick={() => onPersonsChange([])}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
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
  '延期': { bg: 'bg-[var(--accent-red)]/10', text: 'text-[var(--accent-red)]', border: 'border-[var(--accent-red)]/20' },
  '继承': { bg: 'bg-[var(--accent-orange)]/10', text: 'text-[var(--accent-orange)]', border: 'border-[var(--accent-orange)]/20' },
  '停滞': { bg: 'bg-[var(--st-not-started)]/10', text: 'text-[var(--st-not-started)]', border: 'border-[var(--st-not-started)]/20' },
  '临期': { bg: 'bg-[#eab308]/10', text: 'text-[#eab308]', border: 'border-[#eab308]/20' },
  '重点无进度': { bg: 'bg-[var(--accent-blue)]/10', text: 'text-[var(--accent-blue)]', border: 'border-[var(--accent-blue)]/20' },
};

const STATUS_OPTIONS = Object.entries(TaskStatusLabel).map(([value, label]) => ({ value, label }));
const PRIORITY_OPTIONS = Object.entries(PriorityLabel).map(([value, label]) => ({ value, label }));

function RiskReasonTags({ reasons }: { readonly reasons: readonly string[] }) {
  if (reasons.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reasons.map((r) => {
        const style = RISK_REASON_STYLES[r] || { bg: 'bg-[var(--text-muted)]/10', text: 'text-[var(--text-muted)]', border: 'border-[var(--text-muted)]/20' };
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
    <tr className="transition-colors duration-200 hover:bg-[var(--bg-hover)]">
      <td className="px-5 py-4 font-medium text-[var(--text-primary)]">
        <span>{task.title}</span>
        <RiskReasonTags reasons={task.riskReasons ?? []} />
      </td>
      <td className="px-5 py-4 text-[var(--text-primary)]">{task.assigneeName || '-'}</td>
      <td className="px-5 py-4 text-[var(--text-secondary)]">{task.leaderName || '-'}</td>
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
      <td className="whitespace-nowrap px-5 py-4 tabular-nums text-[var(--text-secondary)]">
        {task.dueAt ? new Date(task.dueAt).toLocaleDateString('zh-CN') : '-'}
      </td>
      <td className={`px-5 py-4 tabular-nums ${task.isOverdue ? 'font-semibold text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}`}>
        {task.daysToDue && task.daysToDue < 0 ? `${Math.abs(task.daysToDue)}天` : '-'}
      </td>
      <td className={`px-5 py-4 tabular-nums ${task.carryOverCount >= 2 ? 'font-semibold text-[var(--accent-orange)]' : 'text-[var(--text-secondary)]'}`}>
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
                ? 'text-[var(--accent-orange)] border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/10 hover:bg-[var(--accent-orange)]/20'
                : 'text-[var(--text-muted)] border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--border)] hover:text-[var(--accent-orange)]'
            }`}
          >
            ★
          </button>
          {/* Notify leader */}
          <button
            onClick={handleNotifyLeader}
            title="催办"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-muted)] transition-colors duration-200 hover:bg-[var(--border)] hover:text-[var(--text-primary)]"
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
    return <p className="py-12 text-center text-[var(--text-muted)]">暂无风险任务</p>;
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
        <h3 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">风险任务</h3>
        <button
          onClick={() => {
            if (allExpanded) {
              setExpandedPersons(new Set());
            } else {
              setExpandedPersons(new Set(allPersonKeys));
            }
          }}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          {allExpanded ? '全部收起' : '全部展开'}
        </button>
      </div>
      <div className="overflow-hidden rounded-2xl bg-[var(--bg-card)] border border-[var(--border)]">
        {personGroups.map((group) => {
          const expanded = expandedPersons.has(group.name);
          return (
            <div key={group.name}>
              {/* Person summary row */}
              <div
                onClick={() => togglePerson(group.name)}
                className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-[var(--bg-hover)] border-b border-[var(--border)]"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[var(--text-muted)]">{expanded ? '▼' : '▶'}</span>
                  <span className="font-medium text-[var(--text-primary)]">{group.name}</span>
                  <span className="text-xs text-[var(--text-muted)]">({group.tasks.length} 项风险任务)</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {group.overdueCount > 0 && <span className="text-[var(--accent-red)]">延期 {group.overdueCount}</span>}
                  {group.stalledCount > 0 && <span className="text-[var(--st-not-started)]">停滞 {group.stalledCount}</span>}
                  {group.nearDueCount > 0 && <span className="text-[var(--accent-orange)]">临期 {group.nearDueCount}</span>}
                </div>
              </div>

              {/* Expanded task detail rows */}
              {expanded && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-[var(--bg-surface)]">
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)]">标题</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)]">负责人</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)]">Leader</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)]">状态</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)]">优先级</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)]">截止时间</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)]">延期天数</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)]">继承次数</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-xs font-medium text-[var(--text-muted)]">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
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

/* ---------- Section D-0: Person table (flat view) ---------- */

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

const PRIORITY_QUADRANTS = [
  { key: 'urgent_important', label: '重要紧急' },
  { key: 'important_not_urgent', label: '重要不紧急' },
  { key: 'urgent_not_important', label: '紧急不重要' },
  { key: 'not_urgent_not_important', label: '不紧急不重要' },
  { key: '', label: '未分类' },
] as const;

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

function rateColor(rate: number): string {
  if (rate >= 80) return 'var(--accent-green)';
  if (rate >= 50) return 'var(--accent-blue)';
  return 'var(--accent-red)';
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
    <div className="flex items-center gap-3 px-5 py-2 hover:bg-[var(--bg-hover)] transition-colors duration-150">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {task.bossAttentionFlag && (
          <span className="shrink-0 text-[10px] text-[var(--accent-orange)]">★</span>
        )}
        <a
          href={`/tasks?task=${task.taskUid}`}
          className="truncate text-sm text-[var(--text-primary)] hover:text-[var(--accent-blue)] hover:underline"
        >
          {task.title}
        </a>
        <StatusBadge status={task.status} />
        {overdueText && (
          <span className="shrink-0 text-xs font-medium text-[var(--accent-red)]">{overdueText}</span>
        )}
      </div>
      {dueStr && (
        <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">{dueStr}</span>
      )}
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

function PersonAccordion({
  persons,
  onMutate,
}: {
  readonly persons: readonly PersonSummary[];
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
        // person.tasks comes from the API now — cast since PersonSummary may not have it typed yet
        const tasks: PersonTaskItem[] = (person as any).tasks ?? [];

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

/* ---------- Grouping toggle ---------- */

type GroupMode = 'person' | 'leader' | 'project';

const GROUP_MODE_LABELS: readonly { mode: GroupMode; label: string }[] = [
  { mode: 'person', label: '全部人员' },
  { mode: 'leader', label: '按 Leader 分组' },
  { mode: 'project', label: '按项目分组' },
];

function GroupToggle({
  groupMode,
  onChange,
}: {
  readonly groupMode: GroupMode;
  readonly onChange: (m: GroupMode) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] p-1">
      {GROUP_MODE_LABELS.map((m) => (
        <button
          key={m.mode}
          onClick={() => onChange(m.mode)}
          className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all duration-200 ${
            groupMode === m.mode
              ? 'bg-[var(--accent-blue)] text-white shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]'
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
    <div className="group rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-6 transition-all duration-300 ease-out hover:bg-[var(--bg-hover)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <div className="flex items-center justify-between">
          <p className="text-xl font-semibold text-[var(--text-primary)]">{leader.leaderName}</p>
          <span className="text-xs text-[var(--text-muted)] transition-all duration-300 ease-out">
            {expanded ? '收起' : '展开'}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--accent-blue)]" />
            <span className="tabular-nums text-[var(--text-primary)]">{leader.total}</span>
            <span className="text-[var(--text-muted)]">总计</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--accent-green)]" />
            <span className="tabular-nums text-[var(--text-primary)]">{leader.done}</span>
            <span className="text-[var(--text-muted)]">完成</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--accent-red)]" />
            <span className="tabular-nums text-[var(--text-primary)]">{leader.overdue}</span>
            <span className="text-[var(--text-muted)]">延期</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--accent-orange)]" />
            <span className="tabular-nums text-[var(--text-primary)]">{leader.carryOver}</span>
            <span className="text-[var(--text-muted)]">继承</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[var(--st-not-started)]" />
            <span className="tabular-nums text-[var(--text-primary)]">{riskCount}</span>
            <span className="text-[var(--text-muted)]">风险</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#06b6d4]" />
            <span className="tabular-nums text-[var(--text-primary)]">{weeklyNew}</span>
            <span className="text-[var(--text-muted)]">本周新增</span>
          </span>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>完成率</span>
            <span className="tabular-nums font-medium text-[var(--text-primary)]">{leader.doneRate}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-surface)]">
            <div
              className="h-full rounded-full bg-[var(--accent-green)] transition-all duration-500 ease-out"
              style={{
                width: `${Math.min(leader.doneRate, 100)}%`,
                boxShadow: '0 0 8px color-mix(in srgb, var(--accent-green) 40%, transparent)',
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
        <div className="border-t border-[var(--border)] pt-4">
          <p className="mb-3 text-xs font-medium text-[var(--text-muted)]">团队成员明细</p>
          <div className="space-y-2">
            {leader.members.map((m) => (
              <div key={m.userId} className="flex items-center justify-between rounded-xl bg-[var(--bg-surface)] px-4 py-2.5">
                <span className="text-sm font-medium text-[var(--text-primary)]">{m.name}</span>
                <div className="flex items-center gap-4 text-xs tabular-nums">
                  <span className="text-[var(--text-secondary)]">总 {m.total}</span>
                  <span className="text-[var(--accent-green)]">完 {m.done}</span>
                  <span className={m.overdue > 0 ? 'font-semibold text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}>
                    延 {m.overdue}
                  </span>
                  <a
                    href={`/tasks?assignee=${m.userId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[var(--accent-blue)] hover:text-[#60a5fa] hover:underline transition-colors duration-150"
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
    return <p className="py-12 text-center text-[var(--text-muted)]">暂无负责人数据</p>;
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {leaders.map((l) => (
        <LeaderCard key={l.leaderName} leader={l} />
      ))}
    </div>
  );
}

/* ---------- Section D-2: Project cards ---------- */

interface ProjectSummary {
  readonly projectUid: string;
  readonly projectName: string;
  readonly total: number;
  readonly done: number;
  readonly overdue: number;
  readonly riskCount: number;
  readonly doneRate: number;
}

function ProjectCard({ project }: { readonly project: ProjectSummary }) {
  return (
    <div className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border)] p-6 transition-all duration-300 ease-out hover:bg-[var(--bg-hover)]">
      <p className="text-xl font-semibold text-[var(--text-primary)]">{project.projectName}</p>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--accent-blue)]" />
          <span className="tabular-nums text-[var(--text-primary)]">{project.total}</span>
          <span className="text-[var(--text-muted)]">总</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--accent-green)]" />
          <span className="tabular-nums text-[var(--text-primary)]">{project.done}</span>
          <span className="text-[var(--text-muted)]">完成</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--accent-red)]" />
          <span className="tabular-nums text-[var(--text-primary)]">{project.overdue}</span>
          <span className="text-[var(--text-muted)]">延期</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--accent-orange)]" />
          <span className="tabular-nums text-[var(--text-primary)]">{project.riskCount}</span>
          <span className="text-[var(--text-muted)]">风险</span>
        </span>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>完成率</span>
          <span className="tabular-nums font-medium text-[var(--text-primary)]">{project.doneRate}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-surface)]">
          <div
            className="h-full rounded-full bg-[var(--accent-green)] transition-all duration-500 ease-out"
            style={{
              width: `${Math.min(project.doneRate, 100)}%`,
              boxShadow: '0 0 8px rgba(34,197,94,0.4)',
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ProjectCards({ projects }: { readonly projects: readonly ProjectSummary[] }) {
  if (projects.length === 0) {
    return <p className="py-12 text-center text-[var(--text-muted)]">暂无项目数据</p>;
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <ProjectCard key={p.projectUid} project={p} />
      ))}
    </div>
  );
}

/* ---------- View Switcher ---------- */

/* ---------- Leader Team Tab (Tab B) ---------- */

type LeaderSubView = 'monthly' | 'weekly';

function LeaderTeamTab({ month }: { readonly month: string }) {
  const [subView, setSubView] = useState<LeaderSubView>('monthly');
  const [drawerUser, setDrawerUser] = useState<{ userId: string; name: string } | null>(null);

  const { data: monthly, error: monthlyError, isLoading: monthlyLoading } = useLeaderMonthly(month, subView === 'monthly');
  const { data: weekly, error: weeklyError, isLoading: weeklyLoading } = useLeaderWeekly(subView === 'weekly');

  const hasTeam = monthly && monthly.total > 0;

  return (
    <div>
      {/* Sub-view toggle */}
      <div className="mb-5 flex items-center gap-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] p-1 w-fit">
        {(['monthly', 'weekly'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setSubView(v)}
            className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all duration-200 ${
              subView === v
                ? 'bg-[var(--accent-blue)] text-white shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]'
            }`}
          >
            {v === 'monthly' ? '月度' : '周度'}
          </button>
        ))}
      </div>

      {subView === 'monthly' && (
        <>
          {monthlyLoading ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <p className="text-[var(--text-muted)]">加载中...</p>
            </div>
          ) : monthlyError ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <p className="text-[var(--accent-red)] text-sm">加载失败: {monthlyError.message}</p>
            </div>
          ) : monthly && hasTeam ? (
            <LeaderMonthlyCard
              data={monthly}
              onDrillDown={(userId, name) => setDrawerUser({ userId, name })}
            />
          ) : (
            <div className="flex min-h-[200px] items-center justify-center">
              <p className="text-[var(--text-muted)]">本月暂无团队任务数据</p>
            </div>
          )}
        </>
      )}

      {subView === 'weekly' && (
        <>
          {weeklyLoading ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <p className="text-[var(--text-muted)]">加载中...</p>
            </div>
          ) : weeklyError ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <p className="text-[var(--accent-red)] text-sm">加载失败: {weeklyError.message}</p>
            </div>
          ) : weekly ? (
            <LeaderWeeklyPanel data={weekly} />
          ) : (
            <div className="flex min-h-[200px] items-center justify-center">
              <p className="text-[var(--text-muted)]">本周暂无团队任务数据</p>
            </div>
          )}
        </>
      )}

      {/* Member task drawer */}
      {drawerUser && (
        <MemberTaskDrawer
          userId={drawerUser.userId}
          userName={drawerUser.name}
          month={month}
          onClose={() => setDrawerUser(null)}
        />
      )}
    </div>
  );
}

/* ---------- My Summary Tab (Tab C) ---------- */

function MyCompletionTab({ month }: { readonly month: string }) {
  const { data, error, isLoading } = useMyMonthly(month);

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <p className="text-[var(--text-muted)]">加载中...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <p className="text-[var(--accent-red)] text-sm">加载失败: {error.message}</p>
      </div>
    );
  }
  if (!data) return null;

  return <MyMonthlySummaryCard data={data} />;
}

/* ---------- Main ---------- */

type MainTab = 'projects' | 'boss' | 'leader' | 'me';

function DashboardContent() {
  const [authed, setAuthed] = useState(false);
  const [period, setPeriod] = useState<DashboardPeriod>(() => ({
    mode: 'month',
    value: formatMonth(new Date()),
  }));
  const [groupMode, setGroupMode] = useState<GroupMode>('person');
  const [filterPersons, setFilterPersons] = useState<string[]>([]);
  const [filterTaskTitle, setFilterTaskTitle] = useState('');
  const [activeTab, setActiveTab] = useState<MainTab>('me');

  const { data: me } = useMe();
  const role = me?.role ?? '';
  const canCompanyView = role === UserRole.BOSS || role === UserRole.PMO || role === UserRole.ADMIN;
  const canLeaderView = canCompanyView || role === UserRole.LEADER;

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  // 首次加载完用户信息后：有全员视图权限者默认进「项目」tab（项目驱动首屏）。仅执行一次，不覆盖用户点击。
  const didInitTab = useRef(false);
  useEffect(() => {
    if (!me || didInitTab.current) return;
    didInitTab.current = true;
    if (canCompanyView) setActiveTab('projects');
  }, [me, canCompanyView]);

  // 角色变化后，若当前 tab 越权（如普通员工默认不该停在 projects/boss/leader），回落到「我的完成情况」。
  useEffect(() => {
    if (activeTab === 'projects' && !canCompanyView) setActiveTab('me');
    if (activeTab === 'boss' && !canCompanyView) setActiveTab('me');
    // 我的团队仅纯 Leader 可见；越权或升级为全员视图者回落
    if (activeTab === 'leader' && (!canLeaderView || canCompanyView)) setActiveTab(canCompanyView ? 'boss' : 'me');
  }, [activeTab, canCompanyView, canLeaderView]);

  // 仅有全员概览权限的用户才拉取 /boss 数据，避免普通员工触发 403。
  const { data, error, isLoading, mutate } = useDashboard(period, canCompanyView);

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
    return <LoadingScreen />;
  }

  const periodLabel = getPeriodDisplayLabel(period);
  const currentMonth = period.mode === 'month' ? period.value : formatMonth(new Date());

  // 按角色显示 tab：全员概览仅 Boss/PMO/Admin；我的团队仅 leader 及以上；我的完成情况所有人。
  const MAIN_TABS: { key: MainTab; label: string }[] = [];
  if (canCompanyView) MAIN_TABS.push({ key: 'projects', label: '项目' });
  if (canCompanyView) MAIN_TABS.push({ key: 'boss', label: 'Boss 全员概览' });
  // 「我的团队」只给纯 Leader；Boss/PMO/Admin 用 Boss 全员概览→按 Leader 分组（覆盖且更全），避免两处重复
  if (canLeaderView && !canCompanyView) MAIN_TABS.push({ key: 'leader', label: '我的团队' });
  MAIN_TABS.push({ key: 'me', label: '我的完成情况' });

  return (
    <div className="pb-16">
      <div className="mb-6 flex items-start justify-between gap-4 pt-8 flex-wrap">
        <h2 className="sr-only">驾驶舱</h2>
        <DashboardTabBar
          tabs={MAIN_TABS}
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as MainTab)}
        />
        <div className="flex items-center gap-3">
          {activeTab !== 'projects' && <PeriodSelector period={period} onChange={setPeriod} />}
        </div>
      </div>

      {/* Tab: 项目组合（项目驱动首屏，仅全员视图角色） */}
      {activeTab === 'projects' && (
        <ProjectPortfolio enabled={canCompanyView} />
      )}

      {/* Tab C: My completion (default for all) */}
      {activeTab === 'me' && (
        <MyCompletionTab month={currentMonth} />
      )}

      {/* Tab B: Leader team */}
      {activeTab === 'leader' && (
        <LeaderTeamTab month={currentMonth} />
      )}

      {/* Tab A: Boss overview (existing content) */}
      {activeTab === 'boss' && (
        <>
          {isLoading ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <p className="text-[var(--text-muted)]">加载中...</p>
            </div>
          ) : error ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <p className="text-[var(--accent-red)]">加载失败: {error.message}</p>
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
                  weeklyDoneCount: data.stats?.weeklyDoneCount ?? 0,
                }}
                periodLabel={periodLabel}
              />
              <div className="mt-10">
                <div className="mb-5 flex items-center justify-between">
                  <h3 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
                    {groupMode === 'person' ? '人员概览' : groupMode === 'leader' ? 'Leader 概览' : '项目概览'}
                  </h3>
                  <GroupToggle groupMode={groupMode} onChange={setGroupMode} />
                </div>
                {groupMode === 'person' ? (
                  <PersonAccordion persons={data.personSummary ?? []} onMutate={handleMutate} />
                ) : groupMode === 'leader' ? (
                  <LeaderCards leaders={data.leaderSummary ?? []} />
                ) : (
                  <ProjectCards projects={data.projectSummary ?? []} />
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
        </>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-[var(--text-muted)]">加载中...</p>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
