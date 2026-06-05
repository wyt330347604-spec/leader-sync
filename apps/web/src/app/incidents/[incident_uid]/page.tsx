'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useParams } from 'next/navigation';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ensureAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { LoadingScreen } from '@/components/loading-screen';
import { IncidentSeverityBadge } from '@/components/incident-severity-badge';
import { IncidentConfirmDialog, IncidentRejectDialog } from '@/components/incident-confirm-dialog';
import { useMe } from '@/hooks/use-me';

interface InvolvedUser {
  user_id: string;
  user_name: string;
  involvement: string;
}

interface IncidentDetail {
  incident_uid: string;
  title: string;
  description: string | null;
  severity: string;
  confirm_status: string;
  reporter_user_id: string;
  reporter_name: string;
  involved_users: InvolvedUser[];
  related_task_uid: string | null;
  incident_date: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
}

const CONFIRM_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending_confirm: { label: '待确认', className: 'text-[#f97316] bg-[#f97316]/10 border-[#f97316]/30' },
  confirmed: { label: '已确认', className: 'text-[var(--accent-green)] bg-[var(--accent-green)]/10 border-[var(--accent-green)]/20' },
  rejected: { label: '已驳回', className: 'text-[var(--text-muted)] bg-[var(--text-muted)]/10 border-[var(--text-muted)]/20' },
};

function IncidentDetailContent() {
  const router = useRouter();
  const params = useParams();
  const incidentUid = params.incident_uid as string;
  const [authed, setAuthed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  useEffect(() => {
    ensureAuth().then(setAuthed);
  }, []);

  const { data: me } = useMe();
  const { data: incident, error, isLoading, mutate } = useSWR<IncidentDetail>(
    authed && incidentUid ? `/api/v1/incidents/${incidentUid}` : null,
    (url: string) => apiFetch<IncidentDetail>(url),
  );

  async function handleConfirm() {
    await apiFetch(`/api/v1/incidents/${incidentUid}/confirm`, { method: 'POST' });
    toast.success('事故已确认生效');
    setConfirmOpen(false);
    mutate();
  }

  async function handleReject(reason: string) {
    await apiFetch(`/api/v1/incidents/${incidentUid}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reject_reason: reason }),
    });
    toast.success('事故已驳回');
    setRejectOpen(false);
    mutate();
  }

  if (!authed) return <LoadingScreen />;

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-[var(--text-muted)]">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-[var(--accent-red)]">加载失败: {error.message}</p>
      </div>
    );
  }

  if (!incident) return null;

  const statusCfg = CONFIRM_STATUS_CONFIG[incident.confirm_status] ?? CONFIRM_STATUS_CONFIG.confirmed;
  const isPending = incident.confirm_status === 'pending_confirm';
  const isRejected = incident.confirm_status === 'rejected';

  // Check if current user can confirm/reject (pmo/boss role — we rely on backend for enforcement)
  const canManage = me && incident.reporter_user_id !== me.user_id;

  return (
    <div className="pb-16 pt-8 max-w-2xl mx-auto">
      <button
        onClick={() => router.back()}
        className="mb-6 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        ← 返回
      </button>

      {/* Header */}
      <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <IncidentSeverityBadge severity={incident.severity} />
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusCfg.className}`}>
                {statusCfg.label}
              </span>
            </div>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">{incident.title}</h2>
          </div>
        </div>

        {incident.description && (
          <p className="mt-4 text-sm text-[var(--text-secondary)] leading-relaxed">
            {incident.description}
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-[var(--text-muted)]">记录人</span>
            <p className="mt-0.5 font-medium text-[var(--text-primary)]">{incident.reporter_name}</p>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">记录时间</span>
            <p className="mt-0.5 font-medium text-[var(--text-primary)]">
              {new Date(incident.created_at).toLocaleDateString('zh-CN')}
            </p>
          </div>
          {incident.incident_date && (
            <div>
              <span className="text-[var(--text-muted)]">事故日期</span>
              <p className="mt-0.5 font-medium text-[var(--text-primary)]">{incident.incident_date}</p>
            </div>
          )}
          {incident.related_task_uid && (
            <div>
              <span className="text-[var(--text-muted)]">关联任务</span>
              <a
                href={`/tasks?task=${incident.related_task_uid}`}
                className="mt-0.5 block font-medium text-[var(--accent-blue)] hover:underline"
              >
                {incident.related_task_uid}
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Involved users */}
      {incident.involved_users.length > 0 && (
        <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">涉及员工</h3>
          <div className="flex flex-wrap gap-2">
            {incident.involved_users.map((u) => (
              <div
                key={u.user_id}
                className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm"
              >
                <span className="font-medium text-[var(--text-primary)]">{u.user_name}</span>
                {u.involvement === 'primary' && (
                  <span className="rounded-full bg-[var(--accent-red)]/15 px-1.5 py-0.5 text-[10px] text-[var(--accent-red)]">主责</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirm/Reject status panel */}
      {isPending && (
        <div className="mb-6 rounded-2xl border border-[#f97316]/30 bg-[#f97316]/8 p-5">
          <p className="mb-4 text-sm font-medium text-[#f97316]">
            此 {incident.severity} 事故待 PMO 或 Boss 确认
          </p>
          {canManage && (
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmOpen(true)}
                className="flex-1 rounded-xl bg-[var(--accent-green)] py-2.5 text-sm font-medium text-white transition-all hover:bg-[var(--accent-green)]/90"
              >
                确认生效
              </button>
              <button
                onClick={() => setRejectOpen(true)}
                className="flex-1 rounded-xl border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 py-2.5 text-sm font-medium text-[var(--accent-red)] transition-all hover:bg-[var(--accent-red)]/20"
              >
                驳回
              </button>
            </div>
          )}
        </div>
      )}

      {isRejected && incident.reject_reason && (
        <div className="mb-6 rounded-2xl border border-[var(--text-muted)]/30 bg-[var(--text-muted)]/10 p-5">
          <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">驳回理由</p>
          <p className="text-sm text-[var(--text-secondary)]">{incident.reject_reason}</p>
        </div>
      )}

      {incident.confirm_status === 'confirmed' && incident.confirmed_at && (
        <div className="mb-6 rounded-2xl border border-[var(--accent-green)]/20 bg-[var(--accent-green)]/8 p-5">
          <p className="text-sm text-[var(--accent-green)]">
            已于 {new Date(incident.confirmed_at).toLocaleDateString('zh-CN')} 确认生效
          </p>
        </div>
      )}

      {/* Dialogs */}
      <IncidentConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleConfirm}
        incidentTitle={incident.title}
      />
      <IncidentRejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        onReject={handleReject}
        incidentTitle={incident.title}
      />
    </div>
  );
}

export default function IncidentDetailPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><p className="text-[var(--text-muted)]">加载中...</p></div>}>
      <IncidentDetailContent />
    </Suspense>
  );
}
