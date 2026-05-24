'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Avatar, EmptyState, ErrorBanner, GhostButton, LoadingFull, PointsTag, PrimaryButton, Section } from '@/components/ui';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';

interface TherapistDetail {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  tags: string[] | null;
  nationality: string | null;
  serviceCity: string | null;
  scoreAppearance: number;
  scoreBody: number;
  scoreService: number;
  ratingCount: number;
  completedOrders: number;
  onlineStatus: string;
  galleryPublic: Array<{ url: string }>;
  galleryPaidCount: number;
  socialContacts?: Record<string, string>;
  basePriceJson?: Array<{ duration: number; pricePoints: number }>;
  preferencesJson?: {
    preferredCustomerTypes?: string[];
    acceptableBehaviors?: string[];
    unacceptableBehaviors?: string[];
  };
}

export default function TherapistDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<TherapistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);

  async function load() {
    try {
      const data = await apiGet<TherapistDetail>(`/therapists/${id}`);
      setT(data);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function unlock(type: 'social_contacts' | 'gallery_paid') {
    if (!t) return;
    setUnlocking(type);
    try {
      await apiPost(`/therapists/${t.id}/unlock`, { unlock_type: type });
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setUnlocking(null);
    }
  }

  async function openChat() {
    if (!t) return;
    try {
      const conv = await apiPost<{ id: string }>('/conversations', { therapist_user_id: t.userId });
      router.push(`/conversations/${conv.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  if (!t) {
    return (
      <AppShell title="技师详情" showBack hideTabBar>
        {error ? <div className="p-4"><ErrorBanner message={error} /></div> : <LoadingFull />}
      </AppShell>
    );
  }

  return (
    <AppShell title={t.displayName ?? '技师'} showBack hideTabBar>
      {/* 大头像 hero · 渐变背景 */}
      <div className="relative bg-gradient-soft px-5 pb-5 pt-6">
        <div className="flex items-start gap-4">
          <div className="relative">
            <Avatar src={t.avatarUrl ?? undefined} size={88} />
            {t.onlineStatus === 'online' && (
              <span className="absolute bottom-0 right-0 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-warm-sm">
                <span className="h-2 w-2 rounded-full bg-success-500 animate-dot-pulse" />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <div className="text-serif-cn text-xl font-bold text-ink-800">{t.displayName ?? '技师'}</div>
            <div className="label-cormorant mt-1">
              {[t.serviceCity, t.nationality].filter(Boolean).join(' · ')}
            </div>
            {t.onlineStatus === 'online' && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-success-500/10 px-2.5 py-0.5 text-[10px] font-medium text-success-500">
                <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
                现在在线
              </div>
            )}
          </div>
        </div>

        {/* 三维评分卡 */}
        <div className="mt-5 grid grid-cols-3 gap-2">
          {[
            { label: '颜值', value: t.scoreAppearance, abbr: 'Look' },
            { label: '身材', value: t.scoreBody, abbr: 'Body' },
            { label: '服务', value: t.scoreService, abbr: 'Service' },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-white p-3 text-center shadow-warm-xs">
              <div className="label-cormorant text-[9px]">{s.abbr.toUpperCase()}</div>
              <div className="mt-1 text-display text-xl font-bold text-primary num">
                {(s.value / 10).toFixed(1)}
              </div>
              <div className="mt-0.5 text-[10px] text-ink-600">{s.label}</div>
            </div>
          ))}
        </div>

        {t.bio && <p className="mt-4 text-sm leading-7 text-ink-700">{t.bio}</p>}

        {t.tags && t.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {t.tags.map((tag) => (
              <span key={tag} className="rounded-full border border-warm-200 bg-white px-2.5 py-0.5 text-xs text-warm-700">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <ErrorBanner message={error} />

      {t.galleryPublic.length > 0 && (
        <Section title="相册">
          <div className="grid grid-cols-3 gap-2">
            {t.galleryPublic.map((g, i) => (
              <img key={i} src={g.url} alt="" className="aspect-square rounded-xl object-cover" />
            ))}
          </div>
          {t.galleryPaidCount > 0 && !t.socialContacts && (
            <button
              type="button"
              onClick={() => void unlock('gallery_paid')}
              disabled={unlocking === 'gallery_paid'}
              className="mt-3 w-full rounded-xl border border-warm-300 bg-warm-50 py-2 text-sm text-warm-700"
            >
              解锁 {t.galleryPaidCount} 张高清付费相册（200 积分）
            </button>
          )}
        </Section>
      )}

      {t.basePriceJson && t.basePriceJson.length > 0 && (
        <Section title="价格" subtitle="PRICE LIST">
          <div className="space-y-2">
            {t.basePriceJson.map((p, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-2xl border border-warm-100 bg-white px-4 py-3 shadow-warm-xs"
              >
                <span className="text-sm text-ink-700">
                  {p.duration} <span className="text-cormorant text-[11px] text-ink-600">分钟</span>
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-display text-lg font-bold text-primary num">{p.pricePoints}</span>
                  <span className="text-[10px] text-ink-500">积分</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {t.preferencesJson && (
        <Section title="风格">
          {t.preferencesJson.preferredCustomerTypes && t.preferencesJson.preferredCustomerTypes.length > 0 && (
            <div className="mb-2 text-xs text-ink-700">
              偏好：{t.preferencesJson.preferredCustomerTypes.join(' / ')}
            </div>
          )}
          {t.preferencesJson.unacceptableBehaviors && t.preferencesJson.unacceptableBehaviors.length > 0 && (
            <div className="text-xs text-ink-500">
              不接受：{t.preferencesJson.unacceptableBehaviors.join(' / ')}
            </div>
          )}
        </Section>
      )}

      <Section title="联系方式">
        {t.socialContacts ? (
          <div className="space-y-1.5 text-sm">
            {Object.entries(t.socialContacts).map(([k, v]) => (
              <div key={k} className="flex justify-between rounded-xl bg-ink-50 px-3 py-2">
                <span className="text-ink-500">{k}</span>
                <span className="font-mono text-ink-900">{v}</span>
              </div>
            ))}
          </div>
        ) : (
          <GhostButton onClick={() => void unlock('social_contacts')}>
            {unlocking === 'social_contacts' ? '解锁中…' : '解锁联系方式（100 积分）'}
          </GhostButton>
        )}
      </Section>

      <div className="sticky bottom-0 grid grid-cols-2 gap-3 border-t border-warm-100 bg-white/95 p-4 backdrop-blur">
        <GhostButton onClick={() => void openChat()}>💬 私聊</GhostButton>
        <PrimaryButton onClick={() => router.push(`/therapist/${t.id}/order`)}>立即下单</PrimaryButton>
      </div>
    </AppShell>
  );
}
