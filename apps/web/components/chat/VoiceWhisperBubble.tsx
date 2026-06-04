'use client';
/**
 * 心动陪伴 · 语音悄悄话气泡（M18 · mockup B）
 *
 * 正向流：客户付费触发 voice_whisper → 「她」回一条语音悄悄话（可播放）。
 * 视觉：柔化波形 + 播放键 + 时长 + 她的文字转录（可读，保可访问性）。
 *
 * 音频：真实「她的声音」需 M06 声音复刻（未连）。当前用 demo 语音占位，
 *   TODO(声音复刻): 后端为每位技师生成 voice_whisper 音频后，把 audioUrl 换成真实复刻音频。
 */
import { useRef, useState } from 'react';
import { Play, Pause, Heart } from 'lucide-react';

// TODO(声音复刻): 替换为后端按技师复刻的真实音频
const PLACEHOLDER_AUDIO =
  'https://pub-bad5a738b21b4f6abc2fb480e5fabe8d.r2.dev/demo/therapist-voice-intro-v1.mp3';

// 柔化波形高度（静态装饰 · 真实波形待音频分析）
const BARS = [7, 13, 20, 11, 18, 8, 16, 22, 10, 15, 6, 17, 12, 19, 9];

export interface VoiceWhisperBubbleProps {
  /** 她的文字回复（转录 · 可读可访问） */
  transcript: string;
  /** 真实复刻音频 · 缺省用占位 */
  audioUrl?: string | null;
}

export function VoiceWhisperBubble({ transcript, audioUrl }: VoiceWhisperBubbleProps) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  }

  return (
    <div className="max-w-[78%]">
      <div className="flex items-center gap-2.5 rounded-2xl rounded-bl-md bg-white px-3 py-2.5 shadow-warm-xs">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? '暂停' : '播放她的悄悄话'}
          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-cta text-white shadow-warm-sm active:scale-95"
        >
          {playing ? <Pause className="h-3.5 w-3.5 fill-white" /> : <Play className="ml-0.5 h-3.5 w-3.5 fill-white" />}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white shadow">
            <Heart className="h-2 w-2 fill-primary text-primary" />
          </span>
        </button>
        <div className="flex items-center gap-[3px]" aria-hidden>
          {BARS.map((h, i) => (
            <span
              key={i}
              className="w-[3px] rounded-full bg-primary/60"
              style={{ height: h, opacity: playing ? 0.9 : 0.5 }}
            />
          ))}
        </div>
        <span className="num shrink-0 text-[10px] text-ink-500">0:14</span>
        <audio ref={audioRef} src={audioUrl || PLACEHOLDER_AUDIO} onEnded={() => setPlaying(false)} preload="none" />
      </div>
      {/* 转录：可访问 + 无法播放时仍读到她说了什么 */}
      <div className="mt-1 px-1 text-[11px] leading-5 text-ink-500">
        <span className="text-primary-600">悄悄话</span> · {transcript}
      </div>
    </div>
  );
}
