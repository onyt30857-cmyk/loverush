/**
 * 一键真人接力 · M03 F03-A5
 *
 * 客户从 FAB / 对话顶部 / 助理记忆页进来:
 *  - 解释"接下来会发生什么"
 *  - 提交按钮:POST /assistant/handover-human → 创建客服工单 → 跳转 ticket 页
 *  - SLA: 5 分钟内接通
 *  - 端点未上线降级:创建普通工单走 /tickets
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Headphones, Timer, MessageCircle } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { ErrorBanner } from '@/components/ui';
import { apiPost, ApiClientError } from '@/lib/api';

export default function AssistantHandoverPage() {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // 优先 M03 端点
      const r = await apiPost<{ ticket_id?: string; ticketId?: string }>(
        '/assistant/handover-human',
        { reason: reason.trim() || '客户主动呼叫真人' },
      ).catch(async (err) => {
        // 端点未上线 · 走通用工单
        if (err instanceof ApiClientError && (err.payload.code === 'E0000' || err.payload.code === 'E9999')) {
          return apiPost<{ ticket_id?: string; ticketId?: string }>('/tickets', {
            category: 'assistant_handover',
            content: reason.trim() || '我想找真人客服聊聊',
          });
        }
        throw err;
      });
      const id = r.ticket_id ?? r.ticketId;
      if (id) {
        router.push(`/tickets/${id}`);
      } else {
        // 没拿到 id · 回 me 页 + 提示
        router.push('/me');
      }
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError('网络不给力 · 再试一下');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="呼叫真人客服" showBack hideTabBar>
      <div className="bg-gradient-soft px-5 pb-4 pt-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-cta text-white shadow-rose-md">
            <Headphones className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-serif-cn text-[16px] font-bold text-ink-800">真人客服来接</h1>
            <p className="mt-0.5 text-[11px] text-ink-500">小助理先退一下 · 后面真人来</p>
          </div>
        </div>
      </div>

      <div className="space-y-3 px-5 py-4">
        <ErrorBanner message={error} />

        {/* SLA */}
        <div className="flex items-center gap-3 rounded-2xl border border-success-500/30 bg-success-500/5 p-3.5">
          <Timer className="h-5 w-5 text-success-500" />
          <div>
            <div className="text-[13px] font-semibold text-ink-800">5 分钟内接通</div>
            <div className="mt-0.5 text-[11px] text-ink-500">营业时间 09:00–01:00 · 全年无休</div>
          </div>
        </div>

        {/* 客户先描述 */}
        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <label className="block">
            <span className="text-[12px] font-medium text-ink-700">想跟客服聊什么? (可选)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="例:订单异常 / 投诉技师 / 隐私问题 / 其他"
              className="mt-2 w-full resize-none rounded-xl border border-warm-100 bg-warm-50/50 p-3 text-[13px] text-ink-800 outline-none placeholder:text-ink-300 focus:border-primary focus:bg-white"
            />
            <div className="mt-1 text-right text-[10px] text-ink-400">{reason.length}/500</div>
          </label>
        </div>

        {/* 接下来会怎样 */}
        <div className="rounded-2xl border border-warm-100 bg-white p-4 text-[12px] leading-6 text-ink-600 shadow-warm-xs">
          <div className="mb-2 flex items-center gap-1.5 font-semibold text-ink-800">
            <MessageCircle className="h-4 w-4 text-warm-500" />
            接下来会怎样
          </div>
          <ol className="ml-4 list-decimal space-y-1">
            <li>小助理把最近对话上下文打包给客服</li>
            <li>客服 5 分钟内开窗回你</li>
            <li>整个会话有凭证 · 不丢失 · 你不用再讲一遍</li>
          </ol>
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="btn-primary"
        >
          {busy ? '正在转接…' : '现在呼叫真人客服'}
        </button>

        <Link href="/assistant" className="block text-center text-[11px] text-ink-500 underline">
          算了 · 继续跟小助理聊
        </Link>
      </div>
    </AppShell>
  );
}
