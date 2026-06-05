/**
 * 语音助理 BottomSheet · M03 v5 (2026-06-02 [[loverush_m03_audit_2026_06_01]] v5)
 *
 * v5.3 (Claude 文本版): Web Speech API 转字 → POST JSON {text} → Claude Haiku
 *   ① 浏览器 SpeechRecognition 转字 (interim 实时显)
 *   ② 松开 → POST /assistant/voice JSON {text, session_id, turn_idx}
 *   ③ 后端 LLMGateway forceProvider 'anthropic' → JSON {reply_text, recommend_intent?}
 *   ④ 显示对话气泡 (用户转字 + AI 回复)
 *   ⑤ 推荐卡 sheet 内浮显 (点击跳 /therapist/[id])
 *   ⑥ 跨会话历史 (后端拉最近 10 轮)
 *
 * 设计 (Tony [[loverush_m03_audit_2026_06_01]] v5 spec):
 *   - 纯语音 · 无打字 fallback
 *   - 推荐卡 sheet 内浮显不跳页
 *   - mic 权限只授权一次 (Web Speech 自管)
 *   - Web Speech 不支持的浏览器明确提示
 */
'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Mic, Sparkles, X, Loader2, Star, MapPin } from 'lucide-react';
import { Avatar } from './ui';

/** Web Speech API 跨浏览器类型 · 标准 SpeechRecognition 在 TS lib 里不齐 · 自定义 minimal 接口 */
interface SRResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface SREvent extends Event {
  readonly resultIndex: number;
  readonly results: ArrayLike<SRResult>;
}
interface SRErrorEvent extends Event {
  readonly error: string;
}
interface SR {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SREvent) => void) | null;
  onerror: ((ev: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SR;
function getSRCtor(): SRCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * API URL · build-time inline NEXT_PUBLIC_API_URL · runtime fallback by hostname
 *   build cache 命中导致旧 URL 时仍能 fallback
 *   loverush.app → api.loverush.app
 *   localhost → localhost:8787
 *
 * v5.2 (2026-06-02): build cache 命中导致旧域 loverush-production · 加 runtime 保险
 */
function getVoiceApiUrl(): string {
  const buildTimeUrl = process.env.NEXT_PUBLIC_API_URL;
  if (buildTimeUrl && buildTimeUrl.includes('api.loverush.app')) {
    return `${buildTimeUrl}/assistant/voice`;
  }
  // Runtime fallback by hostname
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'loverush.app' || host.endsWith('.loverush.app')) {
      return 'https://api.loverush.app/assistant/voice';
    }
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:8787/assistant/voice';
    }
  }
  return `${buildTimeUrl ?? 'https://api.loverush.app'}/assistant/voice`;
}
const MAX_RECORD_MS = 30_000; // 30s 硬上限 · 防超长

interface Recommendation {
  therapist_id: string;
  display_name: string;
  avatar_url: string | null;
  city: string | null;
  online_status: string | null;
  reason: string;
}

interface Bubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  recommendations?: Recommendation[];
  /** 历史对话(之前会话拉取 · 灰显) */
  isHistory?: boolean;
}

interface HistoryTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 用户当前城市(顶部位置栏) · 传后端避免反问 + 推荐锁本城 */
  city?: string | null;
}

type RecordState = 'idle' | 'recording' | 'uploading' | 'error';

export function VoiceAssistantSheet({ isOpen, onClose, city }: Props) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [recordSec, setRecordSec] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const sessionIdRef = useRef<string>('');
  const turnIdxRef = useRef<number>(0);
  /** Web Speech 识别实例 · 首次按住懒建 · 关 sheet 释放 · 整次会话只申请一次 mic 权限 */
  const recognitionRef = useRef<SR | null>(null);
  /** 累积 final + interim 字 · 松开时 final 是最终拿去发的字 */
  const finalTextRef = useRef<string>('');
  const interimTextRef = useRef<string>('');
  /** 当前录音中的占位气泡 id · 给 onresult 实时刷新 */
  const liveBubbleIdRef = useRef<string | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordMaxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 锁 body scroll + 进 sheet 初始化 session + 关 sheet 释放 mic
  useEffect(() => {
    if (!isOpen) {
      // 关 sheet 立即终止 recognition · 释放 mic 红点
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
      return;
    }
    if (!sessionIdRef.current) {
      sessionIdRef.current = crypto.randomUUID();
      turnIdxRef.current = 0;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // 打开时拉最近对话历史(后端 GET /assistant/chat/history)· 让用户看到之前聊过的,对话不再一次性
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const token =
          typeof window !== 'undefined' ? window.localStorage.getItem('access_token') : null;
        const url =
          getVoiceApiUrl().replace('/assistant/voice', '/assistant/chat/history') + '?limit=20';
        const resp = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!resp.ok || cancelled) return;
        const json = (await resp.json()) as { data?: { turns?: HistoryTurn[] } | HistoryTurn[] };
        const raw = json.data;
        const turns: HistoryTurn[] = Array.isArray(raw) ? raw : (raw?.turns ?? []);
        if (cancelled || turns.length === 0) return;
        setBubbles((cur) => {
          // 已开始本次对话就不覆盖,只在空时灌历史
          if (cur.some((b) => !b.isHistory)) return cur;
          return turns
            .filter((t) => t.content)
            .map((t) => ({ id: `h-${t.id}-${t.role}`, role: t.role, text: t.content, isHistory: true }));
        });
      } catch {
        /* 历史拉取失败不影响新对话 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // 新气泡到底滚
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles.length, recordState]);

  // 清理 (sheet 关时 / unmount 时)
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (recordMaxTimerRef.current) clearTimeout(recordMaxTimerRef.current);
    };
  }, []);

  /** 按住开始 Web Speech 识别 · 实时显字 · 30s 硬上限自动 stop */
  const startRecord = useCallback(() => {
    if (recordState !== 'idle' && recordState !== 'error') return;
    setErrMsg(null);

    const Ctor = getSRCtor();
    if (!Ctor) {
      setRecordState('error');
      setErrMsg('你的浏览器不支持语音识别 · 请用 Chrome / Edge / 新版 Safari');
      return;
    }

    // 清空累积字
    finalTextRef.current = '';
    interimTextRef.current = '';

    // 占位用户气泡 · 录音中实时刷字
    const userBubbleId = `u-${Date.now()}`;
    liveBubbleIdRef.current = userBubbleId;
    setBubbles((prev) => [...prev, { id: userBubbleId, role: 'user', text: '🎤 …' }]);

    let recognition: SR;
    try {
      recognition = new Ctor();
    } catch {
      setRecordState('error');
      setErrMsg('语音识别启动失败 · 再试一次');
      return;
    }
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'zh-CN';

    recognition.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (!r) continue;
        const t = r[0].transcript;
        if (r.isFinal) {
          finalTextRef.current += t;
        } else {
          interim += t;
        }
      }
      interimTextRef.current = interim;
      const live = (finalTextRef.current + interim).trim();
      const bubbleId = liveBubbleIdRef.current;
      if (bubbleId) {
        setBubbles((prev) =>
          prev.map((b) => (b.id === bubbleId ? { ...b, text: live || '🎤 …' } : b)),
        );
      }
    };
    recognition.onerror = (ev) => {
      // not-allowed / no-speech / aborted / audio-capture · 视情况
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        setErrMsg('需要麦克风权限 · 浏览器设置里允许后再试');
      } else if (ev.error === 'no-speech') {
        // 没听到 · 不显错 · 让 onend 走 abort 流
      } else if (ev.error !== 'aborted') {
        setErrMsg(`识别异常: ${ev.error}`);
      }
    };
    recognition.onend = () => {
      // SR 可能因静音/超时自己 end · 这里不主动处理(让 stopRecord 流统一收尾)
    };
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      setRecordState('error');
      setErrMsg('语音识别启动失败 · 再试一次');
      return;
    }

    setRecordState('recording');
    setRecordSec(0);
    recordTimerRef.current = setInterval(() => {
      setRecordSec((s) => s + 1);
    }, 1000);
    // 30s 硬上限自动 stop
    recordMaxTimerRef.current = setTimeout(() => {
      stopRecord();
    }, MAX_RECORD_MS);
  }, [recordState]);

  /** 松开停止识别 → 拿 finalText + 残余 interim → uploadText */
  const stopRecord = useCallback(() => {
    if (recordState !== 'recording') return;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (recordMaxTimerRef.current) clearTimeout(recordMaxTimerRef.current);
    recordTimerRef.current = null;
    recordMaxTimerRef.current = null;
    setRecordState('uploading');

    // 拿当前累积的字(final + interim · interim 在 zh-CN 有时不会 final)
    const text = (finalTextRef.current + interimTextRef.current).trim();
    finalTextRef.current = '';
    interimTextRef.current = '';

    void uploadText(text);
  }, [recordState]);

  /** 发文字到后端 + 拿 Claude 回复 + 推荐 */
  async function uploadText(text: string) {
    const userBubbleId = liveBubbleIdRef.current;
    liveBubbleIdRef.current = null;

    // 太短 / 空 → 直接 abort + 删占位
    if (!text || text.length < 1) {
      setBubbles((prev) => prev.filter((b) => b.id !== userBubbleId));
      setRecordState('idle');
      setRecordSec(0);
      return;
    }

    // 把占位 bubble 改成最终 transcript · 同时加 AI 占位
    const aiBubbleId = `a-${Date.now()}`;
    setBubbles((prev) => [
      ...prev.map((b) => (b.id === userBubbleId ? { ...b, text } : b)),
      { id: aiBubbleId, role: 'assistant', text: '…' },
    ]);

    try {
      const token =
        typeof window !== 'undefined' ? window.localStorage.getItem('access_token') : null;
      const resp = await fetch(getVoiceApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text,
          session_id: sessionIdRef.current,
          turn_idx: turnIdxRef.current,
          city: city ?? undefined,
        }),
      });

      if (!resp.ok) {
        const errBody = (await resp.json().catch(() => null)) as {
          error?: { message?: string; detail?: string };
        } | null;
        const m = errBody?.error?.message ?? '小助理没响应';
        const d = errBody?.error?.detail;
        throw new Error(d ? `${m} · ${d}` : m);
      }
      const json = (await resp.json()) as {
        data: {
          transcript: string;
          reply_text: string;
          recommendations: Recommendation[];
          turn_idx: number;
        };
      };

      setBubbles((prev) =>
        prev.map((b) => {
          if (b.id === aiBubbleId)
            return {
              ...b,
              text: json.data.reply_text || '...',
              recommendations: json.data.recommendations.length
                ? json.data.recommendations
                : undefined,
            };
          return b;
        }),
      );
      turnIdxRef.current = json.data.turn_idx;
      setRecordState('idle');
      setRecordSec(0);
    } catch (err) {
      setBubbles((prev) => prev.filter((b) => b.id !== aiBubbleId));
      setRecordState('error');
      setErrMsg(err instanceof Error ? err.message : '没响应 · 再试一次');
      setRecordSec(0);
    }
  }

  if (!isOpen) return null;

  const recordSecLabel = `${Math.floor(recordSec / 60)}:${String(recordSec % 60).padStart(2, '0')}`;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92vh] min-h-[70vh] w-full max-w-[390px] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-12px_40px_rgba(0,0,0,0.18)]"
      >
        {/* sticky header */}
        <div className="shrink-0 bg-white">
          <div className="mx-auto mt-2.5 h-1 w-12 rounded-full bg-ink-200" />
          <div className="flex items-center justify-between px-5 pt-3 pb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-cta shadow-rose-md">
                <Sparkles className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
              </div>
              <span className="font-serif-cn text-[16px] font-semibold tracking-tight text-ink-900">
                小助理
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-500 active:bg-ink-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 对话流 */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {bubbles.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-cta shadow-rose-md">
                <Sparkles className="h-7 w-7 text-white" strokeWidth={2.2} />
              </div>
              <h3 className="mt-4 font-serif-cn text-[18px] font-semibold text-ink-900">
                按住下面说话
              </h3>
              <p className="mt-1.5 max-w-[280px] text-[12.5px] leading-relaxed text-ink-500">
                告诉我你想要什么样的技师 · 我帮你挑出 3 个
                <br />
                <span className="text-ink-400">支持中文 · English · ภาษาไทย · Tiếng Việt</span>
              </p>
            </div>
          ) : (
            bubbles.map((b, i) => {
              const firstToday = !b.isHistory && i > 0 && bubbles[i - 1]?.isHistory;
              return (
                <Fragment key={b.id}>
                  {firstToday && (
                    <div className="flex items-center gap-2 py-1">
                      <div className="h-px flex-1 bg-ink-100" />
                      <span className="text-[10px] text-ink-400">今天</span>
                      <div className="h-px flex-1 bg-ink-100" />
                    </div>
                  )}
                  <BubbleView bubble={b} onClose={onClose} />
                </Fragment>
              );
            })
          )}
        </div>

        {/* 错误条 */}
        {errMsg && (
          <div className="shrink-0 border-t border-rose-100 bg-rose-50 px-5 py-2 text-[12px] text-rose-600">
            ⚠️ {errMsg}
          </div>
        )}

        {/* 底部录音按钮 */}
        <div className="shrink-0 border-t border-warm-100 bg-white px-5 pb-8 pt-5">
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                void startRecord();
              }}
              onPointerUp={(e) => {
                e.preventDefault();
                stopRecord();
              }}
              onPointerCancel={(e) => {
                e.preventDefault();
                stopRecord();
              }}
              onPointerLeave={() => {
                if (recordState === 'recording') stopRecord();
              }}
              disabled={recordState === 'uploading'}
              className={`relative flex h-20 w-20 items-center justify-center rounded-full shadow-rose-lg transition-transform active:scale-95 disabled:opacity-60 ${
                recordState === 'recording'
                  ? 'bg-rose-600 ring-4 ring-rose-200 animate-pulse'
                  : 'bg-gradient-cta'
              }`}
              aria-label={recordState === 'recording' ? '松开发送' : '按住说话'}
            >
              {recordState === 'uploading' ? (
                <Loader2 className="h-9 w-9 text-white animate-spin" />
              ) : (
                <Mic className="h-9 w-9 text-white" strokeWidth={2.3} />
              )}
            </button>
            <span className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
              {recordState === 'recording'
                ? `录音中 · ${recordSecLabel} · 松开发送`
                : recordState === 'uploading'
                  ? '懂你了 · 正在为你想…'
                  : recordState === 'error'
                    ? '再试一次'
                    : '按住说话'}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

/** 单条气泡 · 用户/AI · AI 带可选推荐卡 */
function BubbleView({ bubble, onClose }: { bubble: Bubble; onClose: () => void }) {
  const mine = bubble.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} ${bubble.isHistory ? 'opacity-55' : ''}`}>
      <div className={`max-w-[78%] flex flex-col gap-2 ${mine ? 'items-end' : 'items-start'}`}>
        <div
          className={`w-fit rounded-[22px] px-4 py-2.5 text-[14px] leading-[1.55] whitespace-pre-wrap break-words ${
            mine
              ? 'bg-gradient-cta text-white shadow-rose-md rounded-br-md'
              : 'bg-white text-ink-800 ring-1 ring-warm-100 shadow-warm-xs rounded-bl-md'
          }`}
        >
          {bubble.text}
        </div>
        {bubble.recommendations && bubble.recommendations.length > 0 && (
          <div className="w-full space-y-2 pt-1">
            {bubble.recommendations.map((r) => (
              <Link
                key={r.therapist_id}
                href={`/therapist/${r.therapist_id}`}
                onClick={onClose}
                className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-warm-100 shadow-warm-xs transition active:bg-warm-50"
              >
                <Avatar
                  size={48}
                  src={r.avatar_url ?? undefined}
                  fallback={(r.display_name || '?').slice(0, 1)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-semibold text-ink-900">
                      {r.display_name}
                    </span>
                    {r.online_status === 'online' && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-success-100 px-1.5 py-0.5 text-[9px] font-semibold text-success-700">
                        <span className="h-1 w-1 rounded-full bg-success-500" />
                        在线
                      </span>
                    )}
                  </div>
                  {r.city && (
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-500">
                      <MapPin className="h-3 w-3" />
                      {r.city}
                    </div>
                  )}
                  <div className="mt-1 text-[12px] text-ink-600 line-clamp-2">{r.reason}</div>
                </div>
                <Star className="h-4 w-4 shrink-0 text-warning-500" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
