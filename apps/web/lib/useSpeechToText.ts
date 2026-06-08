'use client';

/**
 * 「按住说话」语音转文字 hook · 浏览器原生 Web Speech API(零后端、零成本)
 *
 * 抽自客户助理 VoiceAssistantSheet.tsx 的核心识别逻辑,供对话页输入区按住录入复用。
 * 用法:按住按钮 → start();松开 → const text = stop()。录音中 interimText 实时出字。
 * 不支持的浏览器 supported=false,调用方应隐藏入口、降级为纯打字。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface SRAlt {
  transcript: string;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SRAlt;
}
interface SRResultList {
  readonly length: number;
  [index: number]: SRResult;
}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SRErrorEvent {
  error: string;
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

export interface UseSpeechToText {
  supported: boolean;
  recording: boolean;
  /** 录音中的实时文字(final + interim) */
  interimText: string;
  error: string | null;
  start: () => void;
  /** 停止识别并返回最终文字(已 trim) */
  stop: () => string;
}

export function useSpeechToText(opts?: { lang?: string; maxMs?: number }): UseSpeechToText {
  const lang = opts?.lang ?? 'zh-CN';
  const maxMs = opts?.maxMs ?? 30_000;

  const [supported] = useState(() => getSRCtor() != null);
  const [recording, setRecording] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SR | null>(null);
  const finalTextRef = useRef('');
  const interimRef = useRef('');
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  // 卸载时 abort 释放麦克风(防红点常驻)
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
      cleanup();
    };
  }, [cleanup]);

  const start = useCallback(() => {
    if (recording) return;
    setError(null);
    const Ctor = getSRCtor();
    if (!Ctor) {
      setError('你的浏览器不支持语音识别 · 请用 Chrome / Edge / 新版 Safari');
      return;
    }
    finalTextRef.current = '';
    interimRef.current = '';
    setInterimText('');

    let recognition: SR;
    try {
      recognition = new Ctor();
    } catch {
      setError('语音识别启动失败 · 再试一次');
      return;
    }
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (!r) continue;
        const t = r[0]?.transcript ?? '';
        if (r.isFinal) finalTextRef.current += t;
        else interim += t;
      }
      interimRef.current = interim;
      setInterimText((finalTextRef.current + interim).trim());
    };
    recognition.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        setError('需要麦克风权限 · 浏览器设置里允许后再试');
      } else if (ev.error === 'no-speech') {
        // 没听到 · 不报错
      } else if (ev.error !== 'aborted') {
        setError(`识别异常: ${ev.error}`);
      }
    };
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      setError('语音识别启动失败 · 再试一次');
      return;
    }
    setRecording(true);
    maxTimerRef.current = setTimeout(() => {
      // 30s 硬上限 · 自动停(stop 内部会取字,但这里只能终止;实时字已在 interimText)
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      cleanup();
      setRecording(false);
    }, maxMs);
  }, [recording, lang, maxMs, cleanup]);

  const stop = useCallback((): string => {
    if (!recording) return '';
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    cleanup();
    setRecording(false);
    const text = (finalTextRef.current + interimRef.current).trim();
    finalTextRef.current = '';
    interimRef.current = '';
    setInterimText('');
    return text;
  }, [recording, cleanup]);

  return { supported, recording, interimText, error, start, stop };
}
