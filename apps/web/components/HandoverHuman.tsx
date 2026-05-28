/**
 * 一键真人接力按钮 · M03 F03-A5
 *
 * 浮在对话界面顶部 · 永久可见 · 不藏三级菜单
 *
 * 点击 → POST /assistant/handover-human
 *   - 后端 endpoint 待联调（M03 实施清单 §3）。
 *     当前调用如返回 404/500 等错误：前端降级跳转到 /me/assistant-handover 给客户解释 + 工单创建入口
 *   - 成功后跳转 ticket 详情
 *
 * SLA 提示:"客服 5 分钟内接通"
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Headphones, Loader2 } from 'lucide-react';
import { apiPost, ApiClientError } from '@/lib/api';

interface HandoverHumanProps {
  /** 移动顶部条形或独立按钮 · default=topbar 嵌入对话页头 */
  variant?: 'topbar' | 'standalone';
  /** 传入当前对话上下文给客服系统（最多 10 条） */
  recentTurns?: { role: 'user' | 'assistant'; content: string }[];
}

export function HandoverHuman({ variant = 'topbar', recentTurns = [] }: HandoverHumanProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handover() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ ticket_id?: string; ticketId?: string }>(
        '/assistant/handover-human',
        {
          context: recentTurns.slice(-10),
          source: 'assistant_chat',
        },
      );
      const ticketId = res.ticket_id ?? res.ticketId;
      if (ticketId) {
        router.push(`/tickets/${ticketId}`);
        return;
      }
      // 没拿到 ticketId 也兜底进 handover 页
      router.push('/me/assistant-handover');
    } catch (err) {
      // 后端未上线时降级到引导页
      const msg = err instanceof ApiClientError ? err.payload.message : '网络不给力 · 跳转到客服入口';
      setError(msg);
      // 端点未实现 / 404 → 引导页解释 + 提交工单
      router.push('/me/assistant-handover');
    } finally {
      setBusy(false);
    }
  }

  if (variant === 'standalone') {
    return (
      <button
        type="button"
        onClick={() => void handover()}
        disabled={busy}
        className="btn-ghost"
        aria-label="呼叫真人客服"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Headphones className="h-4 w-4" />}
        <span className="ml-2">{busy ? '正在转接…' : '呼叫真人客服'}</span>
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void handover()}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-full border border-warm-200 bg-warm-50 px-2.5 py-1 text-[11px] text-ink-700 transition active:scale-95 disabled:opacity-60"
        aria-label="呼叫真人客服 · 5 分钟内接通"
        title="客服 5 分钟内接通"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Headphones className="h-3 w-3" />}
        <span>真人</span>
      </button>
      {error && (
        <div className="absolute right-0 top-full mt-1 whitespace-nowrap rounded bg-ink-800/90 px-2 py-1 text-[10px] text-white shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}
