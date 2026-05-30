/**
 * 审核状态徽章 · M11 Phase 1
 *
 * pending = 橙(审核中) / approved = 绿(已通过) / rejected = 红 + 原因
 */
'use client';

export type AuditStatus = 'pending' | 'approved' | 'rejected';

export function AuditBadge({
  status,
  rejectReason,
}: {
  status: AuditStatus;
  rejectReason?: string | null;
}) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-500/10 px-2 py-0.5 text-[10px] font-medium text-success-500">
        ✓ 已通过
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span
        title={rejectReason ?? '已驳回 · 请联系客服了解原因'}
        className="inline-flex items-center gap-1 rounded-full bg-danger-500/10 px-2 py-0.5 text-[10px] font-medium text-danger-500"
      >
        ✗ 已驳回{rejectReason ? `：${rejectReason.slice(0, 14)}${rejectReason.length > 14 ? '…' : ''}` : ''}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning-500/10 px-2 py-0.5 text-[10px] font-medium text-warning-500">
      ⏳ 审核中
    </span>
  );
}
