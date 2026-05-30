/**
 * 技师真人核验提交页 · M11 Phase 1
 *
 * 流程: 技师录 10s 自我介绍视频 → 上传 → finalize 自动建 priority=100 工单 → admin/verifications 审核 → 通过自动写 therapists.verificationStatus='passed'
 * 简化版: 本期不做随机口型挑战字符串(独立反 deepfake PR)
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TherapistShell } from '@/components/AppShell';
import { LoadingFull, Section } from '@/components/ui';
import { MediaUploader } from '@/components/upload/MediaUploader';
import { apiGet } from '@/lib/api';
import type { MediaAsset } from '@/lib/upload';

interface MyProfile {
  displayName: string | null;
  verificationStatus: string;
  verifiedAt?: string | null;
}

export default function TherapistVerifyPage() {
  const [me, setMe] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [justSubmitted, setJustSubmitted] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setMe(await apiGet<MyProfile>('/therapists/me'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleUploaded = (_asset: MediaAsset) => {
    setJustSubmitted(true);
    // 刷新一次 profile 拿最新 verificationStatus(可能由后端 finalize 时不会立即变成 in_review · 但 audit 工单已建)
    void (async () => {
      try {
        setMe(await apiGet<MyProfile>('/therapists/me'));
      } catch {
        // 静默
      }
    })();
  };

  if (loading || !me) return <TherapistShell><LoadingFull /></TherapistShell>;

  const status = me.verificationStatus;
  const noneStatus = { label: '未提交', color: 'text-ink-500 bg-warm-50' };
  const statusLabel: Record<string, { label: string; color: string }> = {
    passed: { label: '✓ 已认证', color: 'text-success-500 bg-success-500/10' },
    pending: { label: '⏳ 审核中', color: 'text-warning-500 bg-warning-500/10' },
    in_review: { label: '⏳ 审核中', color: 'text-warning-500 bg-warning-500/10' },
    failed: { label: '✗ 上次未通过', color: 'text-danger-500 bg-danger-500/10' },
  };
  const cur = statusLabel[status] ?? noneStatus;

  return (
    <TherapistShell title="真人核验" showBack>
      <div className="px-5 pb-6 pt-4">
        {/* 当前状态 */}
        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div className="text-[11px] text-ink-500">当前状态</div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-medium ${cur.color}`}>
              {cur.label}
            </span>
            {me.verifiedAt && status === 'passed' && (
              <span className="text-[10px] text-ink-500">
                {new Date(me.verifiedAt).toLocaleDateString('zh-CN')} 认证
              </span>
            )}
          </div>
          {status === 'passed' && (
            <div className="mt-2 text-[11px] text-ink-600">
              客户进你的档案会看到"已认证"勋章 · 信任度 +60% · 接单率显著提升
            </div>
          )}
          {justSubmitted && status !== 'passed' && (
            <div className="mt-2 rounded-lg border border-success-500/20 bg-success-500/5 px-3 py-2 text-[11px] text-success-500">
              ✓ 视频已提交 · 24 小时内 admin 完成审核 · 通过后档案立即显示认证勋章
            </div>
          )}
        </div>

        {/* 提交指引 */}
        <Section title="提交指引" subtitle="GUIDELINE">
          <ol className="space-y-3 text-[13px] text-ink-700">
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                1
              </span>
              <div>
                <strong>录制约 10 秒视频</strong>
                <div className="text-[11px] text-ink-500">用手机前置摄像头 · 横竖屏均可</div>
              </div>
            </li>
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                2
              </span>
              <div>
                <strong>正面入镜 · 光线充足</strong>
                <div className="text-[11px] text-ink-500">五官清晰 · 不戴口罩/墨镜</div>
              </div>
            </li>
            <li className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                3
              </span>
              <div>
                <strong>说出以下内容</strong>
                <div className="mt-1 rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-[12px] text-ink-700">
                  "我是 <span className="font-bold text-warm-700">{me.displayName ?? '[请先去档案设置昵称]'}</span>，正在 LoveRush 申请技师认证"
                </div>
              </div>
            </li>
          </ol>
        </Section>

        {/* 上传区 */}
        <Section title="提交视频" subtitle="UPLOAD">
          <div className="rounded-2xl border border-warm-200 bg-warm-50 p-4">
            <MediaUploader purpose="liveness" visibility="platform_only" onComplete={handleUploaded}>
              <button
                type="button"
                className="w-full rounded-full bg-gradient-cta py-3 text-[14px] font-semibold text-white active:scale-[0.98]"
              >
                选择视频文件
              </button>
            </MediaUploader>
            <div className="mt-2 text-center text-[10px] text-ink-500">mp4/mov/webm · 最大 100MB · 仅平台可见 · 永久加密保留</div>
          </div>
        </Section>

        {/* 隐私声明 */}
        <Section title="隐私" subtitle="PRIVACY">
          <ul className="space-y-1.5 text-[11px] leading-5 text-ink-600">
            <li>· 该视频仅用于身份核验 · 不会出现在你的公开档案</li>
            <li>· 仅 LoveRush 平台审核员可查看 · 客户永远看不到</li>
            <li>· 数据加密存储 · 不参与任何 AI 训练</li>
            <li>· 通过认证后档案显示"已认证"勋章 · 不显示视频本身</li>
          </ul>
        </Section>

        <div className="mt-4 text-center text-[11px]">
          <Link href="/t/me/media" className="text-warm-700 active:text-warm-500">
            ← 返回媒体管理
          </Link>
        </div>
      </div>
    </TherapistShell>
  );
}
