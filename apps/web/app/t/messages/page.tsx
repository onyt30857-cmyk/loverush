'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, Sparkles, Settings } from 'lucide-react';
import { TherapistShell } from '@/components/AppShell';
import { ConversationListItem } from '@/components/chat/ConversationListItem';
import { useDialog } from '@/components/UIDialog';
import { apiGet, apiPost } from '@/lib/api';

interface Conv {
  id: string;
  customerId: string;
  therapistUserId: string;
  messageCount: number;
  lastMessageAt: string | null;
  status: string;
  unreadCount: number;
  lastMessagePreview: { senderUserId: string; body: string; sentAt: string; isEncrypted: boolean } | null;
  counterpartyUserId: string;
  counterpartyDisplayName: string | null;
  counterpartyAvatarUrl: string | null;
}

export default function TherapistMessagesPage() {
  const [list, setList] = useState<Conv[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<Conv[]>('/conversations');
        setList(data);
      } catch {
        setList([]);
      }
    })();
  }, []);

  return (
    <TherapistShell>
      <div className="min-h-full bg-gradient-soft">
        {/* M06 · AI 分身 banner · 让技师每次进私聊都看见 AI 在工作 */}
        <AiAlterBanner />

        {list === null ? (
          <ul className="space-y-2 px-5 py-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-2xl bg-white/60 p-3 shadow-warm-xs"
              >
                <div className="h-12 w-12 shrink-0 rounded-full bg-warm-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/3 rounded bg-warm-100" />
                  <div className="h-3 w-2/3 rounded bg-warm-100/70" />
                </div>
              </li>
            ))}
          </ul>
        ) : list.length === 0 ? (
          <div className="mt-12 flex flex-col items-center px-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-warm-sm">
              <MessageCircle className="h-7 w-7 text-primary" />
            </div>
            <div className="mt-3 text-serif-cn text-[15px] font-semibold text-ink-800">
              还没有会话
            </div>
            <div className="mt-1.5 text-[12px] leading-5 text-ink-500">
              客户来咨询后,对话会出现在这里
            </div>
            <Link
              href="/t/me/profile"
              className="mt-4 inline-flex items-center gap-1 rounded-full bg-white px-4 py-2 text-[12px] text-ink-700 shadow-warm-xs active:scale-95"
            >
              完善档案 · 提升被挑中概率 →
            </Link>
          </div>
        ) : (
          <ul className="mx-4 my-4 overflow-hidden rounded-2xl border border-warm-100 bg-white shadow-warm-xs divide-y divide-warm-50">
            {list.map((c) => (
              <li key={c.id}>
                <ConversationListItem
                  href={`/t/messages/${c.id}`}
                  counterpartyDisplayName={c.counterpartyDisplayName}
                  counterpartyAvatarUrl={c.counterpartyAvatarUrl}
                  fallbackName={`客户 ${c.customerId.slice(0, 6)}`}
                  lastMessagePreview={c.lastMessagePreview}
                  lastMessageAt={c.lastMessageAt}
                  unreadCount={c.unreadCount ?? 0}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </TherapistShell>
  );
}

// M06 · AI 分身 banner · 私聊列表头部
interface AiAlterToday {
  enabled: boolean;
  kill_switch_reason: string | null;
  today_message_count: number;
  today_conversation_count: number;
}

function AiAlterBanner() {
  const { confirm, alert } = useDialog();
  const [stats, setStats] = useState<AiAlterToday | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<AiAlterToday>('/therapists/me/ai-alter/today');
      setStats(data);
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!stats) return null;
  const isKilled = stats.kill_switch_reason != null;

  async function toggle() {
    if (!stats) return;
    if (isKilled) {
      await alert({
        title: '已被平台暂停',
        message: `原因: ${stats.kill_switch_reason}\n\n请联系运营恢复 · 暂时无法自助开启`,
      });
      return;
    }
    const next = !stats.enabled;
    const ok = await confirm({
      title: next ? '开启 AI 分身?' : '关闭 AI 分身?',
      message: next
        ? 'AI 分身将替你自动回复客户消息 · 你随时可以发消息接管对话'
        : '关闭后客户消息你需要亲自回复 · 24h 内未回的客户可能流失',
      confirmText: next ? '开启' : '关闭',
      danger: !next,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await apiPost('/therapists/me/ai-alter/configure', { enabled: next });
      setStats({ ...stats, enabled: next });
    } catch (err) {
      await alert({ title: '操作失败', message: String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 pt-3">
      <div
        className="rounded-2xl border px-4 py-3 shadow-warm-xs"
        style={{
          background: stats.enabled
            ? 'linear-gradient(135deg, #FFF0F5 0%, #FFE5EE 100%)'
            : '#FAFAFA',
          borderColor: stats.enabled ? 'rgba(255, 87, 119, 0.2)' : 'rgba(0,0,0,0.05)',
        }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${stats.enabled ? 'bg-gradient-cta' : 'bg-warm-100'}`}>
              <Sparkles className={`h-4 w-4 ${stats.enabled ? 'text-white' : 'text-warm-500'}`} />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-ink-800 text-serif-cn">AI 分身</div>
              <div className="text-[10px] text-ink-500">
                {isKilled ? '⛔ 被平台暂停' : stats.enabled ? '🟢 工作中' : '已关闭'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Link
              href="/t/me/ai-alter"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/60 active:scale-95"
              aria-label="设置"
            >
              <Settings className="h-3.5 w-3.5 text-ink-600" />
            </Link>
            <button
              type="button"
              onClick={() => void toggle()}
              disabled={busy || isKilled}
              className={`relative flex h-7 w-12 items-center rounded-full transition disabled:opacity-50 ${
                stats.enabled ? 'bg-gradient-cta' : 'bg-ink-200'
              }`}
              aria-label={stats.enabled ? '关闭 AI 分身' : '开启 AI 分身'}
            >
              <span
                className={`absolute h-6 w-6 rounded-full bg-white shadow transition-transform ${
                  stats.enabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        {stats.enabled && (
          <div className="text-[12px] text-ink-700 leading-relaxed">
            今日代发 <span className="font-bold text-primary num">{stats.today_message_count}</span> 条 · 帮你接了 <span className="font-bold text-primary num">{stats.today_conversation_count}</span> 个客户
            {stats.today_message_count > 0 && (
              <Link href="/t/me/ai-alter" className="ml-1 text-[11px] text-warm-700">详情 →</Link>
            )}
          </div>
        )}
        {!stats.enabled && !isKilled && (
          <div className="text-[11px] text-ink-500">
            开启后 AI 替你自动回复客户 · 不让你错过任何一单
          </div>
        )}
        {isKilled && (
          <div className="text-[11px] text-danger-500">
            {stats.kill_switch_reason} · 请联系运营恢复
          </div>
        )}
      </div>
    </div>
  );
}
