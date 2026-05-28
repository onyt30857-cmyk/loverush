/**
 * 助理对话核心 hook · M03 v3
 *
 * 抽取自 /assistant/chat/page.tsx 的 sendText / 类人打字延迟 / 推荐拉取 · 让
 * /assistant home 的 inline chat(HomeChatStream) 和全屏 /assistant/chat 复用.
 *
 * 提供:
 *  - turns / setTurns
 *  - sendText(text)
 *  - typing / busy / error
 *  - prefillText / setPrefillText  (供外部预填输入框)
 *
 * 注意:home inline chat 不持久化历史(每次进 home 重置),全屏 chat 自管 storage.
 */
'use client';

import { useCallback, useState } from 'react';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';
import { ErrorCode } from '@loverush/types';
import type { RecommendItem } from '@/components/RecommendCard';
import type { MemoryRecall } from '@/components/MemoryRecallChip';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  recommends?: RecommendItem[];
  recall?: MemoryRecall;
  status?: 'sending' | 'sent' | 'read' | 'failed';
}

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

export function newTurnId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function friendlyError(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.payload.code === ErrorCode.E1001_OTP_INVALID) return '登录状态过期了 · 重新登一下';
    return err.payload.message;
  }
  return '刚才网卡了 · 再试一下?';
}

export function typingDelayMs(): number {
  return 500 + Math.floor(Math.random() * 1500);
}

async function fetchRecommends(intent: string): Promise<RecommendItem[]> {
  const list = await apiGet<BackendRecommend[]>('/assistant/recommend', { intent, top_n: 3 });
  return list.map((r) => ({
    therapistId: r.therapist_id,
    displayName: r.display_name ?? '小姐姐',
    avatarUrl: r.avatar_url,
    serviceCity: r.service_city,
    scoreService: r.score_service,
    matchFactors: r.match_factors ?? null,
    reason:
      r.match_factors && r.match_factors.length > 0
        ? `${r.match_factors.slice(0, 2).join(' · ')} · 我帮你看过`
        : '风格匹配 · 评分稳',
    safety: null,
    pricePoints: null,
    availableNow: r.online_status === 'online',
  }));
}

/**
 * useAssistantChat · 通用对话状态机
 *
 * @param initial 初始 turns(全屏页可传 storage 恢复,home inline 传 [])
 * @param onAfterSend 每次发送后回调(用于持久化等副作用)
 */
export function useAssistantChat(
  initial: ChatTurn[] = [],
  onAfterSend?: (turns: ChatTurn[]) => void,
) {
  const [turns, setTurns] = useState<ChatTurn[]>(initial);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setError(null);

      const userTurn: ChatTurn = {
        id: newTurnId(),
        role: 'user',
        content: trimmed,
        ts: Date.now(),
        status: 'sending',
      };

      let nextTurns: ChatTurn[] = [];
      setTurns((cur) => {
        nextTurns = [...cur, userTurn];
        return nextTurns;
      });

      setTimeout(() => {
        setTurns((cur) =>
          cur.map((t) => (t.id === userTurn.id ? { ...t, status: 'sent' as const } : t)),
        );
      }, 200);

      const showTypingAt = setTimeout(() => setTyping(true), 250);

      try {
        const reply = await apiPost<{ content: string }>('/assistant/chat', {
          message: trimmed,
          history: nextTurns.slice(-10).map((t) => ({ role: t.role, content: t.content })),
        });

        const wantsRecommend = /推荐|看看|找|挑|换/.test(trimmed);
        let recommends: RecommendItem[] | undefined;
        if (wantsRecommend) {
          recommends = await fetchRecommends(trimmed).catch(() => undefined);
        }

        await new Promise((r) => setTimeout(r, typingDelayMs()));

        let finalTurns: ChatTurn[] = [];
        setTurns((cur) => {
          finalTurns = [
            ...cur.map((t) => (t.id === userTurn.id ? { ...t, status: 'read' as const } : t)),
            {
              id: newTurnId(),
              role: 'assistant',
              content: reply.content,
              ts: Date.now(),
              recommends,
            },
          ];
          return finalTurns;
        });
        // 副作用回调(持久化等)
        if (onAfterSend) onAfterSend(finalTurns);
      } catch (err) {
        setError(friendlyError(err));
        setTurns((cur) =>
          cur.map((t) => (t.id === userTurn.id ? { ...t, status: 'failed' as const } : t)),
        );
      } finally {
        clearTimeout(showTypingAt);
        setTyping(false);
        setBusy(false);
      }
    },
    [busy, onAfterSend],
  );

  return {
    turns,
    setTurns,
    busy,
    typing,
    error,
    setError,
    sendText,
  };
}
