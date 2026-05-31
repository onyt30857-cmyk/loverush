/**
 * 相册编辑器 · M11 Phase 1
 *
 * 网格展示 galleryJson 的图片 · 每张支持:
 *   - 标 isPaid + 设解锁价(积分)
 *   - 删除(仅移除 galleryJson 项 · media_assets 软删独立 job)
 *
 * 加图: 内嵌 MediaUploader · purpose='gallery' · 上传完追加到数组 · PUT therapists/me 写回。
 *
 * galleryJson 项格式(对齐 schema 的 PatchBody zod):
 *   { url: string, isPaid: boolean, thumbnailUrl?: string, pricePoints?: number }
 */
'use client';

import { useState } from 'react';
import { MediaUploader } from './MediaUploader';
import { AuditBadge, type AuditStatus } from './AuditBadge';
import { useDialog } from '@/components/UIDialog';
import type { MediaAsset } from '@/lib/upload';

export interface GalleryItem {
  url: string;
  isPaid: boolean;
  thumbnailUrl?: string;
  pricePoints?: number;
}

export function GalleryEditor({
  items,
  onChange,
  // 用 publicUrl 反查 auditStatus(由父页面 GET /me/media 提供)
  auditStatusByUrl,
  rejectReasonByUrl,
  maxItems = 50,
}: {
  items: GalleryItem[];
  onChange: (next: GalleryItem[]) => Promise<void> | void;
  auditStatusByUrl: Record<string, AuditStatus>;
  rejectReasonByUrl: Record<string, string | null>;
  maxItems?: number;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const { confirm } = useDialog();

  const handleUploaded = async (asset: MediaAsset) => {
    if (!asset.publicUrl) return;
    const next: GalleryItem[] = [
      ...items,
      {
        url: asset.publicUrl,
        isPaid: false,
        thumbnailUrl: asset.thumbnailUrl ?? undefined,
      },
    ];
    await onChange(next);
  };

  const handleDelete = async (idx: number) => {
    const ok = await confirm({ title: '删除这张图?', message: '相册里会立即移除', confirmText: '删除', danger: true });
    if (!ok) return;
    setBusyIdx(idx);
    try {
      const next = items.filter((_, i) => i !== idx);
      await onChange(next);
      if (editingIdx === idx) setEditingIdx(null);
    } finally {
      setBusyIdx(null);
    }
  };

  const handleTogglePaid = async (idx: number) => {
    setBusyIdx(idx);
    try {
      const next = items.map((it, i) =>
        i === idx ? { ...it, isPaid: !it.isPaid, pricePoints: !it.isPaid ? (it.pricePoints ?? 50) : undefined } : it,
      );
      await onChange(next);
    } finally {
      setBusyIdx(null);
    }
  };

  const handlePriceChange = async (idx: number, price: number) => {
    setBusyIdx(idx);
    try {
      const next = items.map((it, i) => (i === idx ? { ...it, pricePoints: price } : it));
      await onChange(next);
    } finally {
      setBusyIdx(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {/* 加号按钮 · 第一格 */}
        {items.length < maxItems && (
          <MediaUploader purpose="gallery" onComplete={handleUploaded}>
            <div className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-warm-300 bg-warm-50 text-3xl text-warm-500 transition active:bg-warm-100">
              +
            </div>
          </MediaUploader>
        )}

        {items.map((it, idx) => {
          const status = auditStatusByUrl[it.url];
          return (
            <div key={`${it.url}-${idx}`} className="relative">
              <div
                className="relative aspect-square overflow-hidden rounded-xl border border-warm-100 bg-warm-50"
                onClick={() => setEditingIdx(idx === editingIdx ? null : idx)}
              >
                <img src={it.thumbnailUrl ?? it.url} alt="" className="h-full w-full object-cover" />
                {it.isPaid && (
                  <div className="absolute right-1 top-1 rounded bg-primary px-1 py-0.5 text-[9px] font-bold text-white">
                    🔒 {it.pricePoints ?? '?'}
                  </div>
                )}
                {status && (
                  <div className="absolute bottom-1 left-1">
                    <AuditBadge status={status} rejectReason={rejectReasonByUrl[it.url]} />
                  </div>
                )}
                {busyIdx === idx && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <div className="text-xs text-white">处理中…</div>
                  </div>
                )}
              </div>

              {editingIdx === idx && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-xl border border-warm-200 bg-white p-2 shadow-warm-md">
                  <div className="flex items-center justify-between gap-1 text-[11px]">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={it.isPaid}
                        onChange={() => handleTogglePaid(idx)}
                        className="h-3 w-3"
                      />
                      <span>付费图</span>
                    </label>
                  </div>
                  {it.isPaid && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        max={9999}
                        value={it.pricePoints ?? 50}
                        onChange={(e) => handlePriceChange(idx, Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-14 rounded border border-warm-200 px-1.5 py-0.5 text-[11px]"
                      />
                      <span className="text-[10px] text-warm-700">积分</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(idx)}
                    className="mt-1.5 w-full rounded border border-danger-500/30 px-2 py-0.5 text-[11px] text-danger-500 active:bg-danger-500/5"
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {items.length === 0 && (
        <div className="text-center text-[11px] text-ink-500">
          还没有相册图 · 点 + 添加(支持 jpg/png/webp · 最大 20MB)
        </div>
      )}
      <div className="text-center text-[10px] text-ink-500">
        当前 {items.length}/{maxItems} 张 · 付费图客户需用积分解锁查看
      </div>
    </div>
  );
}
