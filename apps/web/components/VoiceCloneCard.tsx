'use client';

/**
 * 声音复刻卡（技师端复用组件）
 *
 * 自包含：自己拉 /therapists/me（语音介绍 url）+ /therapists/me/media（审核状态）+ /voice/me（复刻状态），
 * 内含「上传/更换语音介绍」+「试听我的 AI 声音」。
 * 用于：独立页 /t/me/voice、分身设置页 /t/me/ai-alter。
 * （媒体管理页 /t/me/media 另有内联版本，语境是媒体集合，保持不动。）
 */

import { useCallback, useEffect, useState } from 'react';
import { Section } from '@/components/ui';
import { MediaUploader } from '@/components/upload/MediaUploader';
import { AuditBadge, type AuditStatus } from '@/components/upload/AuditBadge';
import { apiGet, apiPut, apiPost } from '@/lib/api';
import type { MediaAsset } from '@/lib/upload';

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

  const handleVoiceUploaded = async (asset: MediaAsset) => {
    if (!asset.publicUrl) return;
    await apiPut('/therapists/me', { voiceIntroUrl: asset.publicUrl });
    await reload();
    showToast('语音已更新 · 进入审核后即可复刻');
  };

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
            还没传语音介绍 · 建议录制 15-30 秒自我介绍
          </div>
        )}
        <MediaUploader purpose="voice_intro" onComplete={(a: MediaAsset) => void handleVoiceUploaded(a)}>
          <button
            type="button"
            className="w-full rounded-full border border-warm-300 bg-white py-2 text-[12px] text-warm-700 active:bg-warm-50"
          >
            {voiceIntroUrl ? '更换语音介绍' : '上传语音介绍'}
          </button>
        </MediaUploader>
        <div className="text-center text-[10px] text-ink-500">mp3/m4a/wav · 最大 10MB</div>

        {/* M18 · 声音复刻：语音介绍 = AI 分身的声音 */}
        <div className="mt-2 rounded-xl border border-primary-100 bg-gradient-to-br from-primary-50/60 to-warm-50/60 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary-700">
            <span>🎙️</span>
            <span>声音复刻 · 你的声音会成为「她」陪客户时的声音</span>
          </div>
          <div className="mt-1 text-[10.5px] leading-5 text-ink-600">
            {voiceClone?.label ?? '加载中…'}
            {voiceClone && !voiceClone.hasSample && '（先传一段清晰语音介绍，复刻更像你）'}
          </div>
          {voicePreview && <audio src={voicePreview} controls autoPlay className="mt-2 h-8 w-full" />}
          <button
            type="button"
            onClick={() => void previewMyVoice()}
            disabled={voiceBusy || voiceClone?.engine === 'none'}
            className="mt-2 w-full rounded-full bg-gradient-cta py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
          >
            {voiceBusy ? '生成中…' : '试听我的 AI 声音'}
          </button>
        </div>

        {toast && (
          <div className="rounded-lg bg-ink-800/90 px-3 py-2 text-center text-[11px] text-white">{toast}</div>
        )}
      </div>
    </Section>
  );
}
