/**
 * 通用媒体上传 · M11 Phase 1
 *
 * 隐藏 <input type="file"> + 自渲染触发按钮(children) + 上传中浮层进度条。
 * 调用方传 purpose · 内部自动 mime/size 校验 · 走 useMediaUpload 全链路。
 */
'use client';

import { useRef } from 'react';
import {
  useMediaUpload,
  MIME_WHITELIST,
  type MediaPurpose,
  type MediaAsset,
  type Visibility,
} from '@/lib/upload';

export function MediaUploader({
  purpose,
  visibility,
  unlockPricePoints,
  onComplete,
  children,
  className = '',
  disabled,
}: {
  purpose: MediaPurpose;
  visibility?: Visibility;
  unlockPricePoints?: number;
  onComplete: (asset: MediaAsset) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { stage, progress, error, upload, reset } = useMediaUpload();

  const accept = MIME_WHITELIST[purpose].join(',');

  const handlePick = () => {
    if (disabled || stage === 'uploading' || stage === 'requesting' || stage === 'finalizing') return;
    reset();
    inputRef.current?.click();
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 让同一个文件可被再次选中
    if (!file) return;
    try {
      const asset = await upload(file, purpose, { visibility, unlockPricePoints });
      onComplete(asset);
    } catch {
      // error 已存到 hook state · UI 自己显示
    }
  };

  const busy = stage === 'requesting' || stage === 'uploading' || stage === 'finalizing';
  const stageLabel =
    stage === 'requesting'
      ? '准备中…'
      : stage === 'uploading'
        ? `上传中 ${progress}%`
        : stage === 'finalizing'
          ? '收尾中…'
          : '';

  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
      />
      <div onClick={handlePick} className={busy || disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer'}>
        {children}
      </div>

      {busy && (
        <div className="mt-2 rounded-xl border border-warm-200 bg-warm-50 px-3 py-2">
          <div className="flex items-center justify-between text-[11px] text-warm-700">
            <span>{stageLabel}</span>
            <span className="num">{progress}%</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white">
            <div
              className="h-full bg-gradient-warm-rose transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && stage === 'error' && (
        <div className="mt-2 rounded-xl border border-danger-500/30 bg-danger-500/5 px-3 py-2 text-[11px] text-danger-500">
          {error}
        </div>
      )}
    </div>
  );
}
