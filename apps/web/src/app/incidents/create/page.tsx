'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ensureAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

interface OrgUser {
  user_id: string;
  user_name: string;
}

function CreateIncidentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authed, setAuthed] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('P2');
  const [involvedUserIds, setInvolvedUserIds] = useState<string[]>([]);
  const [relatedTaskUid, setRelatedTaskUid] = useState('');
  const [relatedProjectUid, setRelatedProjectUid] = useState('');
  const [projects, setProjects] = useState<{ projectUid: string; name: string; parentProjectUid?: string | null }[]>([]);
  const [incidentDate, setIncidentDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  // 从 URL 预填（V2c/V2d：从项目卡片或逾期任务跳转过来）
  useEffect(() => {
    const t = searchParams.get('task');
    const p = searchParams.get('project');
    if (t) setRelatedTaskUid(t);
    if (p) setRelatedProjectUid(p);
  }, [searchParams]);

  // 项目列表（项目选择器）
  useEffect(() => {
    if (!authed) return;
    apiFetch<{ projectUid: string; name: string; parentProjectUid?: string | null }[]>('/api/v1/projects')
      .then((list) => setProjects(list.map((p) => ({ projectUid: p.projectUid, name: p.name, parentProjectUid: p.parentProjectUid ?? null }))))
      .catch(() => {});
  }, [authed]);

  const { data: usersData } = useSWR<OrgUser[]>(
    authed ? `/api/v1/users/search?q=${encodeURIComponent(userSearch)}` : null,
    (url: string) => apiFetch<OrgUser[]>(url),
  );

  const userOptions: ComboboxOption[] = (usersData ?? []).map((u) => ({
    value: u.user_id,
    label: u.user_name,
  }));

  function addInvolvedUser(userId: string | null) {
    if (!userId || involvedUserIds.includes(userId)) return;
    setInvolvedUserIds((prev) => [...prev, userId]);
    setUserSearch('');
  }

  function removeInvolvedUser(userId: string) {
    setInvolvedUserIds((prev) => prev.filter((id) => id !== userId));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('请填写事故标题');
      return;
    }
    if (!severity) {
      toast.error('请选择严重程度');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        severity,
        involved_user_ids: involvedUserIds,
      };
      if (description.trim()) body.description = description.trim();
      if (relatedTaskUid.trim()) body.related_task_uid = relatedTaskUid.trim();
      if (relatedProjectUid) body.related_project_uid = relatedProjectUid;
      if (incidentDate) body.incident_date = incidentDate;

      const result = await apiFetch<{ incident_uid: string }>('/api/v1/incidents', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      toast.success('事故记录已创建');
      router.push(`/incidents/${result.incident_uid}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (!authed) return <LoadingScreen />;

  const isHighSeverity = severity === 'P0' || severity === 'P1';

  return (
    <div className="pb-16 pt-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => router.back()}
          className="mb-4 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          ← 返回
        </button>
        <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">新建事故记录</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
            事故标题 <span className="text-[var(--accent-red)]">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="简短描述事故内容"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
          />
        </div>

        {/* Severity */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
            严重程度 <span className="text-[var(--accent-red)]">*</span>
          </label>
          <div className="flex gap-2">
            {['P0', 'P1', 'P2', 'P3'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                className={`flex-1 rounded-xl border py-2.5 text-sm font-bold transition-all ${
                  severity === s
                    ? s === 'P0'
                      ? 'border-[var(--accent-red)]/50 bg-[var(--accent-red)]/15 text-[var(--accent-red)]'
                      : s === 'P1'
                      ? 'border-[#f97316]/50 bg-[#f97316]/15 text-[#f97316]'
                      : s === 'P2'
                      ? 'border-[#eab308]/50 bg-[#eab308]/15 text-[#eab308]'
                      : 'border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]'
                    : 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="mt-2 text-xs text-[var(--text-muted)]">
            {severity === 'P0' && 'P0：生产崩溃 / 重大财务损失'}
            {severity === 'P1' && 'P1：严重违规，显著影响团队协作或业务进展'}
            {severity === 'P2' && 'P2：一般违规，需整改但不紧急'}
            {severity === 'P3' && 'P3：轻微问题，记录备案'}
          </div>
        </div>

        {/* P0/P1 warning */}
        {isHighSeverity && (
          <div className="rounded-xl border border-[#f97316]/30 bg-[#f97316]/10 px-4 py-3 text-sm text-[#f97316]">
            此事故将进入「待确认」状态，需 PMO 或 Boss 确认后方可生效。
          </div>
        )}

        {/* Description */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">详细描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="可选：描述事故经过、影响范围等"
            rows={4}
            className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
          />
        </div>

        {/* Involved users */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">涉及员工</label>
          {involvedUserIds.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {involvedUserIds.map((uid) => {
                const user = usersData?.find((u) => u.user_id === uid);
                return (
                  <span
                    key={uid}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs text-[var(--text-primary)]"
                  >
                    {user?.user_name ?? uid}
                    <button
                      type="button"
                      onClick={() => removeInvolvedUser(uid)}
                      className="text-[var(--text-muted)] hover:text-[var(--accent-red)]"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <Combobox
            value={null}
            onChange={addInvolvedUser}
            options={userOptions}
            placeholder="搜索并添加涉及员工"
            searchPlaceholder="输入姓名搜索..."
            emptyText="无匹配员工"
          />
        </div>

        {/* Incident date */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">事故发生日期（可选）</label>
          <input
            type="date"
            value={incidentDate}
            onChange={(e) => setIncidentDate(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none"
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">不填则以提交时间作为归属月份</p>
        </div>

        {/* Related project (V2c) */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">关联项目（可选）</label>
          <Combobox
            value={relatedProjectUid}
            onChange={(v) => setRelatedProjectUid(v || '')}
            options={[{ value: '', label: '无（不关联项目）' }, ...projects.map((p) => ({ value: p.projectUid, label: p.parentProjectUid ? `↳ ${p.name}` : p.name }))]}
            placeholder="选择项目"
            searchPlaceholder="搜索项目"
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">关联任务时会自动带出其项目；也可直接指定项目级事故。</p>
        </div>

        {/* Related task */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">关联任务（可选）</label>
          <input
            type="text"
            value={relatedTaskUid}
            onChange={(e) => setRelatedTaskUid(e.target.value)}
            placeholder="输入任务 UID（task_xxx）"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
          />
        </div>

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex-1 rounded-xl border border-[var(--border)] py-3 text-sm font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-hover)]"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-xl bg-[var(--accent-blue)] py-3 text-sm font-medium text-white transition-all hover:bg-[var(--accent-blue)]/90 disabled:opacity-50"
          >
            {submitting ? '提交中...' : '提交事故'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CreateIncidentPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>}>
      <CreateIncidentContent />
    </Suspense>
  );
}
