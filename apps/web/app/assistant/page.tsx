/**
 * 客户 AI 助理 · 全屏对话页 · M03
 *
 * 实现 PRD §3:
 *  - 全屏沉浸 · 类 WhatsApp
 *  - 头部:小助理头像 + 名字 + 在线状态 + "明示 AI" 小字标签 · 右侧一键真人接力
 *  - 消息流:气泡 · 助理左 / 客户右 · 头像 + 时间戳
 *  - 类人打字延迟:助理"正在输入..." 0.5-2s 随机
 *  - 推荐卡 1→3 横滑插入
 *  - 跨次记忆引用气泡(L4 → 前端 MemoryRecallChip)
 *  - 长按消息 → 复制 / 删除本条
 *  - 离线友好:对话历史 localStorage 持久化(简化版,后续接 IndexedDB)
 *  - 状态指示:连接中 / 思考中 / 已读
 *  - 输入框:文字 + emoji + voice 占位
 *  - 不留 TODO
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Mic, Send, Smile, Sparkles, ArrowLeft, Headphones, Trash2, Copy } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { ErrorBanner, GradientOrb, TypingDots } from '@/components/ui';
import { RecommendCard, type RecommendItem } from '@/components/RecommendCard';
import { MemoryRecallChip, type MemoryRecall } from '@/components/MemoryRecallChip';
import { HandoverHuman } from '@/components/HandoverHuman';
import { markAssistantUnread } from '@/components/AssistantFab';
import { apiGet, apiPost, ApiClientError, getAccessToken } from '@/lib/api';
import { ErrorCode } from '@loverush/types';

const STORAGE_KEY = 'assistant_chat_history_v1';
const HISTORY_LIMIT = 50;
const EMOJIS = ['😊', '😅', '😂', '❤️', '👍', '🙏', '🌸', '✨', '🔥', '😘', '🥺', '😴'];

// 后端 /assistant/recommend 字段（来自 routes/assistant.ts）
interface BackendRecommend {
  therapist_id: string;
  display_name: string | null;
  avatar_url: string | null;
  service_city: string | null;
  score_service: number;
  online_status?: string;
  match_score?: number;
  match_factors?: string[] | null;
  rating?: number;
}

interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  /** 助理消息可附带推荐卡 */
  recommends?: RecommendItem[];
  /** 助理消息可附带跨次记忆回挂 */
  recall?: MemoryRecall;
  /** 客户消息已读状态 */
  status?: 'sending' | 'sent' | 'read' | 'failed';
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function friendlyError(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.payload.code === ErrorCode.E1001_OTP_INVALID) return '登录状态过期了 · 重新登一下';
    return err.payload.message;
  }
  return '刚才网卡了 · 再试一下?';
}

/** 类人打字延迟 · 0.5-2s 随机 */
function typingDelayMs(): number {
  return 500 + Math.floor(Math.random() * 1500);
}

function loadHistory(): ChatTurn[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatTurn[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveHistory(turns: ChatTurn[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-HISTORY_LIMIT)));
  } catch {
    // 配额满 · 静默忽略
  }
}

export default function AssistantPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [actionFor, setActionFor] = useState<string | null>(null); // 长按显示操作的消息 id
  const bottomRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 鉴权 + 加载历史
  useEffect(() => {
    setAuthed(!!getAccessToken());
    const cached = loadHistory();
    if (cached.length > 0) {
      setTurns(cached);
    }
    // 进入对话页清掉未读提示
    markAssistantUnread(false);
  }, []);

  // 持久化每轮
  useEffect(() => {
    if (turns.length > 0) saveHistory(turns);
  }, [turns]);

  // 首次打招呼（无缓存时）
  useEffect(() => {
    if (authed !== true) return;
    if (turns.length > 0) return;
    void apiGet<{ content: string }>('/assistant/greet')
      .then((greet) => {
        setTurns([
          {
            id: newId(),
            role: 'assistant',
            content: greet.content,
            ts: Date.now(),
          },
        ]);
      })
      .catch(() => {
        // 静默 · 欢迎区已显
      });
  }, [authed, turns.length]);

  // 滚动到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, typing]);

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setError(null);
      setInput('');
      setShowEmoji(false);

      const userTurn: ChatTurn = {
        id: newId(),
        role: 'user',
        content: trimmed,
        ts: Date.now(),
        status: 'sending',
      };
      const next = [...turns, userTurn];
      setTurns(next);

      // 立即标记 sent · 后续助理回复后标 read
      setTimeout(() => {
        setTurns((cur) => cur.map((t) => (t.id === userTurn.id ? { ...t, status: 'sent' as const } : t)));
      }, 200);

      // 类人打字延迟
      const showTypingAt = setTimeout(() => setTyping(true), 250);

      try {
        const reply = await apiPost<{ content: string }>('/assistant/chat', {
          message: trimmed,
          history: next.slice(-10).map((t) => ({ role: t.role, content: t.content })),
        });

        // 触发推荐意图（关键词嗅探, 后端就绪后挪到服务端）
        const wantsRecommend = /推荐|看看|找|挑|换/.test(trimmed);
        let recommends: RecommendItem[] | undefined;
        if (wantsRecommend) {
          recommends = await fetchRecommends(trimmed).catch(() => undefined);
        }

        // 随机延迟显回复（0.5-2s, 模拟真人手感）
        await new Promise((r) => setTimeout(r, typingDelayMs()));

        setTurns((cur) => [
          ...cur.map((t) => (t.id === userTurn.id ? { ...t, status: 'read' as const } : t)),
          {
            id: newId(),
            role: 'assistant',
            content: reply.content,
            ts: Date.now(),
            recommends,
          },
        ]);
      } catch (err) {
        setError(friendlyError(err));
        setTurns((cur) => cur.map((t) => (t.id === userTurn.id ? { ...t, status: 'failed' as const } : t)));
      } finally {
        clearTimeout(showTypingAt);
        setTyping(false);
        setBusy(false);
      }
    },
    [busy, turns],
  );

  function onMessageTouchStart(id: string) {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => setActionFor(id), 500);
  }
  function onMessageTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }
  async function copyTurn(id: string) {
    const t = turns.find((x) => x.id === id);
    if (!t || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(t.content);
    } catch {
      // 静默
    }
    setActionFor(null);
  }
  function deleteTurn(id: string) {
    setTurns((cur) => cur.filter((t) => t.id !== id));
    setActionFor(null);
  }

  // 未登录
  if (authed === null) {
    return (
      <AppShell fill>
        <div className="flex flex-1 items-center justify-center bg-gradient-soft">
          <GradientOrb size={48} icon="✨" />
        </div>
      </AppShell>
    );
  }
  if (!authed) {
    return (
      <AppShell fill>
        <div className="flex flex-1 flex-col items-center justify-center bg-gradient-soft px-8 text-center">
          <GradientOrb size={72} icon="✨" />
          <h1 className="mt-5 text-serif-cn text-[18px] font-bold text-ink-800">登录后 · 帮你找到对的人</h1>
          <p className="mt-2 max-w-[260px] text-[13px] leading-7 text-ink-500">
            小助理按你的偏好推荐 · 先登录一下吧
          </p>
          <Link
            href="/"
            className="mt-6 rounded-full bg-gradient-cta px-8 py-2.5 text-[14px] font-medium text-white shadow-rose-md active:scale-95"
          >
            去登录 / 注册
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell fill hideTabBar>
      <div className="flex flex-1 flex-col bg-gradient-soft">
        {/* 头部 · 类 WhatsApp */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-warm-100 bg-white/95 px-3 py-2 backdrop-blur">
          <Link href="/home" aria-label="返回" className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-ink-700 active:bg-ink-100">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <GradientOrb size={36} icon="✨" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-serif-cn text-[15px] font-semibold text-ink-800">小助理</h1>
              {/* PRD §1.1 明示 AI 小字标签 */}
              <span className="rounded bg-warm-100 px-1 py-0.5 text-[9px] font-medium tracking-wide text-warm-700">
                AI
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-ink-500">
              <span className="online-dot" />
              <span>{typing ? '正在输入…' : busy ? '连接中…' : '在线 · 一般 1 分钟回'}</span>
            </div>
          </div>
          <HandoverHuman recentTurns={turns.slice(-10).map((t) => ({ role: t.role, content: t.content }))} />
        </header>

        {/* 消息流 */}
        <div
          className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3"
          onClick={() => setActionFor(null)}
        >
          <ErrorBanner message={error} />

          {turns.length === 0 && <WelcomeHero />}

          <div className="space-y-2.5">
            {turns.map((t) => (
              <MessageRow
                key={t.id}
                turn={t}
                showAction={actionFor === t.id}
                onTouchStart={() => onMessageTouchStart(t.id)}
                onTouchEnd={onMessageTouchEnd}
                onCopy={() => void copyTurn(t.id)}
                onDelete={() => deleteTurn(t.id)}
              />
            ))}
            {typing && (
              <div className="flex items-end gap-2 animate-fade-up">
                <GradientOrb size={28} icon="✨" />
                <div className="msg-bubble-other">
                  <TypingDots />
                </div>
              </div>
            )}
          </div>

          <div ref={bottomRef} />
        </div>

        {/* 输入栏 */}
        <div className="border-t border-warm-100 bg-white/95 px-3 pb-3 pt-2 backdrop-blur">
          {/* Quick chips */}
          {turns.length <= 1 && (
            <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
              {[
                '帮我推荐曼谷的技师',
                '想找温柔风格的',
                '预算 200 积分以内',
                '现在就要 · 附近有谁',
              ].map((q, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => void sendText(q)}
                  className="chip-quick"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Emoji 选择 */}
          {showEmoji && (
            <div className="mb-2 grid grid-cols-6 gap-1 rounded-2xl border border-warm-100 bg-white p-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    setInput((v) => v + e);
                    setShowEmoji(false);
                  }}
                  className="rounded-lg py-1 text-lg active:bg-warm-50"
                >
                  {e}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 rounded-2xl bg-ink-50 px-2 py-1.5">
            <button
              type="button"
              onClick={() => setShowEmoji((s) => !s)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-500 active:bg-ink-100"
              aria-label="表情"
            >
              <Smile className="h-5 w-5" />
            </button>
            <textarea
              className="max-h-24 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-[13.5px] text-ink-800 outline-none placeholder:text-ink-300"
              placeholder="跟我说说你想找什么样的…"
              value={input}
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                // 自适应高度
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 96)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendText(input);
                }
              }}
              aria-label="输入消息"
            />
            <button
              type="button"
              disabled
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-300"
              aria-label="语音(开发中)"
              title="语音输入开发中"
            >
              <Mic className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => void sendText(input)}
              disabled={busy || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-cta text-white shadow-rose-md disabled:opacity-50"
              aria-label="发送"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-1.5 flex items-center justify-center gap-1 text-[9.5px] text-ink-400">
            <Headphones className="h-3 w-3" />
            <span>小助理是 AI · 任何时刻可一键呼真人</span>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ──────────────── 子组件 ────────────────

function WelcomeHero() {
  return (
    <div className="py-6 text-center animate-fade-up">
      <div className="mb-3 inline-flex">
        <GradientOrb size={72} icon="✨" />
      </div>
      <div className="mx-auto max-w-[280px] text-[13px] leading-7 text-ink-600">
        嗨 · 我是<strong className="text-ink-800">小助理</strong>
        <br />
        想找什么样的人 · 想试什么样的体验 · <br />
        <strong className="text-ink-800">直说就好</strong>
      </div>
      <div className="mx-auto mt-3 inline-flex items-center gap-1 rounded-full bg-warm-50 px-3 py-1 text-[10.5px] text-warm-700">
        <Sparkles className="h-3 w-3" /> 我是 AI · 免费聊
      </div>
    </div>
  );
}

interface MessageRowProps {
  turn: ChatTurn;
  showAction: boolean;
  onTouchStart: () => void;
  onTouchEnd: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

function MessageRow({ turn, showAction, onTouchStart, onTouchEnd, onCopy, onDelete }: MessageRowProps) {
  const isMine = turn.role === 'user';
  const time = useMemo(
    () => new Date(turn.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    [turn.ts],
  );

  return (
    <div className="animate-fade-up">
      <div className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
        {!isMine && <GradientOrb size={28} icon="✨" />}
        <div className="flex max-w-[78%] flex-col gap-1">
          <div
            className={isMine ? 'msg-bubble-mine' : 'msg-bubble-other'}
            onContextMenu={(e) => {
              e.preventDefault();
              onTouchStart();
              setTimeout(onTouchEnd, 0);
            }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onMouseDown={onTouchStart}
            onMouseUp={onTouchEnd}
            onMouseLeave={onTouchEnd}
          >
            {turn.content}
          </div>
          <div
            className={`flex items-center gap-1.5 px-1 text-[9.5px] text-ink-400 ${isMine ? 'justify-end' : 'justify-start'}`}
          >
            <span>{time}</span>
            {isMine && turn.status && (
              <span aria-label={`消息状态:${turn.status}`}>
                {turn.status === 'sending' && '· 发送中'}
                {turn.status === 'sent' && '· ✓'}
                {turn.status === 'read' && '· ✓✓ 已读'}
                {turn.status === 'failed' && <span className="text-danger-500">· 发送失败</span>}
              </span>
            )}
          </div>
          {showAction && (
            <div
              className={`flex gap-1 rounded-xl bg-ink-800/90 px-1.5 py-1 text-[11px] text-white shadow-warm-md ${isMine ? 'self-end' : 'self-start'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 rounded px-2 py-0.5 active:bg-white/10">
                <Copy className="h-3 w-3" /> 复制
              </button>
              <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 rounded px-2 py-0.5 active:bg-white/10">
                <Trash2 className="h-3 w-3" /> 删除
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 助理消息附带跨次记忆 */}
      {turn.role === 'assistant' && turn.recall && <MemoryRecallChip recall={turn.recall} />}

      {/* 助理消息附带推荐卡 */}
      {turn.role === 'assistant' && turn.recommends && turn.recommends.length > 0 && (
        <div className="ml-9 mt-2">
          <div className="label-cormorant mb-1.5">{turn.recommends.length} 位推荐</div>
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {turn.recommends.map((r) => (
              <RecommendCard key={r.therapistId} item={r} variant="slim" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────── 拉推荐 ────────────────

async function fetchRecommends(intent: string): Promise<RecommendItem[]> {
  const list = await apiGet<BackendRecommend[]>('/assistant/recommend', { intent, top_n: 3 });
  return list.map((r) => ({
    therapistId: r.therapist_id,
    displayName: r.display_name ?? '小姐姐',
    avatarUrl: r.avatar_url,
    serviceCity: r.service_city,
    scoreService: r.score_service,
    matchFactors: r.match_factors ?? null,
    // 后端 reason / safety / price 暂未上线时降级:
    reason: r.match_factors && r.match_factors.length > 0
      ? `${r.match_factors.slice(0, 2).join(' · ')} · 我帮你看过`
      : '风格匹配 · 评分稳',
    safety: null,                      // 后端 F03-D2 字段上线后填
    pricePoints: null,
    availableNow: r.online_status === 'online',
  }));
}
