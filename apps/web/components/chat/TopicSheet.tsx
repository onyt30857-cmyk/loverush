/**
 * 找话题 BottomSheet · LLM 基于技师档案生成 3 个开场白让客户挑
 *
 * 流程:
 *   1. 打开 sheet · 调 GET /assistant/topics?therapist_id=xxx
 *   2. loading shimmer 等 LLM 返
 *   3. 显 3 个气泡选项 · 客户点 → 自动填到输入框(不强发送 · 用户可再编辑)
 *   4. "换一批" 按钮重新调 LLM(随机种子换文)
 */
'use client';

import { useEffect, useState } from 'react';
import { X, MessagesSquare, RefreshCw, Sparkles } from 'lucide-react';
import { apiGet, ApiClientError } from '@/lib/api';

export interface TopicSheetProps {
  isOpen: boolean;
  /** 技师 therapist.id */
  therapistId: string;
  therapistName?: string | null;
  onClose: () => void;
  /** 选中一句话 · 父组件填到输入框(不自动发送) */
  onPickTopic: (text: string) => void;
}

export function TopicSheet({ isOpen, therapistId, therapistName, onClose, onPickTopic }: TopicSheetProps) {
  const [topics, setTopics] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchTopics() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ topics: string[] }>(`/assistant/topics?therapist_id=${therapistId}`);
      setTopics(res.topics ?? []);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError('生成失败 · 再试一次');
      // 失败兜底:也展示一些静态话题给用户用
      setTopics([
        '看了你介绍 想聊聊',
        '今晚有空吗 想见见你',
        '你最近怎么样?',
      ]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isOpen && topics === null) void fetchTopics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  function pick(t: string) {
    onPickTopic(t);
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] rounded-t-3xl bg-white shadow-2xl">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-ink-200" />
        <div className="flex items-center justify-between px-5 pt-3 pb-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-serif-cn text-base font-semibold text-ink-900">
              <MessagesSquare className="h-4 w-4 text-amber-500" strokeWidth={2.2} />
              聊点啥
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-500">
              基于 {therapistName || '她'} 的介绍 · 选一句直接发
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-100/60 active:bg-ink-200"
            aria-label="关闭"
          >
            <X className="h-4 w-4 text-ink-600" />
          </button>
        </div>

        <div className="px-5 pb-5">
          {loading ? (
            <div className="space-y-2.5 py-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-2xl bg-gradient-to-r from-warm-100/40 via-warm-100/70 to-warm-100/40"
                />
              ))}
              <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-ink-500">
                <Sparkles className="h-3 w-3 animate-spin text-amber-500" />
                <span>AI 正在为你想…</span>
              </div>
            </div>
          ) : topics && topics.length > 0 ? (
            <>
              {error && (
                <div className="mb-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
                  {error} · 先用兜底版凑合
                </div>
              )}
              <div className="space-y-2.5">
                {topics.map((t, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pick(t)}
                    className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-warm-100 bg-gradient-to-r from-white to-warm-50/40 px-4 py-3 text-left transition active:scale-[0.98] active:bg-warm-50"
                  >
                    <span className="text-[14px] leading-relaxed text-ink-800">{t}</span>
                    <span className="shrink-0 text-[10.5px] text-ink-400 group-hover:text-primary">填到输入框</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void fetchTopics()}
                disabled={loading}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-amber-50 py-2 text-[12px] font-medium text-amber-700 active:bg-amber-100 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>换一批</span>
              </button>
            </>
          ) : (
            <div className="py-8 text-center text-[12px] text-ink-500">没生成出来 · 再试一次</div>
          )}
        </div>
      </div>
    </>
  );
}
