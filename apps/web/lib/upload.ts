/**
 * 媒体上传 hook · M11 Phase 1
 *
 * 3 步链路:
 *   1. POST /therapists/me/media/upload-init → {mediaId, uploadUrl, r2Key}
 *   2. XHR PUT uploadUrl + file (带 progress) · 若 stub URL 跳过
 *   3. POST /therapists/me/media/finalize → MediaAsset
 *
 * 复用现有 apiPost(JSON) · 仅 PUT binary 走原生 XHR(fetch 监听上传进度太麻烦)。
 * R2 stub fallback: 开发环境无 R2 凭证时 uploadUrl 含 ?stub=1 · 跳过 step 2 仍可走完闭环。
 */

import { useState, useCallback } from 'react';
import { apiPost } from './api';

export type MediaPurpose =
  | 'avatar'
  | 'voice_intro'
  | 'short_video'
  | 'gallery'
  | 'liveness'
  | 'chat_attachment';

export type Visibility = 'public' | 'paid_unlock' | 'platform_only';

export interface MediaAsset {
  id: string;
  purpose: MediaPurpose | string;
  publicUrl: string | null;
  thumbnailUrl?: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  durationMs?: number | null;
  widthPx?: number | null;
  heightPx?: number | null;
  visibility: Visibility | string;
  unlockPricePoints?: number | null;
  auditStatus: 'pending' | 'approved' | 'rejected';
  rejectReason?: string | null;
  createdAt: string;
}

interface InitResp {
  mediaId: string;
  uploadUrl: string;
  r2Key: string;
  expiresInSeconds: number;
}

export type UploadStage = 'idle' | 'requesting' | 'uploading' | 'finalizing' | 'done' | 'error';

// 与服务端 services/media.ts L38-45 完全一致
export const MAX_SIZE_BYTES: Record<MediaPurpose, number> = {
  avatar: 5 * 1024 * 1024,
  voice_intro: 10 * 1024 * 1024,
  short_video: 50 * 1024 * 1024,
  gallery: 20 * 1024 * 1024,
  liveness: 100 * 1024 * 1024,
  chat_attachment: 30 * 1024 * 1024,
};

export const MIME_WHITELIST: Record<MediaPurpose, string[]> = {
  avatar: ['image/jpeg', 'image/png', 'image/webp'],
  voice_intro: ['audio/mp3', 'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/wav', 'audio/x-m4a'],
  short_video: ['video/mp4', 'video/quicktime', 'video/webm'],
  gallery: ['image/jpeg', 'image/png', 'image/webp'],
  liveness: ['video/mp4', 'video/quicktime', 'video/webm'],
  chat_attachment: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
};

function extOf(file: File): string {
  const m = file.name.match(/\.([a-z0-9]{1,8})$/i);
  return (m?.[1] ?? file.type.split('/')[1] ?? 'bin').toLowerCase();
}

export function validateFile(
  file: File,
  purpose: MediaPurpose,
): { ok: true } | { ok: false; reason: string } {
  const allowedMime = MIME_WHITELIST[purpose];
  if (!allowedMime.includes(file.type)) {
    return { ok: false, reason: `不支持的格式 ${file.type || '未知'} · 请选择 ${allowedMime.map((m) => m.split('/')[1]).join(' / ')}` };
  }
  const maxBytes = MAX_SIZE_BYTES[purpose];
  if (file.size > maxBytes) {
    return { ok: false, reason: `文件超过 ${(maxBytes / 1024 / 1024).toFixed(0)}MB 限制` };
  }
  return { ok: true };
}

/** 提取图片尺寸 · 失败返 undefined 不阻塞上传 */
export async function readImageDims(file: File): Promise<{ widthPx: number; heightPx: number } | undefined> {
  if (!file.type.startsWith('image/')) return undefined;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ widthPx: img.naturalWidth, heightPx: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    img.src = url;
  });
}

/** 提取视频时长 + 首帧缩略图 dataURL · 失败返 undefined */
export async function readVideoMeta(file: File): Promise<
  | {
      durationMs: number;
      widthPx?: number;
      heightPx?: number;
      thumbnailDataUrl?: string;
    }
  | undefined
> {
  if (!file.type.startsWith('video/')) return undefined;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadeddata = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 240;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const thumb = canvas.toDataURL('image/jpeg', 0.7);
        URL.revokeObjectURL(url);
        resolve({
          durationMs: Math.round(video.duration * 1000),
          widthPx: video.videoWidth,
          heightPx: video.videoHeight,
          thumbnailDataUrl: thumb,
        });
      } catch {
        URL.revokeObjectURL(url);
        resolve({ durationMs: Math.round(video.duration * 1000) });
      }
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    video.src = url;
  });
}

/** 提取音频时长 · 失败返 undefined */
export async function readAudioMeta(file: File): Promise<{ durationMs: number } | undefined> {
  if (!file.type.startsWith('audio/')) return undefined;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ durationMs: Math.round(audio.duration * 1000) });
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    audio.src = url;
  });
}

/** XHR PUT binary 带进度 · 返 Promise<void> · 失败 throw */
function xhrPutBinary(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`上传失败 HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('网络错误 · 上传中断'));
    xhr.ontimeout = () => reject(new Error('上传超时'));
    xhr.send(file);
  });
}

export interface UseUploadResult {
  stage: UploadStage;
  progress: number; // 0-100
  error: string | null;
  upload: (
    file: File,
    purpose: MediaPurpose,
    opts?: { visibility?: Visibility; unlockPricePoints?: number },
  ) => Promise<MediaAsset>;
  reset: () => void;
}

export function useMediaUpload(): UseUploadResult {
  const [stage, setStage] = useState<UploadStage>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStage('idle');
    setProgress(0);
    setError(null);
  }, []);

  const upload = useCallback(
    async (
      file: File,
      purpose: MediaPurpose,
      opts?: { visibility?: Visibility; unlockPricePoints?: number },
    ): Promise<MediaAsset> => {
      setError(null);
      setProgress(0);

      // 客户端校验
      const v = validateFile(file, purpose);
      if (!v.ok) {
        setError(v.reason);
        setStage('error');
        throw new Error(v.reason);
      }

      try {
        // 1. 申请上传 URL
        setStage('requesting');
        const init = await apiPost<InitResp>('/therapists/me/media/upload-init', {
          purpose,
          mime_type: file.type,
          size_bytes: file.size,
          ext: extOf(file),
        });

        // 2. 提取 meta(并行)
        const [imgDims, videoMeta, audioMeta] = await Promise.all([
          readImageDims(file),
          readVideoMeta(file),
          readAudioMeta(file),
        ]);

        // 3. PUT binary(若 stub 跳过)
        const isStub = init.uploadUrl.includes('?stub=1') || init.uploadUrl.includes('r2-stub.local');
        if (!isStub) {
          setStage('uploading');
          await xhrPutBinary(init.uploadUrl, file, setProgress);
        } else {
          // stub 模式下假装进度走完 · 让 UX 一致
          setStage('uploading');
          setProgress(100);
        }

        // 4. finalize
        setStage('finalizing');
        const finalized = await apiPost<MediaAsset>('/therapists/me/media/finalize', {
          media_id: init.mediaId,
          actual_size_bytes: file.size,
          duration_ms: videoMeta?.durationMs ?? audioMeta?.durationMs,
          width_px: imgDims?.widthPx ?? videoMeta?.widthPx,
          height_px: imgDims?.heightPx ?? videoMeta?.heightPx,
          // thumbnail_url: 本期不上传 thumbnail · 留独立 PR(需要再传一次 R2)
          visibility: opts?.visibility,
          unlock_price_points: opts?.unlockPricePoints,
        });

        setStage('done');
        return finalized;
      } catch (e) {
        const msg = e instanceof Error ? e.message : '上传失败';
        setError(msg);
        setStage('error');
        throw e;
      }
    },
    [],
  );

  return { stage, progress, error, upload, reset };
}
