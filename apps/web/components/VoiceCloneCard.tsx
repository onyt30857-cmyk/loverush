'use client';

/**
 * 声音复刻卡（技师端复用组件）· 标准分步流程
 *
 * 录音 / 上传 → 本地试听确认(重录/确认) → 提交合成(真实进度) → 试听真克隆声音。
 * 试听只放「你本人的真克隆」，没合成好就明说「还没合成」，绝不拿通用女声冒充。
 *
 * 自包含：自己拉 /therapists/me(样本 url) + /therapists/me/media(审核) + /voice/me(复刻状态)。
 * 用于独立页 /t/me/voice、分身设置页 /t/me/ai-alter。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Section } from '@/components/ui';
import { AuditBadge, type AuditStatus } from '@/components/upload/AuditBadge';
import { apiGet, apiPut, apiPost } from '@/lib/api';
import { useMediaUpload, validateFile, type MediaAsset } from '@/lib/upload';

interface VoiceClone {
  hasSample: boolean;
  sampleUrl: string | null;
  engine: 'elevenlabs' | 'openai' | 'none';
  cloned: boolean;
  label: string;
}

type Phase = 'idle' | 'recording' | 'reviewing' | 'submitting' | 'done';
type SubStage = 'uploading' | 'cloning' | 'preparing';

const SUBSTAGE_LABEL: Record<SubStage, string> = {
  uploading: '上传你的声音',
  cloning: '正在分析你的声纹…通常几秒到半分钟',
  preparing: '准备试听…',
};

export function VoiceCloneCard() {
  const [voiceIntroUrl, setVoiceIntroUrl] = useState<string | null>(null);
  const [voiceClone, setVoiceClone] = useState<VoiceClone | null>(null);
  const [mediaList, setMediaList] = useState<MediaAsset[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [recSecs, setRecSecs] = useState(0);

  // 待确认的录音/文件(本地试听,未上传)
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  // 提交合成进度
  const [subStage, setSubStage] = useState<SubStage | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 试听真克隆
  const [voicePreview, setVoicePreview] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);

  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localUrlRef = useRef<string | null>(null);

  const { upload, progress: uploadProgress } = useMediaUpload({ basePath: '/therapists/me' });

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 4000);
  };

  const reload = useCallback(async () => {
    const [profile, media, voice] = await Promise.all([
      apiGet<{ voiceIntroUrl: string | null }>('/therapists/me'),
      apiGet<MediaAsset[]>('/therapists/me/media').catch(() => [] as MediaAsset[]),
      apiGet<VoiceClone>('/voice/me').catch(() => null),
    ]);
    setVoiceIntroUrl(profile.voiceIntroUrl);
    setMediaList(media);
    setVoiceClone(voice);
    return voice;
  }, []);

  // 首次加载:已复刻 → done(可试听);否则 idle(去录音)
  useEffect(() => {
    void (async () => {
      const voice = await reload();
      setPhase(voice?.cloned === true ? 'done' : 'idle');
    })();
  }, [reload]);

  // 卸载清理
  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      if (mrRef.current && mrRef.current.state !== 'inactive') mrRef.current.stop();
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    };
  }, []);

  const setLocal = (file: File) => {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    const url = URL.createObjectURL(file);
    localUrlRef.current = url;
    setPendingFile(file);
    setLocalPreviewUrl(url);
    setPhase('reviewing');
  };

  const clearLocal = () => {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    localUrlRef.current = null;
    setPendingFile(null);
    setLocalPreviewUrl(null);
  };

  async function startRec() {
    if (phase === 'recording' || phase === 'submitting') return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      showToast('这台设备不支持录音 · 请用「从文件选择」');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recTimerRef.current) clearInterval(recTimerRef.current);
        const type = mr.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 1000) {
          showToast('录得太短啦 · 说 15-30 秒自我介绍');
          setPhase('idle');
          return;
        }
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type });
        setLocal(file); // → reviewing(本地试听确认),不上传
      };
      mrRef.current = mr;
      mr.start();
      setPhase('recording');
      setRecSecs(0);
      recTimerRef.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch {
      showToast('录音需要麦克风权限 · 也可以「从文件选择」');
    }
  }

  function stopRec() {
    if (mrRef.current && mrRef.current.state !== 'inactive') mrRef.current.stop();
    if (recTimerRef.current) clearInterval(recTimerRef.current);
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重选同一文件
    if (!file) return;
    const v = validateFile(file, 'voice_intro');
    if (!v.ok) {
      showToast(v.reason);
      return;
    }
    setLocal(file); // → reviewing
  }

  function reRecord() {
    clearLocal();
    setSubmitError(null);
    setPhase('idle');
  }

  // 确认 → 提交合成:①上传样本 ②克隆 ③拉状态
  async function confirmSubmit() {
    if (!pendingFile) return;
    setSubmitError(null);
    setPhase('submitting');
    try {
      setSubStage('uploading');
      const asset = await upload(pendingFile, 'voice_intro', {});
      if (!asset.publicUrl) throw new Error('上传失败 · 请重试');
      await apiPut('/therapists/me', { voiceIntroUrl: asset.publicUrl });

      setSubStage('cloning');
      await apiPost('/voice/me/clone'); // 真实合成 · 失败会 throw(后端明确报错)

      setSubStage('preparing');
      clearLocal();
      await reload();
      setSubStage(null);
      setPhase('done');
      showToast('合成完成 · 来听听你的声音');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '合成失败 · 请重试';
      setSubmitError(msg);
      setSubStage(null);
      // 留在 submitting 态展示错误 + 重试/重录
    }
  }

  const previewMyVoice = async () => {
    setVoiceBusy(true);
    setVoicePreview(null);
    try {
      const r = await apiPost<{ audioUrl: string }>('/voice/me/preview');
      setVoicePreview(r.audioUrl);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '还没合成你的声音');
    } finally {
      setVoiceBusy(false);
    }
  };

  const matched = voiceIntroUrl ? mediaList.find((m) => m.publicUrl === voiceIntroUrl) : undefined;
  const voiceStatus: AuditStatus | undefined = matched?.auditStatus;
  const rejectReason = matched?.rejectReason ?? null;
  const cloned = voiceClone?.cloned === true; // 认真有 voice_id,不依赖 engine/hasSample

  const uploadPct = Math.max(0, Math.min(100, uploadProgress));

  return (
    <Section title="声音复刻" subtitle="VOICE CLONE">
      <div className="space-y-3">
        {/* 状态行 */}
        <div className="flex items-center gap-2 text-[12px]">
          {cloned ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
              ✅ 已用你本人的声音复刻
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-warm-100 px-2.5 py-1 font-medium text-ink-600">
              还没复刻你的声音
            </span>
          )}
          {voiceStatus && <AuditBadge status={voiceStatus} rejectReason={rejectReason} />}
        </div>

        {/* ── idle:录音 / 选文件 ── */}
        {phase === 'idle' && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void startRec()}
              className="w-full rounded-full bg-gradient-cta py-2.5 text-[13px] font-semibold text-white active:scale-[0.99]"
            >
              🎙️ 录一段我的声音
            </button>
            <label className="block">
              <input type="file" accept="audio/*" className="hidden" onChange={onFilePicked} />
              <span className="block w-full cursor-pointer rounded-full border border-warm-300 bg-white py-2 text-center text-[12px] text-warm-700 active:bg-warm-50">
                或从文件选择
              </span>
            </label>
            <div className="text-center text-[10px] text-ink-500">录 15-30 秒 · 或选 mp3/m4a/wav（最大 10MB）</div>
          </div>
        )}

        {/* ── recording ── */}
        {phase === 'recording' && (
          <button
            type="button"
            onClick={stopRec}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-rose-500 py-2.5 text-[13px] font-semibold text-white active:scale-[0.99]"
          >
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
            录音中 {recSecs}s · 点此停止
          </button>
        )}

        {/* ── reviewing:本地试听确认 ── */}
        {phase === 'reviewing' && localPreviewUrl && (
          <div className="space-y-2 rounded-xl border border-primary-100 bg-primary-50/40 p-3">
            <div className="text-[12px] font-medium text-ink-700">先听听你录的，满意再提交合成</div>
            <audio src={localPreviewUrl} controls className="h-9 w-full" />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={reRecord}
                className="flex-1 rounded-full border border-warm-300 bg-white py-2 text-[12px] text-warm-700 active:bg-warm-50"
              >
                重录
              </button>
              <button
                type="button"
                onClick={() => void confirmSubmit()}
                className="flex-1 rounded-full bg-gradient-cta py-2 text-[12px] font-semibold text-white active:scale-[0.99]"
              >
                确认 · 开始合成
              </button>
            </div>
          </div>
        )}

        {/* ── submitting:合成进度 ── */}
        {phase === 'submitting' && (
          <div className="space-y-2 rounded-xl border border-primary-100 bg-white p-3">
            {submitError ? (
              <>
                <div className="text-[12px] font-medium text-rose-600">合成失败</div>
                <div className="text-[11px] leading-5 text-ink-600">{submitError}</div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={reRecord}
                    className="flex-1 rounded-full border border-warm-300 bg-white py-2 text-[12px] text-warm-700 active:bg-warm-50"
                  >
                    重录
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmSubmit()}
                    className="flex-1 rounded-full bg-gradient-cta py-2 text-[12px] font-semibold text-white active:scale-[0.99]"
                  >
                    重试
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-[12px] font-medium text-ink-700">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-300 border-t-primary-600" />
                  {subStage ? SUBSTAGE_LABEL[subStage] : '处理中…'}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-warm-100">
                  <div
                    className="h-full rounded-full bg-gradient-cta transition-all duration-300"
                    style={{
                      width:
                        subStage === 'uploading'
                          ? `${Math.round(uploadPct * 0.4)}%`
                          : subStage === 'cloning'
                            ? '80%'
                            : subStage === 'preparing'
                              ? '95%'
                              : '100%',
                    }}
                  />
                </div>
                {subStage === 'uploading' && (
                  <div className="text-right text-[10px] text-ink-500">{uploadPct}%</div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── done:试听真克隆 ── */}
        {phase === 'done' && (
          <div className="space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
            <div className="text-[12px] font-medium text-ink-700">试听你的声音</div>
            {voicePreview && <audio src={voicePreview} controls autoPlay className="h-9 w-full" />}
            <button
              type="button"
              onClick={() => void previewMyVoice()}
              disabled={voiceBusy}
              className="w-full rounded-full bg-gradient-cta py-2 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {voiceBusy ? '生成中…' : '试听你的声音'}
            </button>
            <button
              type="button"
              onClick={reRecord}
              className="w-full rounded-full border border-warm-300 bg-white py-1.5 text-[11px] text-warm-700 active:bg-warm-50"
            >
              重新录制替换
            </button>
          </div>
        )}

        {toast && (
          <div className="rounded-lg bg-ink-800/90 px-3 py-2 text-center text-[11px] text-white">{toast}</div>
        )}
      </div>
    </Section>
  );
}
