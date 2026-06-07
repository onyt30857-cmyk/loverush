/**
 * 订单操作常驻条 · OrderActionRibbon(M-OAC)
 *
 * 对话页顶部:该会话若有进行中订单,常驻显示"订单号 · 状态 + 当前主操作按钮"。
 * 技师一进对话不用滚就能确认接单/收款/开始/完成。viewer-aware:viewerActions 由后端按身份算。
 * 无进行中订单 → 渲染 null(不占位)。
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, ChevronRight } from 'lucide-react';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';

const STATUS_LABEL: Record<string, string> = {
  PENDING_CONFIRM: '待确认',
  LOCKED: '已锁定',
  PAID: '已付款',
  IN_SERVICE: '服务中',
};

// 技师主路径操作 → {端点, 简短按钮文案}
const INLINE: Record<string, { endpoint: string; label: string }> = {
  confirm: { endpoint: 'confirm', label: '确认接单' },
  confirm_offline_paid: { endpoint: 'confirm-offline-paid', label: '确认收款' },
  start: { endpoint: 'start', label: '开始服务' },
  complete: { endpoint: 'complete', label: '标记完成' },
};

interface Summary {
  orderId: string;
  orderNo: string;
  status: string;
  viewerActions: string[];
}

interface Props {
  conversationId: string;
  refreshKey?: number;
  onActed?: () => void;
  onOpen?: (orderId: string) => void;
}

export function OrderActionRibbon({ conversationId, refreshKey = 0, onActed, onOpen }: Props) {
  const [sum, setSum] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet<Summary | null>('/orders/active-for-conversation', { conversationId })
      .then((d) => {
        if (alive) setSum(d);
      })
      .catch(() => {
        if (alive) setSum(null);
      });
    return () => {
      alive = false;
    };
  }, [conversationId, refreshKey]);

  const primary = sum?.viewerActions.find((a) => a in INLINE);

  const run = useCallback(async () => {
    if (!sum || !primary || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await apiPost(`/orders/${sum.orderId}/${INLINE[primary]!.endpoint}`);
      onActed?.();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.payload.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }, [sum, primary, busy, onActed]);

  if (!sum) return null;
  const statusLabel = STATUS_LABEL[sum.status] ?? sum.status;

  return (
    <div className="flex items-center gap-2 border-b border-warm-100 bg-gradient-to-r from-warm-50 to-white px-4 py-2">
      <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
      <button
        type="button"
        onClick={() => onOpen?.(sum.orderId)}
        className="flex min-w-0 flex-1 items-center gap-1 text-left"
      >
        <span className="truncate text-[12px] text-ink-600">
          订单 {sum.orderNo} · <span className="font-semibold text-ink-800">{statusLabel}</span>
        </span>
        <ChevronRight className="h-3 w-3 shrink-0 text-ink-300" />
      </button>
      {err ? (
        <span className="shrink-0 text-[11px] text-red-500">{err}</span>
      ) : primary ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run()}
          className="shrink-0 rounded-full bg-primary px-3 py-1 text-[12px] font-semibold text-white transition active:scale-95 disabled:opacity-60"
        >
          {busy ? '处理中…' : INLINE[primary]!.label}
        </button>
      ) : null}
    </div>
  );
}
