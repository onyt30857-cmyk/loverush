'use client';

import { useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ErrorBanner, GradientOrb, RecCard, TypingDots } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';

interface Recommend {
  therapist_id: string;
  display_name: string | null;
  avatar_url: string | null;
  score_service: number;
  service_city: string | null;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  { emoji: '🌸', text: '帮我推荐曼谷的技师' },
  { emoji: '💭', text: '我想要温柔风格的' },
  { emoji: '💰', text: '预算 200 积分以内' },
  { emoji: '🎁', text: '附近有什么新人优惠' },
];

export default function AssistantPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommend, setRecommend] = useState<Recommend[]>([]);
  const [greetingLoaded, setGreetingLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const greet = await apiGet<{ content: string }>('/assistant/greet');
        setTurns([{ role: 'assistant', content: greet.content }]);
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
      } finally {
        setGreetingLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, busy]);

  async function sendText(text: string) {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setInput('');
    const newTurns: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(newTurns);
    try {
      const reply = await apiPost<{ content: string }>('/assistant/chat', {
        message: text,
        history: newTurns.slice(-10).map((t) => ({ role: t.role, content: t.content })),
      });
      setTurns([...newTurns, { role: 'assistant', content: reply.content }]);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadRecommend() {
    try {
      const list = await apiGet<Recommend[]>('/assistant/recommend', { top_n: 5 });
      setRecommend(list);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-7rem)] flex-col bg-gradient-soft">
        <div className="no-scrollbar flex-1 overflow-y-auto px-4 py-3">
          {/* 顶部 welcome hero（首次进入时大图） */}
          {greetingLoaded && turns.length <= 1 && (
            <div className="px-2 py-4 text-center animate-fade-up">
              <div className="mb-3 inline-flex">
                <GradientOrb size={72} icon="✨" />
              </div>
              <div className="mx-auto max-w-[280px] text-[13px] leading-7 text-ink-600">
                想找什么样的人 · 想试什么样的体验，<br />
                <strong className="text-ink-800">就像和朋友聊天那样，直说就好。</strong>
              </div>
            </div>
          )}

          {/* 建议 chips（首次进入引导） */}
          {greetingLoaded && turns.length <= 1 && (
            <div className="mt-4 px-1 animate-fade-up" style={{ animationDelay: '100ms' }}>
              <div className="label-cormorant mb-2 text-center">TRY ASKING</div>
              <div className="grid grid-cols-2 gap-2">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => void sendText(s.text)}
                    className="flex items-start gap-2 rounded-2xl border border-warm-100 bg-white p-3 text-left shadow-warm-xs transition active:scale-[0.97]"
                  >
                    <span className="text-base leading-none">{s.emoji}</span>
                    <span className="text-[12px] leading-snug text-ink-800">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 对话消息 */}
          <div className="mt-3 space-y-3">
            {turns.map((t, i) => (
              <div key={i} className={`flex items-end gap-2 animate-fade-up ${t.role === 'user' ? 'flex-row-reverse' : ''}`}>
                {t.role === 'assistant' && <GradientOrb size={28} icon="✨" />}
                <div className={t.role === 'user' ? 'msg-bubble-mine' : 'msg-bubble-other'}>{t.content}</div>
              </div>
            ))}
            {busy && (
              <div className="flex items-end gap-2 animate-fade-up">
                <GradientOrb size={28} icon="✨" />
                <div className="msg-bubble-other">
                  <TypingDots />
                </div>
              </div>
            )}
          </div>

          {/* 推荐卡片横滑 */}
          {recommend.length > 0 && (
            <div className="mt-4 -mx-4 px-4 animate-fade-up">
              <div className="label-cormorant mb-2">RECOMMENDED FOR YOU</div>
              <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-2">
                {recommend.map((r) => (
                  <RecCard
                    key={r.therapist_id}
                    href={`/therapist/${r.therapist_id}`}
                    avatarUrl={r.avatar_url}
                    displayName={r.display_name ?? '技师'}
                    serviceCity={r.service_city}
                    scoreService={r.score_service}
                  />
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* 底部输入栏 */}
        <div className="border-t border-warm-100 bg-white/95 px-3 pb-3 pt-2 backdrop-blur">
          <ErrorBanner message={error} />

          {/* 快捷动作 chips */}
          <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
            <button type="button" onClick={() => void loadRecommend()} className="chip-quick">
              ✨ 推荐技师
            </button>
            <button type="button" onClick={() => void sendText('告诉我最近的优惠')} className="chip-quick">
              🎁 新人福利
            </button>
            <button type="button" onClick={() => void sendText('帮我设置偏好')} className="chip-quick">
              💝 我的偏好
            </button>
          </div>

          <div className="flex items-center gap-2 rounded-full bg-ink-50 px-3 py-1.5">
            <input
              className="flex-1 bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-300"
              placeholder="跟我说说你想找什么样的…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void sendText(input)}
            />
            <button
              type="button"
              onClick={() => void sendText(input)}
              disabled={busy || !input.trim()}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-cta text-white shadow-rose-md disabled:opacity-50"
              aria-label="发送"
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
