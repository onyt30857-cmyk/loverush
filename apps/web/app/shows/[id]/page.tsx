/**
 * 客户 · 节目详情页 · M02b/M04 Phase 1
 *
 * 查看技师挂的节目 · 一键拍单
 * 点 CTA → /therapist/:therapistUserId/order?show_id=X
 *   拍单页拉 show 详情 + 显示加项 checkbox · 提交时 POST /orders body 含 source_show_id
 */
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, MapPin, Clock, Zap, Lock } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { LoadingFull } from '@/components/ui';
import { apiGet, ApiClientError } from '@/lib/api';

interface AddOn {
  name: string;
  pricePoints: number;
  isDefault?: boolean;
}

interface ShowDetail {
  id: string;
  therapist_user_id: string;
  category_code: string;
  start_time: string;
  duration_min: number;
  price_points: number;
  add_ons: AddOn[];
  includes_note: string | null;
  excludes_note: string | null;
  slots_total: number;
  slots_remaining: number;
  service_city: string | null;
  service_area: string | null;
  status: string;
  therapist_display_name: string | null;
  therapist_avatar_url: string | null;
  category_name_zh: string | null;
  category_icon_emoji: string | null;
}

export default function ShowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [show, setShow] = useState<ShowDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<ShowDetail>(`/shows/${id}`);
        setShow(data);
      } catch (err) {
        setError(err instanceof ApiClientError ? err.payload.message : String(err));
      }
    })();
  }, [id]);

  if (error) {
    return (
      <AppShell hideTabBar>
        <div className="px-6 py-16 text-center">
          <div className="text-4xl mb-3">😶</div>
          <div className="text-[15px] font-semibold text-ink-800">节目不存在或已结束</div>
          <div className="mt-1 text-[12px] text-ink-500">{error}</div>
          <Link href="/home" className="mt-4 inline-block text-primary text-[13px]">返回首页 →</Link>
        </div>
      </AppShell>
    );
  }

  if (!show) return <AppShell hideTabBar><LoadingFull /></AppShell>;

  const isOpen = show.status === 'open';
  const isSoldOut = show.slots_remaining <= 0;
  const startDate = new Date(show.start_time);
  const isPast = startDate.getTime() < Date.now();
  const canBook = isOpen && !isSoldOut && !isPast;

  return (
    <AppShell hideTabBar fill>
      <div className="relative h-full bg-gradient-soft pb-24">
        {/* Hero */}
        <div className="relative h-64 overflow-hidden">
          {show.therapist_avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={show.therapist_avatar_url}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{ objectPosition: 'center 25%' }}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-warm-rose" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent" />

          <button
            type="button"
            onClick={() => router.back()}
            className="absolute top-4 left-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/30 backdrop-blur text-white active:scale-95"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="absolute bottom-4 left-5 right-5 z-10 text-white">
            <div className="flex items-center gap-2 text-[12px] mb-1">
              <span className="rounded-full bg-white/20 backdrop-blur px-2 py-0.5">
                {show.category_icon_emoji} {show.category_name_zh ?? show.category_code}
              </span>
              {isSoldOut && (
                <span className="rounded-full bg-danger-500 px-2 py-0.5 font-semibold">已售罄</span>
              )}
              {isPast && (
                <span className="rounded-full bg-ink-500/70 px-2 py-0.5">已过期</span>
              )}
            </div>
            <div className="text-serif-cn text-2xl font-bold">{show.therapist_display_name ?? '神秘技师'}</div>
            <div className="mt-1 text-[13px] opacity-90">
              {formatTimeLong(show.start_time)}
            </div>
          </div>
        </div>

        {/* 关键信息块 */}
        <div className="px-5 -mt-8 relative z-10">
          <div className="rounded-3xl bg-white p-5 shadow-warm-md border border-warm-100">
            <div className="grid grid-cols-3 gap-3 text-center">
              <Stat icon={<Clock className="w-4 h-4 mx-auto mb-1 text-warm-700" />} label="时长" value={`${show.duration_min}分钟`} />
              <Stat icon={<Zap className="w-4 h-4 mx-auto mb-1 text-primary" />} label="名额" value={`${show.slots_remaining}/${show.slots_total}`} />
              <Stat
                icon={<span className="block text-base mb-0.5 text-primary font-bold">¥</span>}
                label="积分"
                value={<span className="text-primary font-bold">{show.price_points}</span>}
              />
            </div>
            {(show.service_city || show.service_area) && (
              <div className="mt-3 flex items-center justify-center gap-1 text-[12px] text-ink-600">
                <MapPin className="w-3 h-3" />
                <span>{show.service_city}{show.service_area && ` · ${show.service_area}`}</span>
              </div>
            )}
          </div>
        </div>

        {/* 套餐 含项/不含项 */}
        {(show.includes_note || show.excludes_note) && (
          <div className="px-5 mt-5">
            <div className="text-[12px] font-semibold text-ink-800 mb-2">套餐说明</div>
            <div className="space-y-2">
              {show.includes_note && (
                <div className="rounded-xl bg-success-500/5 border border-success-500/20 px-3 py-2">
                  <div className="text-[10px] font-medium text-success-500 mb-0.5">✓ 包含</div>
                  <div className="text-[13px] text-ink-800 whitespace-pre-line">{show.includes_note}</div>
                </div>
              )}
              {show.excludes_note && (
                <div className="rounded-xl bg-warning-500/5 border border-warning-500/20 px-3 py-2">
                  <div className="text-[10px] font-medium text-warning-500 mb-0.5">✗ 不含</div>
                  <div className="text-[13px] text-ink-800 whitespace-pre-line">{show.excludes_note}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 加项 */}
        {show.add_ons.length > 0 && (
          <div className="px-5 mt-5">
            <div className="text-[12px] font-semibold text-ink-800 mb-2">可选加项 (拍单时勾选)</div>
            <div className="space-y-1.5">
              {show.add_ons.map((a, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl bg-white border border-warm-100 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {a.isDefault && (
                      <span className="rounded bg-primary/10 text-primary text-[9px] px-1 py-0.5 font-semibold">推荐</span>
                    )}
                    <span className="text-[13px] text-ink-800">{a.name}</span>
                  </div>
                  <span className="text-[12px] font-semibold text-primary">+{a.pricePoints}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 技师档案链接 */}
        <div className="px-5 mt-5">
          <Link
            href={`/therapist/${show.therapist_user_id}`}
            className="block rounded-xl bg-white border border-warm-100 px-4 py-3 text-center text-[13px] text-warm-700 active:bg-warm-50"
          >
            查看技师完整档案 →
          </Link>
        </div>

        {/* 底部 CTA · 立即拍单 */}
        <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-warm-100 px-5 py-3 max-w-[390px] mx-auto">
          {!canBook ? (
            <button
              type="button"
              disabled
              className="w-full rounded-2xl bg-ink-100 text-ink-400 py-3 text-[14px] font-semibold flex items-center justify-center gap-1.5"
            >
              <Lock className="w-4 h-4" />
              {isSoldOut ? '已售罄' : isPast ? '节目已过期' : '当前不可拍'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => router.push(`/therapist/${show.therapist_user_id}/order?show_id=${show.id}`)}
              className="w-full rounded-2xl bg-gradient-cta py-3 text-[14px] font-semibold text-white active:scale-95"
            >
              立即拍单 · {show.price_points} 积分 (剩 {show.slots_remaining})
            </button>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div>
      {icon}
      <div className="text-[10px] text-ink-500">{label}</div>
      <div className="text-[14px] font-semibold text-ink-800 mt-0.5">{value}</div>
    </div>
  );
}

function formatTimeLong(iso: string) {
  const d = new Date(iso);
  const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${wd} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
