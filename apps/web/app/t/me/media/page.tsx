/**
 * 技师媒体管理 · M11 Phase 1
 *
 * 4 区块: 头像 / 语音介绍 / 短视频 / 相册
 *
 * 流程: 选文件 → useMediaUpload 走完 upload-init/PUT/finalize → PUT /therapists/me 写回 url 字段 → 刷新
 * 加载: 并行 GET /therapists/me + GET /therapists/me/media · 用 publicUrl 关联审核状态
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TherapistShell } from '@/components/AppShell';
import { Avatar, LoadingFull, Section } from '@/components/ui';
import { MediaUploader } from '@/components/upload/MediaUploader';
import { AuditBadge, type AuditStatus } from '@/components/upload/AuditBadge';
import { GalleryEditor, type GalleryItem } from '@/components/upload/GalleryEditor';
import { apiGet, apiPut } from '@/lib/api';
import type { MediaAsset } from '@/lib/upload';

interface MyProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  voiceIntroUrl: string | null;
  shortVideoUrl: string | null;
  galleryJson: GalleryItem[] | null;
  verificationStatus: string;
}

export default function TherapistMediaPage() {
  const [me, setMe] = useState<MyProfile | null>(null);
  const [mediaList, setMediaList] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const reload = useCallback(async () => {
    const [profile, media] = await Promise.all([
      apiGet<MyProfile>('/therapists/me'),
      apiGet<MediaAsset[]>('/therapists/me/media'),
    ]);
    setMe(profile);
    setMediaList(media);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await reload();
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

  // 按 publicUrl 反查审核状态
  const statusByUrl: Record<string, AuditStatus> = {};
  const rejectByUrl: Record<string, string | null> = {};
  for (const m of mediaList) {
    if (m.publicUrl) {
      statusByUrl[m.publicUrl] = m.auditStatus;
      rejectByUrl[m.publicUrl] = m.rejectReason ?? null;
    }
  }

  const handleAvatarUploaded = async (asset: MediaAsset) => {
    if (!asset.publicUrl) return;
    await apiPut('/therapists/me', { avatarUrl: asset.publicUrl });
    await reload();
    showToast('头像已提交 · 24h 内审核 · 通过后客户可见');
  };
  const handleVoiceUploaded = async (asset: MediaAsset) => {
    if (!asset.publicUrl) return;
    await apiPut('/therapists/me', { voiceIntroUrl: asset.publicUrl });
    await reload();
    showToast('语音介绍已提交 · 审核中');
  };
  const handleVideoUploaded = async (asset: MediaAsset) => {
    if (!asset.publicUrl) return;
    await apiPut('/therapists/me', { shortVideoUrl: asset.publicUrl });
    await reload();
    showToast('短视频已提交 · 审核中');
  };
  const handleGalleryChange = async (next: GalleryItem[]) => {
    await apiPut('/therapists/me', { galleryJson: next });
    await reload();
  };

  if (loading || !me) return <TherapistShell><LoadingFull /></TherapistShell>;

  // TS noUncheckedIndexedAccess · 索引访问返 T|undefined · 单独提取避免重复判空
  const avatarStatus: AuditStatus | undefined = me.avatarUrl ? statusByUrl[me.avatarUrl] : undefined;
  const voiceStatus: AuditStatus | undefined = me.voiceIntroUrl ? statusByUrl[me.voiceIntroUrl] : undefined;
  const videoStatus: AuditStatus | undefined = me.shortVideoUrl ? statusByUrl[me.shortVideoUrl] : undefined;

  return (
    <TherapistShell title="媒体管理" showBack>
      {toast && (
        <div className="sticky top-0 z-20 mx-3 mt-2 rounded-xl border border-success-500/30 bg-success-500/5 px-3 py-2 text-[12px] text-success-500 shadow-warm-sm">
          {toast}
        </div>
      )}

      {/* 头像 */}
      <Section title="头像" subtitle="AVATAR">
        <div className="flex items-center gap-4">
          <Avatar src={me.avatarUrl ?? undefined} size={72} />
          <div className="flex-1">
            <div className="mb-1.5 flex items-center gap-2">
              {me.avatarUrl && avatarStatus && (
                <AuditBadge status={avatarStatus} rejectReason={rejectByUrl[me.avatarUrl]} />
              )}
            </div>
            <MediaUploader purpose="avatar" onComplete={handleAvatarUploaded}>
              <button
                type="button"
                className="rounded-full border border-warm-300 bg-white px-4 py-2 text-[12px] text-warm-700 active:bg-warm-50"
              >
                {me.avatarUrl ? '更换头像' : '上传头像'}
              </button>
            </MediaUploader>
            <div className="mt-1 text-[10px] text-ink-500">jpg/png/webp · 最大 5MB</div>
          </div>
        </div>
      </Section>

      {/* 语音介绍 */}
      <Section title="语音介绍" subtitle="VOICE INTRO">
        <div className="space-y-2">
          {me.voiceIntroUrl ? (
            <div className="flex items-center gap-3 rounded-xl border border-warm-100 bg-white px-3 py-2">
              <audio src={me.voiceIntroUrl} controls className="flex-1" preload="metadata" />
              {voiceStatus && (
                <AuditBadge status={voiceStatus} rejectReason={rejectByUrl[me.voiceIntroUrl]} />
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-warm-200 bg-warm-50 px-3 py-4 text-center text-[12px] text-ink-500">
              还没传语音介绍 · 建议录制 15-30 秒自我介绍
            </div>
          )}
          <MediaUploader purpose="voice_intro" onComplete={handleVoiceUploaded}>
            <button
              type="button"
              className="w-full rounded-full border border-warm-300 bg-white py-2 text-[12px] text-warm-700 active:bg-warm-50"
            >
              {me.voiceIntroUrl ? '更换语音介绍' : '上传语音介绍'}
            </button>
          </MediaUploader>
          <div className="text-center text-[10px] text-ink-500">mp3/m4a/wav · 最大 10MB</div>
        </div>
      </Section>

      {/* 短视频 */}
      <Section title="短视频" subtitle="SHORT VIDEO">
        <div className="space-y-2">
          {me.shortVideoUrl ? (
            <div className="space-y-1.5">
              <video
                src={me.shortVideoUrl}
                controls
                className="w-full rounded-xl border border-warm-100 bg-black"
                playsInline
                preload="metadata"
                style={{ maxHeight: 320 }}
              />
              {videoStatus && (
                <div>
                  <AuditBadge status={videoStatus} rejectReason={rejectByUrl[me.shortVideoUrl]} />
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-warm-200 bg-warm-50 px-3 py-6 text-center text-[12px] text-ink-500">
              还没传短视频 · 建议 15 秒展示个人风采
            </div>
          )}
          <MediaUploader purpose="short_video" onComplete={handleVideoUploaded}>
            <button
              type="button"
              className="w-full rounded-full border border-warm-300 bg-white py-2 text-[12px] text-warm-700 active:bg-warm-50"
            >
              {me.shortVideoUrl ? '更换短视频' : '上传短视频'}
            </button>
          </MediaUploader>
          <div className="text-center text-[10px] text-ink-500">mp4/mov/webm · 最大 50MB</div>
        </div>
      </Section>

      {/* 相册 */}
      <Section title="相册" subtitle={`GALLERY · ${me.galleryJson?.length ?? 0} 张`}>
        <GalleryEditor
          items={me.galleryJson ?? []}
          onChange={handleGalleryChange}
          auditStatusByUrl={statusByUrl}
          rejectReasonByUrl={rejectByUrl}
        />
      </Section>

      {/* 真人核验入口 */}
      <Section title="真人核验" subtitle="VERIFICATION">
        <Link
          href="/t/me/verify"
          className="flex items-center justify-between rounded-2xl border border-warm-100 bg-white px-4 py-3 active:bg-warm-50"
        >
          <div>
            <div className="text-[13px] text-ink-800">真人核验录像</div>
            <div className="mt-0.5 text-[11px] text-ink-500">
              {me.verificationStatus === 'passed'
                ? '✓ 已认证 · 档案显示认证勋章'
                : me.verificationStatus === 'pending' || me.verificationStatus === 'in_review'
                  ? '⏳ 审核中 · 24h 内出结果'
                  : me.verificationStatus === 'failed'
                    ? '✗ 上次核验未通过 · 可重新提交'
                    : '未提交 · 提交后客户可见认证勋章'}
            </div>
          </div>
          <span className="text-lg text-ink-300">›</span>
        </Link>
      </Section>

      <div className="h-8" />
    </TherapistShell>
  );
}
