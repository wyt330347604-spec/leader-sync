'use client';
import { useState, useEffect, Suspense } from 'react';
import useSWR from 'swr';
import { ensureAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';
import { useMe } from '@/hooks/use-me';

interface GradeRecord {
  record_uid: string;
  grade: string;
  prev_grade: string | null;
  changed_at: string;
  trigger_type: string;
  note: string | null;
}

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  initial_entry: '初始录入',
  biannual_promotion: '半年度晋升',
  manual_adjustment: '手动调整',
};

function gradeLevel(grade: string): number {
  const match = grade.match(/^T(\d)\.(\d)$/);
  if (!match) return 0;
  return parseInt(match[1]) * 10 + parseInt(match[2]);
}

function gradeColor(grade: string): string {
  const level = gradeLevel(grade);
  if (level >= 83) return 'var(--st-not-started)'; // T8.x
  if (level >= 73) return 'var(--accent-blue)'; // T7.x
  if (level >= 63) return 'var(--accent-blue)'; // T6.x
  if (level >= 53) return 'var(--accent-green)'; // T5.x
  return 'var(--text-muted)'; // T4.x
}

function GradeChip({ grade }: { grade: string }) {
  const color = gradeColor(grade);
  return (
    <span
      className="inline-flex items-center rounded-lg px-3 py-1 text-sm font-bold"
      style={{ color, background: `${color}20`, border: `1px solid ${color}40` }}
    >
      {grade}
    </span>
  );
}

function MyGradeContent() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => { ensureAuth().then(setAuthed); }, []);

  const { data: me } = useMe();

  const { data: gradeHistory, error, isLoading } = useSWR<GradeRecord[]>(
    authed && me?.user_id ? `/api/v1/employees/${me.user_id}/grade-history` : null,
    (url: string) => apiFetch<GradeRecord[]>(url),
  );

  if (!authed) return <LoadingScreen />;

  const currentGrade = gradeHistory?.[0]?.grade ?? null;

  return (
    <div className="pb-16 pt-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">我的职级</h2>
      </div>

      {/* Current grade card */}
      <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <p className="mb-1 text-sm text-[var(--text-muted)]">当前职级</p>
        {isLoading ? (
          <p className="text-[var(--text-muted)]">加载中...</p>
        ) : currentGrade ? (
          <div className="flex items-center gap-3">
            <GradeChip grade={currentGrade} />
            <span className="text-sm text-[var(--text-muted)]">
              {me?.user_name}
            </span>
          </div>
        ) : (
          <p className="text-[var(--text-muted)]">尚未设置职级</p>
        )}
      </div>

      {/* Grade history */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">职级变更历史</h3>

        {isLoading ? (
          <p className="text-[var(--text-muted)]">加载中...</p>
        ) : error ? (
          <p className="text-[var(--accent-red)] text-sm">加载失败: {error.message}</p>
        ) : !gradeHistory?.length ? (
          <p className="text-sm text-[var(--text-muted)]">暂无职级变更记录</p>
        ) : (
          <div className="space-y-3">
            {gradeHistory.map((record) => (
              <div
                key={record.record_uid}
                className="flex items-start gap-4 rounded-xl bg-[var(--bg-surface)] px-4 py-3"
              >
                <div className="flex flex-col items-center gap-1">
                  <GradeChip grade={record.grade} />
                  {record.prev_grade && (
                    <span className="text-xs text-[var(--text-muted)]">
                      ← {record.prev_grade}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-[var(--text-secondary)]">
                      {TRIGGER_TYPE_LABELS[record.trigger_type] ?? record.trigger_type}
                    </span>
                    <span className="text-xs text-[var(--text-muted)] tabular-nums">
                      {new Date(record.changed_at).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                  {record.note && (
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{record.note}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MyGradePage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>}>
      <MyGradeContent />
    </Suspense>
  );
}
