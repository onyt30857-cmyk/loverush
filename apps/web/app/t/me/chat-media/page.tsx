/**
 * 技师聊天素材库 · M18 撩拨发图 Phase 3
 *
 * 客户要图时，分身会先撩他再发这些图：免费图养心动，私密图设价解锁。
 * 流程：MediaUploader(purpose=chat_attachment) 传图 → publicUrl → 填分级表单
 *   → POST /chat-media/me → reload。列表可启停(PATCH)/删除(DELETE)。
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { TherapistShell } from '@/components/AppShell';
import { LoadingFull, Section } from '@/components/ui';
import { MediaUploader } from '@/components/upload/MediaUploader';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import type { MediaAsset } from '@/lib/upload';

interface ChatMediaItem {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  tier: string;
  pricePoints: number;
  intimacyMin: number;
  weight: number;
  isActive: number;
}

const INTIMACY_LABELS = ['刚认识', '聊得来', '有点心动', '亲密', '难舍'];

export default function TherapistChatMediaPage() {
  const [list, setList] = useState<ChatMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  // 上传完成后待提交的草稿(填分级)
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [draftTier, setDraftTier] = useState<'free' | 'paid'>('free');
  const [draftPrice, setDraftPrice] = useState<number>(50);
  const [draftIntimacy, setDraftIntimacy] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const reload = useCallback(async () => {
    const rows = await apiGet<ChatMediaItem[]>('/chat-media/me');
    setList(rows);
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

  const handleUploaded = (asset: MediaAsset) => {
    if (!asset.publicUrl) return;
    setPendingUrl(asset.publicUrl);
    setDraftTier('free');
    setDraftPrice(50);
    setDraftIntimacy(0);
  };

  const submitDraft = async () => {
    if (!pendingUrl) return;
    setSaving(true);
    try {
      await apiPost('/chat-media/me', {
        url: pendingUrl,
        tier: draftTier,
        price_points: draftTier === 'paid' ? Math.max(0, Math.round(draftPrice)) : 0,
        intimacy_min: draftIntimacy,
        weight: 1,
      });
      setPendingUrl(null);
      await reload();
      showToast('已加进素材库 · 分身会在合适时机用上');
    } catch {
      showToast('添加失败 · 稍后再试');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (m: ChatMediaItem) => {
    const next = m.isActive === 1 ? 0 : 1;
    // 乐观更新
    setList((prev) => prev.map((x) => (x.id === m.id ? { ...x, isActive: next } : x)));
    try {
      await apiPatch(`/chat-media/me/${m.id}`, { is_active: next });
    } catch {
      setList((prev) => prev.map((x) => (x.id === m.id ? { ...x, isActive: m.isActive } : x)));
      showToast('操作失败 · 已还原');
    }
  };

  const remove = async (m: ChatMediaItem) => {
    setList((prev) => prev.filter((x) => x.id !== m.id));
    try {
      await apiDelete(`/chat-media/me/${m.id}`);
    } catch {
      await reload();
      showToast('删除失败 · 已还原');
    }
  };

  if (loading) return <TherapistShell><LoadingFull /></TherapistShell>;

  return (
    <TherapistShell title="聊天素材库" showBack>
      {toast && (
        <div className="sticky top-0 z-20 mx-3 mt-2 rounded-xl border border-success-500/30 bg-success-500/5 px-3 py-2 text-[12px] text-success-500 shadow-warm-sm">
          {toast}
        </div>
      )}

      {/* 引导文案 */}
      <div className="mx-3 mt-3 rounded-2xl border border-primary-100 bg-gradient-to-br from-primary-50/60 to-warm-50/60 p-4">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-primary-700">
          <span>🔥</span><span>她会替你把握分寸</span>
        </div>
        <div className="mt-1.5 text-[11.5px] leading-5 text-ink-600">
          客户要图时，分身会先撩他再发这些图。免费图养心动，私密图设价解锁。
        </div>
      </div>

      {/* 上传 + 分级草稿 */}
      <Section title="新增素材" subtitle="UPLOAD">
        {pendingUrl ? (
          <div className="space-y-3 rounded-2xl border border-warm-100 bg-white p-3">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pendingUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
              <div className="text-[12px] text-ink-600">这张怎么用？</div>
            </div>

            {/* tier 选择 */}
            <div className="flex gap-2">
              <TierChip active={draftTier === 'free'} onClick={() => setDraftTier('free')} label="免费钩子" hint="养心动" />
              <TierChip active={draftTier === 'paid'} onClick={() => setDraftTier('paid')} label="私密付费" hint="解锁才看" />
            </div>

            {/* paid 时填心动值 */}
            {draftTier === 'paid' && (
              <label className="block">
                <span className="text-[11px] text-ink-500">解锁需要的心动值</span>
                <input
                  type="number"
                  min={0}
                  value={draftPrice}
                  onChange={(e) => setDraftPrice(Number(e.target.value))}
                  className="num mt-1 w-full rounded-xl border border-warm-200 bg-warm-50 px-3 py-2 text-[14px] text-ink-800 outline-none focus:border-primary"
                />
              </label>
            )}

            {/* 亲密度门槛 */}
            <label className="block">
              <span className="text-[11px] text-ink-500">够熟了才会发 · 亲密度门槛</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {INTIMACY_LABELS.map((lbl, lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setDraftIntimacy(lvl)}
                    className={`rounded-full px-3 py-1 text-[11px] transition active:scale-95 ${
                      draftIntimacy === lvl
                        ? 'bg-gradient-cta text-white shadow-warm-sm'
                        : 'border border-warm-200 bg-white text-ink-600'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </label>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingUrl(null)}
                className="flex-1 rounded-full border border-warm-300 bg-white py-2 text-[12px] text-warm-700 active:bg-warm-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitDraft()}
                disabled={saving}
                className="flex-1 rounded-full bg-gradient-cta py-2 text-[12px] font-medium text-white shadow-rose-md disabled:opacity-50"
              >
                {saving ? '保存中…' : '加进素材库'}
              </button>
            </div>
          </div>
        ) : (
          <MediaUploader purpose="chat_attachment" onComplete={handleUploaded}>
            <button
              type="button"
              className="w-full rounded-2xl border border-dashed border-warm-300 bg-warm-50 py-6 text-[13px] text-warm-700 active:bg-warm-100"
            >
              + 上传一张图
            </button>
          </MediaUploader>
        )}
        <div className="mt-1.5 text-center text-[10px] text-ink-500">jpg/png/webp/gif · 最大 30MB</div>
      </Section>

      {/* 列表 */}
      <Section title="我的素材" subtitle={`LIBRARY · ${list.length} 张`}>
        {list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-warm-200 bg-warm-50 px-3 py-6 text-center text-[12px] text-ink-500">
            还没有素材 · 上传第一张，分身就能在聊天里用上
          </div>
        ) : (
          <div className="space-y-2">
            {list.map((m) => (
              <div
                key={m.id}
                className={`flex items-center gap-3 rounded-2xl border border-warm-100 bg-white p-2.5 ${
                  m.isActive === 1 ? '' : 'opacity-60'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.thumbnailUrl || m.url}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-xl object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {m.tier === 'paid' ? (
                      <span className="rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-medium text-primary-600">
                        私密付费 · {m.pricePoints} 心动值
                      </span>
                    ) : (
                      <span className="rounded-full bg-success-500/10 px-2 py-0.5 text-[10px] font-medium text-success-500">
                        免费钩子
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[10.5px] text-ink-500">
                    {INTIMACY_LABELS[m.intimacyMin] ?? `Lv${m.intimacyMin}`} 之后才会发
                  </div>
                </div>
                {/* 启停开关 */}
                <button
                  type="button"
                  onClick={() => void toggleActive(m)}
                  aria-label={m.isActive === 1 ? '停用' : '启用'}
                  className={`relative h-6 w-10 shrink-0 rounded-full transition ${
                    m.isActive === 1 ? 'bg-gradient-cta' : 'bg-ink-200'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      m.isActive === 1 ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </button>
                {/* 删除 */}
                <button
                  type="button"
                  onClick={() => void remove(m)}
                  aria-label="删除"
                  className="shrink-0 rounded-full px-2 py-1 text-[16px] text-ink-300 active:text-red-400"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="h-8" />
    </TherapistShell>
  );
}

function TierChip({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl border px-3 py-2 text-center transition active:scale-95 ${
        active
          ? 'border-primary bg-primary-50 text-primary-700'
          : 'border-warm-200 bg-white text-ink-600'
      }`}
    >
      <div className="text-[12px] font-medium">{label}</div>
      <div className="mt-0.5 text-[10px] text-ink-400">{hint}</div>
    </button>
  );
}
