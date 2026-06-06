'use client';

/**
 * 声音复刻卡（技师端复用组件）
 *
 * 自包含：自己拉 /therapists/me（语音介绍 url）+ /therapists/me/media（审核状态）+ /voice/me（复刻状态），
 * 内含「录音 / 上传语音介绍」+「试听」。用于独立页 /t/me/voice、分身设置页 /t/me/ai-alter。
 *
 * 录音：MediaRecorder 直接录(优先,最方便) · getUserMedia 失败/不支持 → 降级「从文件上传」。
 * 试听：明确区分"通用女声预览(未复刻)" vs "你的克隆声音"，不再让技师误以为没复刻却有声音。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Section } from '@/components/ui';
import { MediaUploader } from '@/components/upload/MediaUploader';
import { AuditBadge, type AuditStatus } from '@/components/upload/AuditBadge';
import { apiGet, apiPut, apiPost } from '@/lib/api';
import { useMediaUpload, type MediaAsset } from '@/lib/upload';

interface VoiceClone {
  hasSample: boolean;
  engine: 'elevenlabs' | 'openai' | 'none';
  cloned: boolean;
  label: string;
}

export function VoiceCloneCard() {
  const [voiceIntroUrl, setVoiceIntroUrl] = useState<string | null>(null);
  const [voiceClone, setVoiceClone] = useState<VoiceClone | null>(null);
  const [mediaList, setMediaList] = useState<MediaAsset[]>([]);
  const [voicePreview, setVoicePreview] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // 录音状态
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [recUploading, setRecUploading] = useState(false);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { upload } = useMediaUpload({ basePath: '/therapists/me' });

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 4000);
  };

  const reload = useCallback(async () => {
    const [profile, media, voice] = await Promise.all([
      apiGet<{ voiceIntroUrl: string | null }>('/therapists/me'),
      apiGet<MediaAsset[]>('/therapists/me/media').catch(() => [] as MediaAsset[]),
      apiGet<VoiceClone>('/voice/me').catch(() => null), // 声音复刻状态 · 失败静默
    ]);
    setVoiceIntroUrl(profile.voiceIntroUrl);
    setMediaList(media);
    setVoiceClone(voice);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 组件卸载清理录音
  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      if (mrRef.current && mrRef.current.state !== 'inactive') mrRef.current.stop();
    };
  }, []);

  const handleVoiceUploaded = async (asset: MediaAsset) => {
    if (!asset.publicUrl) return;
    await apiPut('/therapists/me', { voiceIntroUrl: asset.publicUrl });
    await reload();
    showToast('语音已更新 · 进入审核后即可复刻');
  };

  async function startRec() {
    if (recording || recUploading) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      showToast('这台设备不支持录音 · 请用「从文件上传」');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recTimerRef.current) clearInterval(recTimerRef.current);
        const type = mr.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 1000) {
          showToast('录得太短啦 · 说 15-30 秒自我介绍');
          return;
        }
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type });
        setRecUploading(true);
        try {
          const asset = await upload(file, 'voice_intro', {});
          await handleVoiceUploaded(asset);
        } catch {
          showToast('上传失败 · 换「从文件上传」试试');
        } finally {
          setRecUploading(false);
        }
      };
      mrRef.current = mr;
      mr.start();
      setRecording(true);
      setRecSecs(0);
      recTimerRef.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch {
      showToast('录音需要麦克风权限 · 也可以「从文件上传」');
    }
  }

  function stopRec() {
    if (mrRef.current && mrRef.current.state !== 'inactive') mrRef.current.stop();
    setRecording(false);
    if (recTimerRef.current) clearInterval(recTimerRef.current);
  }

  const previewMyVoice = async () => {
    setVoiceBusy(true);
    setVoicePreview(null);
    try {
      const r = await apiPost<{ audioUrl: string }>('/voice/me/preview');
      setVoicePreview(r.audioUrl);
    } catch {
      showToast('暂时听不到 · 语音服务未就绪');
    } finally {
      setVoiceBusy(false);
    }
  };

  const matched = voiceIntroUrl ? mediaList.find((m) => m.publicUrl === voiceIntroUrl) : undefined;
  const voiceStatus: AuditStatus | undefined = matched?.auditStatus;
  const rejectReason = matched?.rejectReason ?? null;
  // 是否已用「你本人的声音」(ElevenLabs 真克隆 + 有样本) · 否则只是通用女声预览
  const cloned = voiceClone?.engine === 'elevenlabs' && voiceClone.hasSample;

  return (
    <Section title="声音复刻" subtitle="VOICE CLONE">
      <div className="space-y-2">
        {voiceIntroUrl ? (
          <div className="flex items-center gap-3 rounded-xl border border-warm-100 bg-white px-3 py-2">
            <audio src={voiceIntroUrl} controls className="flex-1" preload="metadata" />
            {voiceStatus && <AuditBadge status={voiceStatus} rejectReason={rejectReason} />}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-warm-200 bg-warm-50 px-3 py-4 text-center text-[12px] text-ink-500">
            还没有你的声音 · 录一段 15-30 秒自我介绍，分身就用你的声音陪客户
          </div>
        )}

        {/* 录音(优先,最方便) */}
        {recording ? (
          <button
            type="button"
            onClick={stopRec}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-rose-500 py-2.5 text-[13px] font-semibold text-white active:scale-[0.99]"
          >
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
            录音中 {recSecs}s · 点此停止并上传
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void startRec()}
            disabled={recUploading}
            className="w-full rounded-full bg-gradient-cta py-2.5 text-[13px] font-semibold text-white active:scale-[0.99] disabled:opacity-60"
          >
            {recUploading ? '上传中…' : '🎙️ 录一段我的声音'}
          </button>
        )}

        {/* 从文件上传(降级/备选) */}
        <MediaUploader purpose="voice_intro" onComplete={(a: MediaAsset) => void handleVoiceUploaded(a)}>
          <button
            type="button"
            className="w-full rounded-full border border-warm-300 bg-white py-2 text-[12px] text-warm-700 active:bg-warm-50"
          >
            {voiceIntroUrl ? '或从文件更换' : '或从文件上传'}
          </button>
        </MediaUploader>
        <div className="text-center text-[10px] text-ink-500">录 15-30 秒 · 或上传 mp3/m4a/wav（最大 10MB）</div>

        {/* 试听区 · 明确区分通用预览 vs 你的克隆声音 */}
        <div className="mt-2 rounded-xl border border-primary-100 bg-gradient-to-br from-primary-50/60 to-warm-50/60 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary-700">
            <span>🎙️</span>
            <span>你的声音会成为「她」陪客户时的声音</span>
          </div>
          <div className="mt-1 text-[10.5px] leading-5 text-ink-600">
            {cloned ? (
              <>✅ 已用<strong>你本人的声音</strong>复刻{voiceClone?.cloned ? '' : '（首次发声时生成）'}</>
            ) : voiceClone?.engine === 'openai' ? (
              <>⚠️ 现在听到的是<strong>通用女声预览</strong> · 录 / 传一段你的声音后，分身才会用<strong>你的声音</strong>说话</>
            ) : (
              <>❌ 语音暂不可用（缺样本或语音服务未就绪）</>
            )}
          </div>
          {voicePreview && <audio src={voicePreview} controls autoPlay className="mt-2 h-8 w-full" />}
          <button
            type="button"
            onClick={() => void previewMyVoice()}
            disabled={voiceBusy || voiceClone?.engine === 'none'}
            className="mt-2 w-full rounded-full bg-gradient-cta py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
          >
            {voiceBusy ? '生成中…' : cloned ? '试听你的声音' : '试听通用预览音'}
          </button>
        </div>

        {toast && (
          <div className="rounded-lg bg-ink-800/90 px-3 py-2 text-center text-[11px] text-white">{toast}</div>
        )}
      </div>
    </Section>
  );
}
