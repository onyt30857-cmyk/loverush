/**
 * 语音助理 BottomSheet · M03 v5 (2026-06-02 [[loverush_m03_audit_2026_06_01]] v5)
 *
 * C3 (本 commit) 串联前后端:
 *   ① MediaRecorder 录音 (webm · iOS Safari 自动转 mp4)
 *   ② POST /assistant/voice multipart upload (audio + session_id + turn_idx)
 *   ③ 显示对话气泡 (用户转文字 + AI 回复)
 *   ④ 推荐卡 sheet 内浮显 (点击跳 /therapist/[id])
 *   ⑤ 多轮历史滚到底 · 持续按住说话继续多轮
 *   ⑥ 错误兜底 · 重试按钮 · 麦克风权限提示
 *
 * 设计 (Tony [[loverush_m03_audit_2026_06_01]] v5 spec):
 *   - 纯语音 · 无打字 fallback
 *   - 推荐卡 sheet 内浮显不跳页 (轻 mini 卡 · 点击跳完整详情)
 *   - 跨会话历史 (后端 loadHistory 拉最近 10 轮 · 进 sheet 时载入)
 *   - Gemini 2.5 Flash 多模态
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Mic, Sparkles, X, Loader2, Star, MapPin } from 'lucide-react';
import { Avatar } from './ui';

const VOICE_API_URL = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/assistant/voice`;
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
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type RecordState = 'idle' | 'recording' | 'uploading' | 'error';

export function VoiceAssistantSheet({ isOpen, onClose }: Props) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [recordSec, setRecordSec] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const sessionIdRef = useRef<string>('');
  const turnIdxRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordMaxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 锁 body scroll + 进 sheet 初始化 session
  useEffect(() => {
    if (!isOpen) return;
    if (!sessionIdRef.current) {
      sessionIdRef.current = crypto.randomUUID();
      turnIdxRef.current = 0;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // 新气泡到底滚
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles.length, recordState]);

  // 清理录音 timer (sheet 关时 / unmount 时)
  useEffect(() => {
    return () => {
      stopRecorderSilent();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopRecorderSilent() {
    try {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (recordMaxTimerRef.current) clearTimeout(recordMaxTimerRef.current);
    recordTimerRef.current = null;
    recordMaxTimerRef.current = null;
  }

  /** 选 MediaRecorder 支持的 mime · iOS Safari 用 mp4 · 其他 webm/opus */
  function pickMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return 'audio/webm';
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
    return 'audio/webm';
  }

  /** 按住开始录音 */
  const startRecord = useCallback(async () => {
    if (recordState !== 'idle' && recordState !== 'error') return;
    setErrMsg(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setRecordState('error');
      setErrMsg('需要麦克风权限 · 浏览器设置里允许后再试');
      return;
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      void uploadAudio(mimeType);
    };
    recorder.start();
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

  /** 松开停止录音 → 触发 onstop → uploadAudio */
  const stopRecord = useCallback(() => {
    if (recordState !== 'recording') return;
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      /* ignore */
    }
    mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (recordMaxTimerRef.current) clearTimeout(recordMaxTimerRef.current);
    recordTimerRef.current = null;
    recordMaxTimerRef.current = null;
    setRecordState('uploading');
  }, [recordState]);

  /** 上传 audio + 显示气泡 + 拿响应 */
  async function uploadAudio(mimeType: string) {
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];

    // 太短的录音 (< 0.5s) 直接 abort
    if (blob.size < 1000) {
      setRecordState('idle');
      setRecordSec(0);
      return;
    }

    // 占位气泡 · 用户气泡先显 "上传中..." · AI 气泡显 typing 3 点
    const userBubbleId = `u-${Date.now()}`;
    const aiBubbleId = `a-${Date.now() + 1}`;
    setBubbles((prev) => [
      ...prev,
      { id: userBubbleId, role: 'user', text: '🎤 ...' },
      { id: aiBubbleId, role: 'assistant', text: '…' },
    ]);

    try {
      const fd = new FormData();
      fd.append('audio', blob, mimeType.includes('mp4') ? 'voice.mp4' : 'voice.webm');
      fd.append('session_id', sessionIdRef.current);
      fd.append('turn_idx', String(turnIdxRef.current));

      const token =
        typeof window !== 'undefined' ? window.localStorage.getItem('access_token') : null;
      const resp = await fetch(VOICE_API_URL, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });

      if (!resp.ok) {
        const errBody = (await resp.json().catch(() => null)) as {
          error?: { message?: string; detail?: string };
        } | null;
        // 显示真 detail · 让用户知道是上游 Gemini 失败什么原因
        const m = errBody?.error?.message ?? '上传失败';
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

      // 替换占位气泡为真实内容
      setBubbles((prev) =>
        prev.map((b) => {
          if (b.id === userBubbleId) return { ...b, text: json.data.transcript || '...' };
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
      // 失败 · 删占位气泡 + 显错误
      setBubbles((prev) => prev.filter((b) => b.id !== userBubbleId && b.id !== aiBubbleId));
      setRecordState('error');
      setErrMsg(err instanceof Error ? err.message : '上传失败 · 再试一次');
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
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92vh] min-h-[70vh] w-full max-w-[430px] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-12px_40px_rgba(0,0,0,0.18)]"
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
            bubbles.map((b) => <BubbleView key={b.id} bubble={b} onClose={onClose} />)
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
                  ? '上传中…'
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
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
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
