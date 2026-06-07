'use client';

/**
 * 技师私聊快捷功能条(仅技师视角)· 对齐客户端 QuickActionsBar,但功能是技师本人需要的。
 * B1:发素材 —— 从聊天素材库(已上传到 R2)选一张直接发给客户(手动,区别于 AI 分身自动撩拨发图)。
 * 后续可扩:发可约时段、快捷话术。
 */

import { useEffect, useState } from 'react';
import { ImageIcon, CalendarClock, MessageSquareText, X, Trash2 } from 'lucide-react';
import { apiGet } from '@/lib/api';

// 快捷话术 · 本机保存(per-device,零后端;选中填入输入框由技师确认后发送)
const QR_KEY = 'tech_quick_replies';
function loadQuickReplies(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(QR_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveQuickReplies(list: string[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(QR_KEY, JSON.stringify(list.slice(0, 30)));
}
const DEFAULT_QUICK_REPLIES = ['在的呀,亲~', '稍等我看下档期哦', '今天还有名额,要约吗?', '到啦记得跟我说一声~'];

interface ChatMediaItem {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  tier: string;
  isActive: number;
}

export function TherapistQuickBar({
  onSendImage,
  onScheduleOffer,
  onPickReply,
}: {
  onSendImage: (url: string) => void;
  onScheduleOffer: () => void | Promise<void>;
  onPickReply: (text: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [offering, setOffering] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  return (
    <>
      <div className="mb-2 flex gap-2 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setReplyOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-warm-100 bg-white px-3 py-1.5 text-[12px] font-medium text-ink-700 shadow-warm-xs transition active:scale-95"
        >
          <MessageSquareText className="h-3.5 w-3.5 text-primary" />
          快捷话术
        </button>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-warm-100 bg-white px-3 py-1.5 text-[12px] font-medium text-ink-700 shadow-warm-xs transition active:scale-95"
        >
          <ImageIcon className="h-3.5 w-3.5 text-primary" />
          发素材
        </button>
        <button
          type="button"
          disabled={offering}
          onClick={() => {
            setOffering(true);
            Promise.resolve(onScheduleOffer()).finally(() => setOffering(false));
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-warm-100 bg-white px-3 py-1.5 text-[12px] font-medium text-ink-700 shadow-warm-xs transition active:scale-95 disabled:opacity-50"
        >
          <CalendarClock className="h-3.5 w-3.5 text-primary" />
          {offering ? '生成中…' : '发可约时段'}
        </button>
      </div>
      {pickerOpen && (
        <MediaPickerSheet
          onClose={() => setPickerOpen(false)}
          onPick={(url) => {
            setPickerOpen(false);
            onSendImage(url);
          }}
        />
      )}
      {replyOpen && (
        <QuickReplySheet
          onClose={() => setReplyOpen(false)}
          onPick={(text) => {
            setReplyOpen(false);
            onPickReply(text);
          }}
        />
      )}
    </>
  );
}

function QuickReplySheet({ onClose, onPick }: { onClose: () => void; onPick: (text: string) => void }) {
  const [list, setList] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    const saved = loadQuickReplies();
    setList(saved.length ? saved : DEFAULT_QUICK_REPLIES);
  }, []);

  function add() {
    const t = draft.trim();
    if (!t) return;
    const next = [t, ...list.filter((x) => x !== t)].slice(0, 30);
    setList(next);
    saveQuickReplies(next);
    setDraft('');
  }
  function remove(text: string) {
    const next = list.filter((x) => x !== text);
    setList(next);
    saveQuickReplies(next);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div className="max-h-[70vh] w-full overflow-y-auto rounded-t-3xl bg-white pb-6" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-warm-50 bg-white px-5 py-3.5">
          <div className="text-serif-cn text-[15px] font-semibold text-ink-800">快捷话术</div>
          <button type="button" onClick={onClose} className="rounded-full p-1 active:bg-warm-50">
            <X className="h-5 w-5 text-ink-400" />
          </button>
        </div>
        <div className="flex items-center gap-2 px-4 py-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="加一条常用话术(本机保存)"
            className="flex-1 rounded-full bg-ink-50 px-3 py-2 text-[13px] text-ink-800 outline-none placeholder:text-ink-300"
            maxLength={120}
          />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim()}
            className="shrink-0 rounded-full bg-gradient-cta px-4 py-2 text-[13px] font-medium text-white shadow-rose-md disabled:opacity-50"
          >
            保存
          </button>
        </div>
        <div className="px-4">
          {list.map((text) => (
            <div key={text} className="flex items-center gap-2 border-b border-warm-50 py-1">
              <button
                type="button"
                onClick={() => onPick(text)}
                className="flex-1 rounded-xl px-2 py-2.5 text-left text-[13.5px] text-ink-800 transition active:bg-warm-50"
              >
                {text}
              </button>
              <button type="button" onClick={() => remove(text)} className="shrink-0 rounded-full p-2 active:bg-warm-50" aria-label="删除">
                <Trash2 className="h-4 w-4 text-ink-300" />
              </button>
            </div>
          ))}
        </div>
        <p className="px-5 pt-3 text-[10.5px] leading-5 text-ink-400">点一条填入输入框,确认后发送 · 话术存在本机</p>
      </div>
    </div>
  );
}

function MediaPickerSheet({ onClose, onPick }: { onClose: () => void; onPick: (url: string) => void }) {
  const [list, setList] = useState<ChatMediaItem[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await apiGet<ChatMediaItem[]>('/chat-media/me');
        setList(rows.filter((m) => m.isActive === 1)); // 只发启用的
      } catch {
        setList([]);
      }
    })();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="max-h-[70vh] w-full overflow-y-auto rounded-t-3xl bg-white pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-warm-50 bg-white px-5 py-3.5">
          <div className="text-serif-cn text-[15px] font-semibold text-ink-800">发送素材</div>
          <button type="button" onClick={onClose} className="rounded-full p-1 active:bg-warm-50">
            <X className="h-5 w-5 text-ink-400" />
          </button>
        </div>
        <div className="px-4 py-3 text-[11px] text-ink-400">
          从你的聊天素材库选一张发给客户 · 在「我的 → 聊天素材库」上传更多
        </div>

        {list === null ? (
          <div className="grid grid-cols-3 gap-2 px-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-xl bg-warm-100" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="px-6 py-10 text-center text-[13px] text-ink-400">
            素材库还是空的 · 去「我的 → 聊天素材库」上传第一张
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 px-4">
            {list.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onPick(m.url)}
                className="relative aspect-square overflow-hidden rounded-xl border border-warm-100 bg-warm-50 transition active:scale-95"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.thumbnailUrl || m.url}
                  alt="素材"
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                {m.tier === 'paid' && (
                  <span className="absolute right-1 top-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] text-white">
                    付费
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
