'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ChevronLeft,
  Heart,
  MoreHorizontal,
  Check,
  MapPin,
  Mic,
  Play,
  Image as ImageIcon,
  Video,
  Sparkles,
  Star,
  ChevronRight,
  Gift,
  MessageCircle,
  Lock,
  ArrowRight,
  Zap,
  X,
  ShieldCheck,
  ChevronLeft as ChevronLeftL,
  ChevronRight as ChevronRightL,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { ErrorBanner, LoadingFull } from '@/components/ui';
import { useDialog } from '@/components/UIDialog';
import { apiGet, apiPost, apiDelete, ApiClientError } from '@/lib/api';

// 服务套餐弹层 · 懒加载(用户不点"锁定她"按钮就不下载)
const ServiceTierSheet = dynamic(
  () => import('@/components/ServiceTierSheet').then((m) => m.ServiceTierSheet),
  { ssr: false },
);

interface TherapistDetail {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  tags: string[] | null;
  languages: string[] | null;
  nationality: string | null;
  serviceCity: string | null;
  serviceArea: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bustCm: number | null;
  hipCm: number | null;
  bodyFatPct: string | number | null;
  education: string | null;
  scoreAppearance: number;
  scoreBody: number;
  scoreService: number;
  rating: number;
  ratingCount: number;
  completedOrders: number;
  onlineStatus: string;
  galleryPublic: Array<{ url: string }>;
  galleryPaidCount: number;
  socialContacts?: Record<string, string>;
  basePriceJson?: unknown;
  preferencesJson?: unknown;
  voiceIntroUrl?: string | null;
  shortVideoUrl?: string | null;
  // M02 Phase 6 · 客户视角是否已收藏
  isFavorite?: boolean;
}

// M02 Phase 6 · 评价数据
interface ReviewItem {
  id: string;
  customerUserId: string;
  customerDisplayName: string | null;
  scoreAppearance: number;
  scoreBody: number;
  scoreService: number;
  comment: string | null;
  createdAt: string;
}

// M02 Phase 6 · 商品数据
interface ShopItem {
  id: string;
  title: string;
  coverUrl: string | null;
  pricePoints: number;
  stock: number;
}

interface Preferences {
  preferredCustomerTypes?: string[];
  rejectedCustomerTypes?: string[];
  acceptableBehaviors?: string[];
  unacceptableBehaviors?: string[];
}

export default function TherapistProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { confirm, prompt, alert } = useDialog();
  const [t, setT] = useState<TherapistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'about' | 'shop' | 'services' | 'reviews'>('about');
  // M02 Phase 6 · 相册 image/video tab
  const [galleryTab, setGalleryTab] = useState<'image' | 'video'>('image');
  // M02 Phase 6.1 · 相册大图 lightbox (null=关 · number=当前打开的 index)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // M02 Phase 6 · 三点更多菜单
  const [menuOpen, setMenuOpen] = useState(false);
  // M02 Phase 6 · lazy load 评价 + 商品
  const [reviews, setReviews] = useState<ReviewItem[] | null>(null);
  const [shopItems, setShopItems] = useState<ShopItem[] | null>(null);
  // M02 Phase 6 · 操作 loading
  const [favBusy, setFavBusy] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  // "锁定她" 套餐快捷弹层(对齐主流约会/服务 app)
  const [tierSheetOpen, setTierSheetOpen] = useState(false);
  // 首屏轮播当前 index
  const [heroIdx, setHeroIdx] = useState(0);

  async function loadDetail() {
    try {
      const data = await apiGet<TherapistDetail>(`/therapists/${id}`);
      setT(data);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [id]);

  // 滚动 ↔ tab 双向同步 · 用 IntersectionObserver 监听 4 个锚点
  // 用户上下滑动时,当前可视 section 自动高亮对应 tab(不抢点击触发的设置)
  useEffect(() => {
    if (!t) return;
    const ids = ['tab-anchor-about', 'tab-anchor-shop', 'tab-anchor-services', 'tab-anchor-reviews'] as const;
    type AnchorId = typeof ids[number];
    const idToTab: Record<AnchorId, 'about' | 'shop' | 'services' | 'reviews'> = {
      'tab-anchor-about': 'about',
      'tab-anchor-shop': 'shop',
      'tab-anchor-services': 'services',
      'tab-anchor-reviews': 'reviews',
    };
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        // 取交叉率最大的 entry
        const inView = entries.filter((e) => e.isIntersecting);
        if (inView.length === 0) return;
        const top = inView.sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]!;
        const tabKey = idToTab[top.target.id as AnchorId];
        if (tabKey) setActiveTab(tabKey);
      },
      // 触发线在距离 tab bar 下方 60px 处 · 防止刚划过来就切
      { rootMargin: '-60px 0px -50% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [t]);

  // M02 Phase 6 · 评价 lazy load
  useEffect(() => {
    if (activeTab === 'reviews' && reviews === null) {
      void (async () => {
        try {
          const list = await apiGet<ReviewItem[]>(`/reviews/therapist/${id}?limit=20`).catch(() => [] as ReviewItem[]);
          setReviews(list);
        } catch { setReviews([]); }
      })();
    }
    if (activeTab === 'shop' && shopItems === null) {
      void (async () => {
        try {
          const list = await apiGet<ShopItem[]>(`/shop/by-therapist/${id}`).catch(() => [] as ShopItem[]);
          setShopItems(list);
        } catch { setShopItems([]); }
      })();
    }
  }, [activeTab, id]);

  // M02 Phase 6 · 收藏切换
  async function toggleFavorite() {
    if (!t || favBusy) return;
    setFavBusy(true);
    const next = !t.isFavorite;
    // 乐观更新
    setT({ ...t, isFavorite: next });
    try {
      if (next) await apiPost(`/therapists/${id}/favorite`);
      else await apiDelete(`/therapists/${id}/favorite`);
    } catch (err) {
      // 失败回滚
      setT({ ...t, isFavorite: !next });
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setFavBusy(false);
    }
  }

  // M02 Phase 6 · 解锁联系方式
  async function unlockSocial() {
    if (!t || unlockBusy) return;
    const ok = await confirm({
      title: '解锁联系方式',
      message: '确定支付 100 积分? 此操作不可撤回 · 解锁后可看 WhatsApp / Line',
      confirmText: '解锁',
    });
    if (!ok) return;
    setUnlockBusy(true);
    try {
      await apiPost(`/therapists/${id}/unlock`, { unlock_type: 'social_contacts' });
      await loadDetail();
      await alert({ title: '解锁成功', message: '联系方式已显示在档案下方' });
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setUnlockBusy(false);
    }
  }

  // M02 Phase 6 · 屏蔽
  async function blockTherapist() {
    if (!t) return;
    const ok = await confirm({
      title: '屏蔽此技师',
      message: '你将不再看到 TA · 可在"隐私设置"取消屏蔽',
      confirmText: '屏蔽',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiPost('/me/blocks', { target_user_id: t.userId, reason: 'user_initiated' });
      await alert({ title: '已屏蔽', message: '你将不再看到 TA' });
      router.back();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  // M02 Phase 6 · 举报(简单 prompt 版 · 复杂表单留 P1)
  async function reportTherapist() {
    if (!t) return;
    const desc = await prompt({
      title: '举报技师',
      message: '请简述举报原因(骚扰 / 欺诈 / 虚假信息 / 其他)',
      placeholder: '至少 3 个字',
      minLength: 3,
      multiline: true,
      confirmText: '提交',
    });
    if (!desc) return;
    try {
      await apiPost('/tickets', {
        target_user_id: t.userId,
        title: '用户举报技师',
        description: desc,
        category: 'user_report',
      });
      await alert({ title: '举报已提交', message: '客服将在 24h 内处理 · 多谢反馈' });
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
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
      <div className="mobile-container">
        {error ? <div className="p-4"><ErrorBanner message={error} /></div> : <LoadingFull />}
      </div>
    );
  }

  const prefs = (t.preferencesJson ?? {}) as Preferences;
  const priceTiers = (Array.isArray(t.basePriceJson) ? t.basePriceJson : []) as Array<{ duration: number; pricePoints: number }>;
  const overallScore = ((t.scoreAppearance + t.scoreBody + t.scoreService) / 300).toFixed(1);
  const heroFallback = t.avatarUrl ?? '/proto-images/t-1.webp';
  const gallery = (t.galleryPublic ?? []).slice(0, 6).map((g) => g.url); // 无真实相册则空，不展示假图
  // 首屏轮播 · avatar 在前 · 加 gallery 前 3 张 · 最少 1 张兜底
  const heroSlides: string[] = (() => {
    const arr: string[] = [];
    if (t.avatarUrl) arr.push(t.avatarUrl);
    for (const g of gallery) if (!arr.includes(g)) arr.push(g);
    if (arr.length === 0) arr.push('/proto-images/t-1.webp');
    return arr.slice(0, 5);
  })();
  // 复购率(完成单数 ÷ 评价数 · 简化估算 · 真实数据可后端返)
  const repeatRate = t.ratingCount > 0
    ? Math.min(99, Math.round((t.completedOrders / Math.max(t.ratingCount, 1)) * 50))
    : 0;
  const langs = (t.languages ?? []).slice(0, 3).map(l =>
    l === 'zh' ? '中文' : l === 'en' ? '英文' : l === 'th' ? '泰文' : l === 'vi' ? '越南文' : l === 'ms' ? '马来文' : l === 'id' ? '印尼文' : l
  );
  const tags = t.tags ?? [];

  return (
    <div className="mobile-container">
      {/* 沉浸式大图轮播 · 全宽 4:5 · top-nav + 名字评分都浮叠在图上 */}
      <div className="hero-photo fade-up d2">
        {/* 轮播条 · 横向滑动 + scroll-snap · 每张全宽 */}
        <div
          className="hero-slider"
          onScroll={(e) => {
            const el = e.currentTarget;
            const w = el.clientWidth;
            const idx = Math.round(el.scrollLeft / w);
            if (idx !== heroIdx) setHeroIdx(idx);
          }}
        >
          {heroSlides.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={url || heroFallback}
              alt={t.displayName ?? ''}
              loading={i === 0 ? 'eager' : 'lazy'}
              {...(i === 0 ? { fetchPriority: 'high' as const } : {})}
            />
          ))}
        </div>
        {/* 圆点指示器 · 仅多于 1 张时显 */}
        {heroSlides.length > 1 && (
          <div className="hero-dots">
            {heroSlides.map((_, i) => (
              <span key={i} className={i === heroIdx ? 'on' : ''} />
            ))}
            <div className="hero-counter num">{heroIdx + 1}/{heroSlides.length}</div>
          </div>
        )}

        {/* 顶部 nav · 浮在图顶部 · 浅色渐变兜底可读 */}
        <div className="top-nav fade-up d1">
          <button className="nav-btn-light" onClick={() => router.back()} title="返回" type="button">
            <ChevronLeft className="w-4 h-4 text-[#1A1A2E]" />
          </button>
          <div className="nav-title">PROFILE</div>
          <div className="flex items-center gap-1.5">
            <button
              className="nav-btn-light"
              type="button"
              onClick={() => void toggleFavorite()}
              disabled={favBusy}
              aria-label="收藏"
            >
              <Heart
                className={`w-4 h-4 transition ${t.isFavorite ? 'fill-[#FF5577] text-[#FF5577]' : 'text-[#1A1A2E]'}`}
                strokeWidth={t.isFavorite ? 0 : 1.8}
              />
            </button>
            <button className="nav-btn-light" type="button" onClick={() => setMenuOpen(true)} aria-label="更多">
              <MoreHorizontal className="w-4 h-4 text-[#1A1A2E]" />
            </button>
          </div>
        </div>

        {/* 名字 + 评分 · 压在图底部渐变上 */}
        <div className="hero-title fade-up d3">
          <div>
            <div className="name-cn">{t.displayName ?? '技师'}</div>
            <div className="name-en-row">
              <span className="name-en">{t.nationality ?? ''}</span>
              <span className="verified-mini">
                <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />
              </span>
            </div>
          </div>
          <div className="score-block">
            <div className="score-num num">{overallScore}</div>
            <div className="score-label">{t.ratingCount} reviews</div>
          </div>
        </div>
      </div>

      {/* 头像独立亮相区 · 让头像成为"身份标识"
          技师视角:这张是我最好的脸
          客户视角:对她产生记忆点 */}
      <div className="head-card fade-up d3">
        <div className="head-avatar-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="head-avatar"
            src={t.avatarUrl ?? '/proto-images/t-1.webp'}
            alt={t.displayName ?? ''}
          />
          {t.onlineStatus === 'online' && <span className="head-online-dot" />}
        </div>
        <div className="head-info">
          <div className="head-name-row">
            <span className="head-name">{t.displayName ?? '技师'}</span>
            <span className="head-verified" title="真人核验">
              <ShieldCheck className="w-3 h-3" />
              已核验
            </span>
          </div>
          <div className="head-stats">
            <span className="head-stat">
              <Star className="w-3 h-3 fill-current text-[#FFB347]" />
              <strong className="num">{overallScore}</strong>
              <span className="dim">({t.ratingCount})</span>
            </span>
            <span className="head-dot" />
            <span className="head-stat num">{t.completedOrders} 单</span>
            {repeatRate > 0 && (
              <>
                <span className="head-dot" />
                <span className="head-stat">
                  <Heart className="w-3 h-3 fill-current text-[#FF5577]" />
                  <strong className="num">{repeatRate}%</strong>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="hero-meta fade-up d3">
        {t.onlineStatus === 'online' && (
          <>
            <span className="meta-online">
              <span className="meta-online-dot"></span>
              今晚在线
            </span>
            <span className="meta-divider"></span>
          </>
        )}
        <span className="num">
          {t.heightCm ? `${t.heightCm}cm` : '—'}{t.nationality && ` · ${t.nationality}`}
        </span>
        {(t.serviceCity || t.serviceArea) && (
          <>
            <span className="meta-divider"></span>
            <span className="meta-loc">
              <MapPin className="w-3 h-3" />
              {[t.serviceCity, t.serviceArea].filter(Boolean).join(' ')}
            </span>
          </>
        )}
      </div>

      <div className="info-card fade-up d3">
        <div className="info-tags">
          {langs.map((l) => (
            <span key={l} className="info-tag lang">{l}</span>
          ))}
          {tags.map((tag) => (
            <span key={tag} className="info-tag type">{tag}</span>
          ))}
          {t.completedOrders > 20 && (
            <span className="info-tag">{t.completedOrders} 次</span>
          )}
        </div>
        <div className="voice-row">
          <button className="voice-play" type="button">
            <Play className="w-[18px] h-[18px] fill-white text-white ml-0.5" />
          </button>
          <div className="voice-info">
            <div className="voice-label">
              <Mic className="w-3 h-3 text-[#FF5577]" />
              <span className="voice-label-text">HER VOICE</span>
              <span className="voice-label-cn">· 听她自我介绍</span>
            </div>
            <div className="voice-bar">
              {[30, 60, 40, 85, 50, 75, 55, 90, 45, 70, 35, 80].map((h, i) => (
                <div key={i} style={{ height: `${h}%` }} />
              ))}
              {[50, 30, 65, 40, 55, 25, 70, 45, 60, 35].map((h, i) => (
                <div key={`p-${i}`} className="pending" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
          <div className="text-right">
            <div className="voice-duration num">0:18</div>
            <div className="voice-plays">{(t.completedOrders * 80).toLocaleString()} plays</div>
          </div>
        </div>
      </div>

      <div className="hero-album-bar fade-up d3">
        <div className="hero-album-head">
          <div className="hero-album-title">
            <span className="hero-album-cn">相册</span>
            <span className="hero-album-en">MEDIA</span>
          </div>
          <div className="flex items-center gap-2.5 text-[10px]">
            <span className="flex items-center gap-1 text-[#2DCE89]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2DCE89]"></span>
              <span className="font-medium">Set by {t.displayName}</span>
            </span>
          </div>
        </div>

        <div className="album-tabs">
          <button
            className={`album-tab ${galleryTab === 'image' ? 'active' : ''}`}
            type="button"
            onClick={() => setGalleryTab('image')}
          >
            <ImageIcon className="w-3 h-3" />
            <span>图片</span>
            <span className="count">{gallery.length}</span>
          </button>
          <button
            className={`album-tab ${galleryTab === 'video' ? 'active' : ''}`}
            type="button"
            onClick={() => setGalleryTab('video')}
          >
            <Video className="w-3 h-3" />
            <span>视频</span>
            <span className="count">{t.shortVideoUrl ? 1 : 0}</span>
          </button>
        </div>

        <div className="tab-content active">
          {galleryTab === 'image' && (
            <div className="album-grid">
              {gallery.map((url, i) => (
                <div
                  key={i}
                  className="album-cell"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setLightboxIndex(i)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" />
                  <span className="badge-free">FREE</span>
                </div>
              ))}
              {gallery.length === 0 && (
                <div className="col-span-3 text-center py-8 text-[12px] text-[#6A7088]">还没有相册图</div>
              )}
            </div>
          )}
          {galleryTab === 'video' && (
            <div className="px-1 py-2">
              {t.shortVideoUrl ? (
                <video src={t.shortVideoUrl} controls playsInline className="w-full rounded-xl bg-black" style={{ maxHeight: 360 }} />
              ) : (
                <div className="text-center py-8 text-[12px] text-[#6A7088]">还没有短视频</div>
              )}
            </div>
          )}
        </div>
      </div>

      {!t.socialContacts && (
        <div className="px-5 pt-3 pb-1">
          <button
            type="button"
            onClick={() => void unlockSocial()}
            disabled={unlockBusy}
            className="w-full flex items-center justify-between rounded-2xl px-4 py-3 active:scale-[0.99] disabled:opacity-60"
            style={{
              background: 'linear-gradient(135deg, #FFF0F0 0%, #FFE5EE 100%)',
              border: '1px solid rgba(255, 138, 122, 0.25)',
            }}
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'white' }}>
                <Lock className="w-3.5 h-3.5 text-[#FF5577]" />
              </span>
              <div className="text-left">
                <div className="font-serif-cn text-[12.5px] font-semibold text-[#1A1A2E]">
                  {unlockBusy ? '解锁中…' : '解锁联系方式'}
                </div>
                <div className="text-[10px] text-[#6A7088]">WhatsApp / Line · 100 积分</div>
              </div>
            </div>
            <Zap className="w-4 h-4 fill-[#FFB347] text-[#FFB347]" />
          </button>
        </div>
      )}

      {/* 已解锁 · 显示联系方式 */}
      {t.socialContacts && Object.keys(t.socialContacts).length > 0 && (
        <div className="px-5 pt-3 pb-1">
          <div
            className="rounded-2xl px-4 py-3"
            style={{
              background: 'linear-gradient(135deg, #F0FFF4 0%, #E5FFE5 100%)',
              border: '1px solid rgba(45, 206, 137, 0.25)',
            }}
          >
            <div className="text-[11px] text-[#2DCE89] font-medium mb-2">✓ 已解锁联系方式</div>
            <div className="space-y-1.5">
              {Object.entries(t.socialContacts).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="text-[#6A7088] capitalize">{key}</span>
                  <span className="font-mono text-[#1A1A2E] truncate">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 更多菜单 BottomSheet */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 z-50 rounded-t-3xl bg-white shadow-2xl">
            <div className="mx-auto mt-2 mb-2 h-1 w-10 rounded-full bg-ink-200" />
            <ul className="px-2 pb-3">
              <li>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); void reportTherapist(); }}
                  className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-[14px] text-ink-800 active:bg-ink-50"
                >
                  🚩 举报
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); void blockTherapist(); }}
                  className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-[14px] text-red-600 active:bg-red-50"
                >
                  🚫 屏蔽
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center justify-center rounded-xl px-4 py-3 text-center text-[14px] text-ink-500 active:bg-ink-50"
                >
                  取消
                </button>
              </li>
            </ul>
          </div>
        </>
      )}

      <div className="sticky top-0 z-20 bg-white border-b border-[rgba(0,0,0,0.04)] mt-2">
        <div className="grid grid-cols-4">
          {(['about', 'shop', 'services', 'reviews'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setActiveTab(k);
                // 滚动到对应 section · sticky tab 高度 ~48px,用 scroll-margin-top 适配
                const el = document.getElementById(`tab-anchor-${k}`);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
              className={`relative py-3 text-[12.5px] font-medium font-serif-cn transition-colors ${
                activeTab === k ? 'text-[#FF5577]' : 'text-[#6A7088]'
              }`}
            >
              {k === 'about' ? '关于' : k === 'shop' ? '橱窗' : k === 'services' ? '服务' : '评价'}
              {activeTab === k && (
                <span className="absolute inset-x-[30%] bottom-0 h-0.5 rounded-full" style={{ background: 'linear-gradient(90deg, #FF8A7A, #FF5577)' }} />
              )}
            </button>
          ))}
        </div>
      </div>

      <ErrorBanner message={error} />

      <section className="section" id="tab-anchor-about" style={{ scrollMarginTop: '48px' }}>
        <div className="section-sub">About Her</div>
        <h2 className="section-h">遇见她</h2>

        {t.bio && (
          <div className="prompt-card card-pink mb-3" style={{ background: 'linear-gradient(135deg, #FFF0F0 0%, #FFE5EE 100%)', border: '1px solid rgba(255, 138, 122, 0.2)' }}>
            <div className="prompt-label" style={{ color: '#FF5577' }}>HER WORDS</div>
            <p className="prompt-content">{t.bio}</p>
          </div>
        )}

        <h3 className="sub-h">基础数据 <span className="sub-h-en">DATA</span></h3>
        <div className="grid grid-cols-2 gap-2.5">
          {[
            ['Height', t.heightCm && `${t.heightCm} cm`],
            ['Weight', t.weightKg && `${t.weightKg} kg`],
            ['Bust', t.bustCm && `${t.bustCm} cm`],
            ['Hip', t.hipCm && `${t.hipCm} cm`],
            ['Body Fat', t.bodyFatPct && `${t.bodyFatPct}%`],
            ['Education', t.education],
            ['Languages', langs.join(' · ') || null],
            ['Nationality', t.nationality],
          ].filter(([, v]) => v).map(([label, value]) => (
            <div key={label as string} className="info-item">
              <div className="info-label">{label}</div>
              <div className="info-value num">{value}</div>
            </div>
          ))}
        </div>

        {(prefs.preferredCustomerTypes || prefs.rejectedCustomerTypes || prefs.acceptableBehaviors || prefs.unacceptableBehaviors) && (
          <>
            <h3 className="sub-h">她的风格 <span className="sub-h-en">STYLE</span></h3>
            <div className="space-y-2.5">
              {prefs.preferredCustomerTypes && prefs.preferredCustomerTypes.length > 0 && (
                <div className="prompt-card">
                  <div className="prompt-label" style={{ color: '#FF5577' }}>SHE LIKES</div>
                  <div className="flex flex-wrap gap-1.5">
                    {prefs.preferredCustomerTypes.map((x) => <span key={x} className="tag">{x}</span>)}
                  </div>
                </div>
              )}
              {prefs.rejectedCustomerTypes && prefs.rejectedCustomerTypes.length > 0 && (
                <div className="prompt-card">
                  <div className="prompt-label" style={{ color: '#FF4757' }}>SHE AVOIDS</div>
                  <div className="flex flex-wrap gap-1.5">
                    {prefs.rejectedCustomerTypes.map((x) => <span key={x} className="tag tag-no">{x}</span>)}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                {prefs.acceptableBehaviors && prefs.acceptableBehaviors.length > 0 && (
                  <div className="prompt-card">
                    <div className="prompt-label" style={{ color: '#2DCE89' }}>WELCOME</div>
                    <p className="prompt-content text-[12px] leading-[1.7] whitespace-pre-line">
                      {prefs.acceptableBehaviors.map((x) => `· ${x}`).join('\n')}
                    </p>
                  </div>
                )}
                {prefs.unacceptableBehaviors && prefs.unacceptableBehaviors.length > 0 && (
                  <div className="prompt-card">
                    <div className="prompt-label" style={{ color: '#FF4757' }}>NO WAY</div>
                    <p className="prompt-content text-[12px] leading-[1.7] whitespace-pre-line">
                      {prefs.unacceptableBehaviors.map((x) => `· ${x}`).join('\n')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <section className="section" id="tab-anchor-reviews" style={{ scrollMarginTop: '48px' }}>
        <div className="section-sub">Reviews &amp; Score</div>
        <h2 className="section-h">男人们怎么说</h2>

        <div className="card p-5 mb-3">
          {[
            { cn: '颜值', en: 'Appearance', value: t.scoreAppearance },
            { cn: '身材', en: 'Figure', value: t.scoreBody },
            { cn: '服务', en: 'Service', value: t.scoreService },
          ].map((s) => (
            <div key={s.cn} className="score-row">
              <div style={{ width: '60px' }}>
                <div className="font-serif-cn text-[14px] font-medium text-[#1A1A2E]">{s.cn}</div>
                <div className="font-cormorant italic text-[10px] text-[#6A7088]">{s.en}</div>
              </div>
              <div className="score-bar-track">
                <div className="score-bar-fill" style={{ width: `${(s.value / 1000) * 100}%` }} />
              </div>
              <div className="score-value">{(s.value / 100).toFixed(1)}</div>
            </div>
          ))}
        </div>

        {t.ratingCount > 0 && (
          <div className="text-center mb-4 font-cormorant italic text-[10px] text-[#6A7088] tracking-[0.25em]">
            Based on <span style={{ color: '#FF5577', fontWeight: 600 }}>{t.ratingCount}</span> reviews
          </div>
        )}

        {t.completedOrders > 5 && (
          <div className="ai-card p-4 mb-3">
            <div className="flex items-center gap-2 mb-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FF8A7A 0%, #FF5577 100%)' }}>
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-cormorant italic text-xs text-[#FF8A7A] tracking-[0.25em]">INSIGHTS</span>
            </div>
            <p className="font-serif-cn italic text-[13.5px] leading-[1.8] text-[#1A1A2E]">
              <span style={{ color: '#FF5577', fontWeight: 600 }}>「会让你舍不得走」</span>是熟客的原话。
              手法温柔精准，
              <span style={{ color: '#FF5577', fontWeight: 600 }}>{Math.round((t.completedOrders / Math.max(t.ratingCount, 1)) * 100)}% 的男人来了第二次</span>。
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {['手法精准', '温柔', '准时', '边界清晰'].map((tg) => (
                <span key={tg} className="tag">{tg}</span>
              ))}
            </div>
          </div>
        )}

        <h3 className="sub-h">精选评价 <span className="sub-h-en">REVIEWS</span></h3>
        {/* M02 Phase 6 · 真实评价(lazy load) · 评价 tab 切换时拉 */}
        <div className="space-y-2.5">
          {reviews === null && activeTab !== 'reviews' && (
            <div className="text-center py-6 text-[12px] text-ink-400">点击"评价" tab 查看真实评价</div>
          )}
          {reviews !== null && reviews.length === 0 && (
            <div className="text-center py-6 text-[12px] text-ink-400">还没有评价 · 做第一个评价的客户</div>
          )}
          {reviews && reviews.slice(0, 5).map((r) => {
            const score = ((r.scoreAppearance + r.scoreBody + r.scoreService) / 30).toFixed(1);
            const initial = (r.customerDisplayName ?? 'A').slice(0, 1).toUpperCase();
            return (
              <div key={r.id} className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FFE5EE] to-[#FFB5A8] flex items-center justify-center text-[10px] font-semibold" style={{ color: '#FF5577' }}>{initial}</div>
                    <div>
                      <div className="text-[12px] font-medium text-[#1A1A2E]">
                        {r.customerDisplayName ? `${r.customerDisplayName.slice(0, 1)}***` : '匿名'}
                      </div>
                      <div className="font-cormorant italic text-[9px] text-[#6A7088]">{new Date(r.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Star className="w-3 h-3 fill-[#FFB347] text-[#FFB347]" />
                    <span className="font-display text-[12px] font-semibold text-[#1A1A2E] num">{score}</span>
                  </div>
                </div>
                {r.comment && (
                  <p className="text-[12.5px] text-[#1A1A2E] leading-[1.7]">{r.comment}</p>
                )}
              </div>
            );
          })}
        </div>

        {reviews && reviews.length > 5 && (
          <button
            className="w-full mt-4 py-3 rounded-full text-xs font-medium tracking-wider flex items-center justify-center gap-1.5"
            style={{ background: '#FFE5EE', color: '#FF5577' }}
            type="button"
          >
            <span>看全部 {reviews.length} 条评价</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}

        {/* M02 Phase 6 · 橱窗 section · 嵌在 reviews 里但单独可锚定 */}
        <h3 id="tab-anchor-shop" className="sub-h mt-6" style={{ scrollMarginTop: '56px' }}>
          她的橱窗 <span className="sub-h-en">SHOP</span>
        </h3>
        <div className="space-y-2.5">
          {shopItems === null && activeTab !== 'shop' && (
            <div className="text-center py-6 text-[12px] text-ink-400">点击"橱窗" tab 查看上架商品</div>
          )}
          {shopItems !== null && shopItems.length === 0 && (
            <div className="text-center py-6 text-[12px] text-ink-400">这位技师还没上架商品</div>
          )}
          {shopItems && shopItems.length > 0 && (
            <div className="grid grid-cols-2 gap-2.5">
              {shopItems.slice(0, 6).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => router.push(`/shop/${s.id}`)}
                  className="card p-3 text-left active:scale-[0.98]"
                >
                  {s.coverUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.coverUrl} alt={s.title} className="w-full h-24 object-cover rounded-lg mb-2" />
                  )}
                  <div className="text-[12.5px] font-medium text-ink-800 truncate">{s.title}</div>
                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    <span className="font-mono font-semibold text-[#FF5577]">{s.pricePoints} 积分</span>
                    {s.stock <= 0 && <span className="text-ink-400">已售罄</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section" id="tab-anchor-services" style={{ paddingBottom: '100px', scrollMarginTop: '48px' }}>
        <div className="section-sub">Her Services</div>
        <h2 className="section-h">为你准备的</h2>

        {priceTiers.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-center text-xs text-[#6A7088]">
            未设置价格 · 联系技师确认
          </div>
        ) : (
          <div className="space-y-2.5">
            {priceTiers.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => router.push(`/therapist/${t.id}/order?duration=${p.duration}`)}
                className={`service-row ${i === 0 ? 'featured' : ''} flex items-center justify-between w-full text-left`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="font-serif-cn text-base text-[#1A1A2E] font-semibold">
                      {p.duration} 分钟服务
                    </div>
                    {i === 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-medium tracking-wider" style={{ background: 'rgba(255, 85, 119, 0.15)', color: '#FF5577' }}>
                        SIGNATURE
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#6A7088]">{tags.slice(0, 2).join(' · ') || '基础套餐'}</div>
                </div>
                <div className="text-right ml-3">
                  <div className="font-display text-xl font-semibold num leading-none" style={{ color: i === 0 ? '#FF5577' : '#1A1A2E' }}>
                    {p.pricePoints}
                  </div>
                  {i === 0 && <div className="text-[9px] text-[#FFB347] mt-1 tracking-wider font-semibold">EARLY BIRD</div>}
                </div>
                <ChevronRight className="w-4 h-4 text-[#6A7088] ml-2" />
              </button>
            ))}
          </div>
        )}

        <div className="text-center pt-10">
          <div className="font-cormorant italic text-[9px] text-[#6A7088]/50 tracking-[0.4em]">— LOVERUSH —</div>
        </div>
      </section>

      <div className="sticky bottom-0 z-30 mt-auto shrink-0 bottom-cta">
        <div className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => void openChat()}
              className="btn-ghost-light rounded-2xl w-12 h-12 flex items-center justify-center"
              type="button"
              aria-label="私聊"
            >
              <MessageCircle className="w-5 h-5 text-[#FF5577]" />
            </button>
            <button
              onClick={() => {
                // 0 tier · 没必要弹层 · 直接跳到 order 页用 fallback 流程
                if (priceTiers.length === 0) {
                  router.push(`/therapist/${t.id}/order`);
                } else {
                  setTierSheetOpen(true);
                }
              }}
              className="btn-primary rounded-2xl flex-1 h-12 flex items-center justify-center gap-2 text-white"
              type="button"
            >
              <Heart className="w-4 h-4 fill-white" />
              <span className="font-serif-cn text-sm font-medium tracking-wider">锁定她 · 别让人抢走</span>
            </button>
            <button
              onClick={() => router.push(`/therapist/${t.id}/order?tip=1`)}
              className="btn-ghost-light rounded-2xl w-12 h-12 flex items-center justify-center"
              type="button"
              aria-label="给小费"
            >
              <Gift className="w-5 h-5 text-[#FFB347]" />
            </button>
          </div>
        </div>
      </div>

      {/* 套餐快捷选择 BottomSheet · 点"锁定她"弹出 · 选 1 个跳 order 页 */}
      <ServiceTierSheet
        isOpen={tierSheetOpen}
        therapistName={t.displayName}
        priceTiers={priceTiers}
        tags={tags}
        onClose={() => setTierSheetOpen(false)}
        onSelect={(duration) => router.push(`/therapist/${t.id}/order?duration=${duration}`)}
        onFallbackChat={() => {
          setTierSheetOpen(false);
          void openChat();
        }}
      />

      {/* M02 Phase 6.1 · 相册大图 Lightbox · 全屏黑底 · 左右切换 · 点黑背景关 */}
      {lightboxIndex !== null && gallery[lightboxIndex] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
          onClick={() => setLightboxIndex(null)}
        >
          {/* 关闭按钮 */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
            className="absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white active:bg-white/25"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>

          {/* 计数 */}
          <div className="absolute top-5 left-1/2 -translate-x-1/2 z-10 rounded-full bg-white/15 px-3 py-1 text-[12px] text-white num">
            {lightboxIndex + 1} / {gallery.length}
          </div>

          {/* 左切 */}
          {lightboxIndex > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1); }}
              className="absolute left-3 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white active:bg-white/25"
              aria-label="上一张"
            >
              <ChevronLeftL className="w-6 h-6" />
            </button>
          )}

          {/* 右切 */}
          {lightboxIndex < gallery.length - 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1); }}
              className="absolute right-3 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white active:bg-white/25"
              aria-label="下一张"
            >
              <ChevronRightL className="w-6 h-6" />
            </button>
          )}

          {/* 大图 · 点图本身不关(避免误触)· 仅点黑背景关 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={gallery[lightboxIndex]}
            alt=""
            className="max-h-[88vh] max-w-[94vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
