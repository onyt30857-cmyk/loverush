/**
 * 技师服务 · M02
 *
 * 三件事：
 * 1. profile 增量 upsert（首次自动建 therapists 行）
 * 2. 按调用方差异化字段输出（公开 / 付费 / 仅平台）
 * 3. profile_completeness 计算
 */

import { eq, and, inArray } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  therapists,
  users,
  mediaAssets,
  customerRelationshipProfile,
  type Therapist,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { distanceKmRounded } from './geo-distance';
import {
  getCountryCurrency,
  getCityCountryById,
  isRateBacked,
  normalizeCountryCode,
} from './countries';

// ───────── 技师客户备注(P1)· 复用 customer_relationship_profile 的 privateNotes/customerNickname/privateTags ─────────
export interface CustomerNotes {
  privateNotes: string | null;
  customerNickname: string | null;
  privateTags: string[];
}

/** 取技师对某客户的备注(无则空) */
export async function getCustomerNotes(
  ctx: TherapistContext,
  args: { therapistUserId: string; customerId: string },
): Promise<CustomerNotes> {
  const t = await ctx.db.query.therapists.findFirst({ where: eq(therapists.userId, args.therapistUserId) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');
  const row = await ctx.db.query.customerRelationshipProfile.findFirst({
    where: and(
      eq(customerRelationshipProfile.therapistId, t.id),
      eq(customerRelationshipProfile.customerId, args.customerId),
    ),
  });
  return {
    privateNotes: row?.privateNotes ?? null,
    customerNickname: row?.customerNickname ?? null,
    privateTags: row?.privateTags ?? [],
  };
}

/** 技师写备注(upsert · 一对一关系行,M06 可能已建过) */
export async function setCustomerNotes(
  ctx: TherapistContext,
  args: { therapistUserId: string; customerId: string; privateNotes?: string | null; customerNickname?: string | null; privateTags?: string[] },
): Promise<CustomerNotes> {
  const t = await ctx.db.query.therapists.findFirst({ where: eq(therapists.userId, args.therapistUserId) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (args.privateNotes !== undefined) patch.privateNotes = args.privateNotes;
  if (args.customerNickname !== undefined) patch.customerNickname = args.customerNickname;
  if (args.privateTags !== undefined) patch.privateTags = args.privateTags;
  await ctx.db
    .insert(customerRelationshipProfile)
    .values({
      customerId: args.customerId,
      therapistId: t.id,
      privateNotes: args.privateNotes ?? null,
      customerNickname: args.customerNickname ?? null,
      privateTags: args.privateTags ?? [],
    })
    .onConflictDoUpdate({
      target: [customerRelationshipProfile.customerId, customerRelationshipProfile.therapistId],
      set: patch,
    });
  return getCustomerNotes(ctx, args);
}

export interface TherapistContext {
  db: Database;
}

// ──────────────── 字段差异化视图 ────────────────

type ViewerScope = 'self' | 'customer_paid' | 'customer_free' | 'admin';

export interface PublicTherapistView {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  bioTranslations: Record<string, string> | null;
  tags: string[] | null;
  nationality: string | null;
  languages: string[] | null;
  serviceCountry: string | null;
  serviceCity: string | null;
  serviceArea: string | null;
  /** 服务方式：outcall 上门 / incall 到店 / both 两者 */
  serviceMode: 'outcall' | 'incall' | 'both';
  // M02 Phase 5 · 字典 uuid · 给 personalize 同城/同区精准比较用
  serviceCityId: string | null;
  serviceAreaId: string | null;
  voiceIntroUrl: string | null;
  shortVideoUrl: string | null;
  galleryPublic: Array<{ url: string; thumbnailUrl?: string }>;
  galleryPaidCount: number;
  // M11 Phase 1 · self/admin 看到完整 galleryJson(含 isPaid + pricePoints) 供编辑器使用
  galleryJson?: Array<{ url: string; isPaid: boolean; thumbnailUrl?: string; pricePoints?: number }>;
  verifiedAt?: string | null;
  skillsJson: unknown;
  preferencesJson: unknown;
  basePriceJson: unknown;
  // 0027 派生 · 该技师默认法币(任何积分场景按此换算 fiat 显示)
  // 优先源:basePriceJson 任一档 currencyCode → serviceCountry/serviceCity 国家映射 → null
  defaultCurrencyCode: string | null;
  onlineStatus: string;
  scoreAppearance: number;
  scoreBody: number;
  scoreService: number;
  /** 贝叶斯加权服务分 0-1000 · 排序/展示主值(展示 /100=0-10) */
  ratingBayes: number;
  ratingCount: number;
  completedOrders: number;
  verificationStatus: string;
  /**
   * 距客户的近似距离(km · 四舍五入到整数 · 见 geo-distance.distanceKmRounded)
   *   - 传了 lat/lng 才计算 · 否则该字段不出现
   *   - 技师无可解析坐标(serviceArea/serviceCity 字典均缺中心坐标)→ null
   */
  distance_km?: number | null;
  profileCompleteness?: number;
  // 付费可见
  galleryPaid?: Array<{ url: string; thumbnailUrl?: string; pricePoints?: number }>;
  socialContacts?: Record<string, string>;
  serviceAddressFull?: string;
  // 到店服务 · 技师自己编辑页回显(self scope)
  shopArrivalNote?: string | null;
  shopGuideMedia?: Array<{ mediaId: string; kind: 'image' | 'video'; caption?: string; previewUrl?: string }>;
  // 仅 self / admin
  heightCm?: number | null;
  weightKg?: number | null;
  bustCm?: number | null;
  hipCm?: number | null;
  bodyFatPct?: string | null;
  education?: string | null;
  livenessVideoUrl?: string | null;
  // M02 Phase 6 · 客户视角是否已收藏此技师(viewerUserId 提供时)
  isFavorite?: boolean;
}

/**
 * Demo 阶段统一自介语音兜底 URL (2026-06-03)
 *   Tony 决策:当前所有 admin-seeded 技师都是演示账户 · 没值时统一显这段
 *   en-shimmer · "The way I wait for you... is to dim the lights, first." · OpenAI tts-1-hd
 *   真技师上传后 voice_intro_url 会有值 · 自动覆盖
 *   不撞 [[feedback_ai_stealth]] 因为是显式 demo 不是假装真实数据
 */
const DEMO_VOICE_INTRO_URL =
  'https://pub-bad5a738b21b4f6abc2fb480e5fabe8d.r2.dev/demo/therapist-voice-intro-v1.mp3';

/**
 * 硬编码兜底:countries 表未热/未 seed 时的国家→默认法币(原东南亚 4 国 + USD)。
 * 这 5 个币种 prod 必有汇率,作为"安全币种"白名单 → 即使汇率缓存冷启动也敢返回,杜绝回归。
 */
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  TH: 'THB',
  SG: 'SGD',
  MY: 'MYR',
  ID: 'IDR',
  US: 'USD',
};
const HARDCODED_SAFE_CURRENCIES = new Set(Object.values(COUNTRY_TO_CURRENCY));

/**
 * 解析技师所在国家 ISO alpha-2 · serviceCityId → cities.countryCode 优先(最准),
 * 否则 serviceCountry text 归一化(中文/英文/ISO)· 都没有 → undefined。
 */
export function resolveCountryCode(t: Therapist): string | undefined {
  const fromCity = getCityCountryById(t.serviceCityId);
  if (fromCity) return fromCity;
  return normalizeCountryCode(t.serviceCountry);
}

/**
 * 派生该技师默认法币 · 优先 basePriceJson 显式 currencyCode · 否则按国家映射(数据驱动)· 否则 null
 *
 * 数据源:countries.default_currency(后台可配)→ 硬编码 5 国兜底。
 * 守卫:国家派生的币种必须"已配汇率"或在安全白名单内才返回,否则回退积分模式(null)——
 * 防新国家(如 VN→VND)无 exchange_rate 时下单 getLatestRate throw 500。
 */
export function deriveDefaultCurrency(t: Therapist): string | null {
  // 1) basePriceJson 显式 currencyCode(技师自设 · 最高优先 · 沿用原行为不加守卫)
  if (Array.isArray(t.basePriceJson)) {
    for (const p of t.basePriceJson as Array<{ currencyCode?: string }>) {
      if (p?.currencyCode) return p.currencyCode;
    }
  }
  // 2) 技师国家 → 默认币种
  const code = resolveCountryCode(t);
  if (code) {
    const dataCur = getCountryCurrency(code); // 数据驱动(countries 表)
    if (dataCur) {
      // 数据驱动币种:已配汇率 或 安全白名单(原 5 国,冷启动也安全)才用;否则积分模式
      if (isRateBacked(dataCur) || HARDCODED_SAFE_CURRENCIES.has(dataCur)) return dataCur;
      return null;
    }
    // 表未热/未 seed → 硬编码兜底(原 5 国,prod 必有汇率)
    if (COUNTRY_TO_CURRENCY[code]) return COUNTRY_TO_CURRENCY[code]!;
  }
  return null;
}

function publicView(t: Therapist, scope: ViewerScope, displayName?: string | null): PublicTherapistView {
  const gallery = (t.galleryJson ?? []) as Array<{ url: string; isPaid: boolean; thumbnailUrl?: string; pricePoints?: number }>;
  const galleryPublic = gallery.filter((g) => !g.isPaid).map((g) => ({ url: g.url, thumbnailUrl: g.thumbnailUrl }));
  const galleryPaid = gallery.filter((g) => g.isPaid);

  const v: PublicTherapistView = {
    id: t.id,
    userId: t.userId,
    displayName: displayName ?? null, // 取 users.displayName · CLAUDE.md 严格按原需求展示真名
    avatarUrl: t.avatarUrl,
    bio: t.bio,
    bioTranslations: t.bioTranslations,
    tags: t.tags,
    nationality: t.nationality,
    languages: t.languages,
    serviceCountry: t.serviceCountry,
    serviceCity: t.serviceCity,
    serviceArea: t.serviceArea,
    serviceMode: t.serviceMode ?? 'outcall',
    serviceCityId: t.serviceCityId ?? null,
    serviceAreaId: t.serviceAreaId ?? null,
    voiceIntroUrl: t.voiceIntroUrl ?? DEMO_VOICE_INTRO_URL,
    shortVideoUrl: t.shortVideoUrl,
    galleryPublic,
    galleryPaidCount: galleryPaid.length,
    skillsJson: t.skillsJson,
    preferencesJson: t.preferencesJson,
    basePriceJson: t.basePriceJson,
    defaultCurrencyCode: deriveDefaultCurrency(t),
    onlineStatus: t.onlineStatus,
    scoreAppearance: t.scoreAppearance,
    scoreBody: t.scoreBody,
    scoreService: t.scoreService,
    ratingBayes: t.ratingBayes,
    ratingCount: t.ratingCount,
    completedOrders: t.completedOrders,
    verificationStatus: t.verificationStatus,
    // 5 维身体 + 学历：CLAUDE.md「严格按原需求，不反向打磨」→ 客户可见
    heightCm: t.heightCm,
    weightKg: t.weightKg,
    bustCm: t.bustCm,
    hipCm: t.hipCm,
    bodyFatPct: t.bodyFatPct ? String(t.bodyFatPct) : null,
    education: t.education,
  };

  if (scope === 'self' || scope === 'admin') {
    v.profileCompleteness = t.profileCompleteness;
    v.livenessVideoUrl = t.livenessVideoUrl; // 真人核验视频 · 仅平台
    v.galleryPaid = galleryPaid;
    // M11 Phase 1 · 媒体管理页编辑器需要完整数组(含 isPaid 标记)
    v.galleryJson = gallery;
    v.verifiedAt = t.verifiedAt ? t.verifiedAt.toISOString() : null;
    if (t.socialContactsEncrypted) {
      v.socialContacts = JSON.parse(t.socialContactsEncrypted) as Record<string, string>;
    }
    // 到店服务 · 技师自己编辑页回显门店地址 + 须知 + 指引媒体
    if (t.serviceAddressFullEncrypted) {
      v.serviceAddressFull = t.serviceAddressFullEncrypted;
    }
    v.shopArrivalNote = t.shopArrivalNote ?? null;
    v.shopGuideMedia = (t.shopGuideMedia ?? []) as Array<{ mediaId: string; kind: 'image' | 'video'; caption?: string }>;
  }

  if (scope === 'customer_paid') {
    v.galleryPaid = galleryPaid;
    if (t.socialContactsEncrypted) {
      v.socialContacts = JSON.parse(t.socialContactsEncrypted) as Record<string, string>;
    }
    if (t.serviceAddressFullEncrypted) {
      v.serviceAddressFull = t.serviceAddressFullEncrypted;
    }
  }

  return v;
}

// ──────────────── 完整度计算 ────────────────

const COMPLETENESS_WEIGHTS: Array<{ key: keyof Therapist; weight: number; check: (t: Therapist) => boolean }> = [
  { key: 'avatarUrl', weight: 8, check: (t) => !!t.avatarUrl },
  { key: 'bio', weight: 8, check: (t) => !!t.bio && t.bio.length >= 20 },
  { key: 'voiceIntroUrl', weight: 10, check: (t) => !!t.voiceIntroUrl },
  { key: 'shortVideoUrl', weight: 12, check: (t) => !!t.shortVideoUrl },
  { key: 'livenessVideoUrl', weight: 15, check: (t) => !!t.livenessVideoUrl },
  { key: 'galleryJson', weight: 10, check: (t) => Array.isArray(t.galleryJson) && t.galleryJson.length >= 3 },
  { key: 'serviceCity', weight: 5, check: (t) => !!t.serviceCity },
  { key: 'heightCm', weight: 4, check: (t) => !!t.heightCm },
  { key: 'weightKg', weight: 4, check: (t) => !!t.weightKg },
  { key: 'bustCm', weight: 3, check: (t) => !!t.bustCm },
  { key: 'hipCm', weight: 3, check: (t) => !!t.hipCm },
  { key: 'bodyFatPct', weight: 2, check: (t) => !!t.bodyFatPct },
  { key: 'education', weight: 2, check: (t) => !!t.education },
  { key: 'skillsJson', weight: 6, check: (t) => Array.isArray(t.skillsJson) && (t.skillsJson as unknown[]).length > 0 },
  { key: 'basePriceJson', weight: 5, check: (t) => Array.isArray(t.basePriceJson) && (t.basePriceJson as unknown[]).length > 0 },
  { key: 'preferencesJson', weight: 3, check: (t) => !!t.preferencesJson && Object.keys(t.preferencesJson).length > 0 },
];

export function computeCompleteness(t: Therapist): number {
  return COMPLETENESS_WEIGHTS.reduce((acc, item) => (item.check(t) ? acc + item.weight : acc), 0);
}

// ──────────────── 地理距离过滤/排序(纯函数 · 可单测) ────────────────

/** 客户坐标 · 三者都给才启用地理模式 */
export interface ViewerGeo {
  lat: number;
  lng: number;
  /** 半径(km)· 给了就过滤 + 按距离升序;没给只算 distance 不过滤 */
  radiusKm?: number;
}

/** 携带可解析坐标的技师条目 · 字典中心坐标(text)· 任一缺失视为无坐标 */
export interface GeoItem<T> {
  item: T;
  /** 优先 area 中心 · 回退 city 中心 · 都无则 null */
  lat: string | null | undefined;
  lng: string | null | undefined;
}

/** distance 计算 + 排序结果(供 service 与单测共用) */
export interface GeoResult<T> {
  item: T;
  distanceKm: number | null;
}

/**
 * 对一批技师套用地理距离逻辑(纯函数 · 不碰 DB):
 *  - 计算每条 distance_km(distanceKmRounded · 字典中心坐标近似)
 *  - 传了 radiusKm:剔除 distance>radius 或 distance=null 的,按距离升序
 *  - 没传 radiusKm:不剔除,但按距离升序(有坐标的在前,null 排末尾)
 *
 * 不传 viewer 时返回原序 + distanceKm=null。
 */
export function applyGeoDistance<T>(
  rows: Array<GeoItem<T>>,
  viewer: ViewerGeo | null,
): Array<GeoResult<T>> {
  if (!viewer) {
    return rows.map((r) => ({ item: r.item, distanceKm: null }));
  }

  const computed: Array<GeoResult<T>> = rows.map((r) => ({
    item: r.item,
    distanceKm: distanceKmRounded(viewer.lat, viewer.lng, r.lat, r.lng),
  }));

  let result = computed;
  if (typeof viewer.radiusKm === 'number') {
    result = computed.filter((r) => r.distanceKm != null && r.distanceKm <= viewer.radiusKm!);
  }

  // 距离升序;null(无坐标)排末尾 · 保持稳定
  result = result
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const da = a.r.distanceKm;
      const db = b.r.distanceKm;
      if (da == null && db == null) return a.i - b.i;
      if (da == null) return 1;
      if (db == null) return -1;
      if (da !== db) return da - db;
      return a.i - b.i;
    })
    .map((x) => x.r);

  return result;
}

// ──────────────── 服务方法 ────────────────

async function ensureTherapistRow(ctx: TherapistContext, userId: string): Promise<Therapist> {
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!u) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'user not found');
  if (u.userType !== 'therapist') {
    throw HttpError.forbidden(ErrorCode.E2020_USER_TYPE_LOCKED, 'only therapist can manage therapist profile');
  }

  let row = await ctx.db.query.therapists.findFirst({ where: eq(therapists.userId, userId) });
  if (!row) {
    const [created] = await ctx.db.insert(therapists).values({ userId }).returning();
    if (!created) throw HttpError.internal('therapist row create failed');
    row = created;
  }
  return row;
}

export type TherapistPatch = Partial<
  Pick<
    Therapist,
    | 'bio'
    | 'bioTranslations'
    | 'tags'
    | 'nationality'
    | 'languages'
    | 'avatarUrl'
    | 'voiceIntroUrl'
    | 'shortVideoUrl'
    | 'galleryJson'
    | 'serviceCountry'
    | 'serviceCity'
    | 'serviceArea'
    | 'serviceMode'
    | 'serviceAddressFullEncrypted'
    | 'shopArrivalNote'
    | 'shopGuideMedia'
    | 'heightCm'
    | 'weightKg'
    | 'bustCm'
    | 'hipCm'
    | 'bodyFatPct'
    | 'education'
    | 'skillsJson'
    | 'basePriceJson'
    | 'preferencesJson'
  >
>;

export async function upsertProfile(
  ctx: TherapistContext,
  userId: string,
  patch: TherapistPatch,
): Promise<PublicTherapistView> {
  const row = await ensureTherapistRow(ctx, userId);

  // 0027 法币模式 · basePriceJson 每档若给了 currencyCode+priceFiat
  // → 后端用 fx.convertFiatToPoints 算回 pricePoints 兜底 · 双写
  if (patch.basePriceJson && Array.isArray(patch.basePriceJson)) {
    const { convertFiatToPoints } = await import('./fx');
    const normalized: Array<{
      duration: number;
      pricePoints: number;
      currencyCode?: string;
      priceFiat?: number;
    }> = [];
    for (const p of patch.basePriceJson as Array<{
      duration: number;
      pricePoints?: number;
      currencyCode?: string;
      priceFiat?: number;
    }>) {
      if (p.currencyCode && p.priceFiat != null) {
        const pts = await convertFiatToPoints(ctx, p.priceFiat, p.currencyCode);
        normalized.push({
          duration: p.duration,
          pricePoints: pts,
          currencyCode: p.currencyCode,
          priceFiat: p.priceFiat,
        });
      } else {
        normalized.push({
          duration: p.duration,
          pricePoints: p.pricePoints ?? 0,
        });
      }
    }
    patch = { ...patch, basePriceJson: normalized };
  }

  // 到店服务 · shopGuideMedia 每个 mediaId 须属于本技师(media_assets.ownerUserId === userId),非法项剔除
  if (patch.shopGuideMedia && Array.isArray(patch.shopGuideMedia)) {
    const items = patch.shopGuideMedia as Array<{ mediaId: string; kind: 'image' | 'video'; caption?: string }>;
    const ids = items.map((m) => m.mediaId);
    const owned =
      ids.length > 0
        ? await ctx.db
            .select({ id: mediaAssets.id })
            .from(mediaAssets)
            .where(and(eq(mediaAssets.ownerUserId, userId), inArray(mediaAssets.id, ids)))
        : [];
    const ownedSet = new Set(owned.map((m) => m.id));
    patch = { ...patch, shopGuideMedia: items.filter((m) => ownedSet.has(m.mediaId)) };
  }

  const merged: Therapist = { ...row, ...patch };
  const completeness = computeCompleteness(merged);

  const [updated] = await ctx.db
    .update(therapists)
    .set({ ...(patch as Record<string, unknown>), profileCompleteness: completeness, updatedAt: new Date() })
    .where(eq(therapists.id, row.id))
    .returning();

  if (!updated) throw HttpError.internal('therapist update failed');
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, updated.userId) });
  return publicView(updated, 'self', u?.displayName ?? null);
}

export async function getTherapistView(
  ctx: TherapistContext,
  args: { therapistId: string; viewerUserId?: string; viewerHasPaid?: boolean; viewerIsAdmin?: boolean },
): Promise<PublicTherapistView> {
  const row = await ctx.db.query.therapists.findFirst({ where: eq(therapists.id, args.therapistId) });
  if (!row) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');

  let scope: ViewerScope;
  if (args.viewerIsAdmin) scope = 'admin';
  else if (args.viewerUserId === row.userId) scope = 'self';
  else if (args.viewerHasPaid) scope = 'customer_paid';
  else scope = 'customer_free';

  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, row.userId) });

  // P1 安全 · admin 暂停/封禁的技师不应被客户直接访问(防 URL 直拿)· self/admin 视角保留
  if (u && u.status !== 'active' && scope !== 'self' && scope !== 'admin') {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');
  }

  const view = publicView(row, scope, u?.displayName ?? null);

  // M02 Phase 6 · 收藏态(只在 viewer ≠ self · 客户视角时查)
  if (args.viewerUserId && scope !== 'self') {
    const { favorites } = await import('@loverush/db');
    const fav = await ctx.db.query.favorites.findFirst({
      where: (f, { and: andFn, eq: eqFn }) => andFn(
        eqFn(f.customerId, args.viewerUserId!),
        eqFn(f.therapistId, args.therapistId),
      ),
    });
    view.isFavorite = !!fav;
  }

  return view;
}

export async function getMyProfile(ctx: TherapistContext, userId: string): Promise<PublicTherapistView> {
  const row = await ensureTherapistRow(ctx, userId);
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
  const view = publicView(row, 'self', u?.displayName ?? null);

  // 到店指引媒体:技师自己编辑页要看缩略图 → 给每项补 previewUrl(thumbnail 优先,回退 publicUrl)。
  // 技师自己的视图显示全部已传(含待审),不走 approved 过滤;失败降级为不带 url(前端显文字占位)。
  if (view.shopGuideMedia && view.shopGuideMedia.length > 0) {
    try {
      const ids = view.shopGuideMedia.map((m) => m.mediaId);
      const rows = await ctx.db
        .select({ id: mediaAssets.id, publicUrl: mediaAssets.publicUrl, thumbnailUrl: mediaAssets.thumbnailUrl })
        .from(mediaAssets)
        .where(inArray(mediaAssets.id, ids));
      const urlById = new Map(rows.map((r) => [r.id, r.thumbnailUrl ?? r.publicUrl ?? undefined]));
      view.shopGuideMedia = view.shopGuideMedia.map((m) => {
        const url = urlById.get(m.mediaId);
        return url ? { ...m, previewUrl: url } : m;
      });
    } catch {
      /* 解析失败不阻断档案返回 */
    }
  }
  return view;
}

export async function getTherapistByUserId(ctx: TherapistContext, userId: string): Promise<Therapist | null> {
  const row = await ctx.db.query.therapists.findFirst({ where: eq(therapists.userId, userId) });
  return row ?? null;
}

export interface ListTherapistsParams {
  city?: string;
  online?: boolean;
  limit?: number;
  offset?: number;
  /** 搜索关键词 · 模糊匹配 users.displayName(后续可扩展到 tags / nationality 等) */
  search?: string;
  /** Phase 2 NLP 解析后的结构化条件 */
  heightMin?: number;
  heightMax?: number;
  nationality?: string;
  /** 语言 · 匹配 therapists.languages 数组(包含) */
  language?: string;
  /** 技能/风格 · 匹配 skills jsonb 中 skill 字段 */
  skill?: string;
  /** 评分下限(0-50 · 4.5★=45) */
  scoreMin?: number;
  /** 价格上限(任一档 pricePoints ≤ 此值即命中) */
  priceMax?: number;
  /** M02 Phase 5 · 城市字典 uuid · 撮合精准 */
  cityId?: string;
  /** M02 Phase 5 · 区域字典 uuid */
  areaId?: string;
  // ──────── 发现页 · 地理距离 ────────
  /** 客户纬度 · 与 lng/radiusKm 配套 */
  lat?: number;
  /** 客户经度 */
  lng?: number;
  /** 半径(km)· lat+lng+radiusKm 三者齐全才过滤+按距离升序 */
  radiusKm?: number;
  // ──────── 发现页 · 综合评分过滤 ────────
  /**
   * 综合评分下限(0-10 · 10 分制)· ≥ 该值的技师才返回
   *   内部按 (scoreAppearance+scoreBody+scoreService) 0-3000 量纲比较
   *   换算:minRating(0-10) → 三维分之和阈值 = minRating * 300
   *   与旧 scoreMin(仅 scoreService 0-50 量纲)是两个独立参数
   */
  minRating?: number;
}

export async function listTherapists(
  ctx: TherapistContext,
  params: ListTherapistsParams,
): Promise<{ data: PublicTherapistView[]; total: number }> {
  const { eq: eqFn, and: andFn, sql: sqlFn, inArray: inArrayFn, ilike: ilikeFn, gte: gteFn, lte: lteFn } = await import('drizzle-orm');

  const conditions = [eqFn(therapists.verificationStatus, 'passed')] as ReturnType<typeof eqFn>[];
  // 排除被 admin 暂停/封禁的账户(users.status != 'active' 都不应被客户看到)
  // 复用 EXISTS 子查询 · 不引入 JOIN 改变现有 findMany 行为
  conditions.push(
    sqlFn`EXISTS (SELECT 1 FROM users WHERE users.id = ${therapists.userId} AND users.status = 'active')`,
  );
  if (params.city) conditions.push(eqFn(therapists.serviceCity, params.city));
  if (params.online === true) conditions.push(eqFn(therapists.onlineStatus, 'online'));

  // Phase 2 NLP 结构化条件
  if (typeof params.heightMin === 'number') conditions.push(gteFn(therapists.heightCm, params.heightMin));
  if (typeof params.heightMax === 'number') conditions.push(lteFn(therapists.heightCm, params.heightMax));
  if (params.nationality) conditions.push(ilikeFn(therapists.nationality, `%${params.nationality}%`));
  if (params.language) {
    // languages text[] · 用 PG @> contains 操作
    conditions.push(sqlFn`${therapists.languages} @> ARRAY[${params.language}]::text[]`);
  }
  if (params.skill && params.skill.trim()) {
    // skills jsonb 数组 · 模糊匹配 skill 名。支持逗号多选 = 命中任一技能(OR)
    const skills = params.skill.split(',').map((s) => s.trim()).filter(Boolean);
    if (skills.length > 0) {
      const ors = sqlFn.join(
        skills.map((s) => sqlFn`elem->>'skill' ILIKE ${`%${s}%`}`),
        sqlFn` OR `,
      );
      conditions.push(
        sqlFn`EXISTS (SELECT 1 FROM jsonb_array_elements(${therapists.skillsJson}) elem WHERE ${ors})`,
      );
    }
  }
  if (typeof params.scoreMin === 'number') conditions.push(gteFn(therapists.scoreService, params.scoreMin));
  if (params.cityId) conditions.push(eqFn(therapists.serviceCityId, params.cityId));
  if (params.areaId) conditions.push(eqFn(therapists.serviceAreaId, params.areaId));
  if (typeof params.priceMax === 'number') {
    // basePriceJson 是数组 [{duration, pricePoints}] · 任一档 ≤ priceMax 即命中
    conditions.push(
      sqlFn`EXISTS (SELECT 1 FROM jsonb_array_elements(${therapists.basePriceJson}) AS p WHERE (p->>'pricePoints')::integer <= ${params.priceMax})`,
    );
  }
  // 发现页「9分天花板」· 综合评分(三维和 0-3000)≥ minRating*300
  // 三维各 0-1000(10 分制 ×100)· 和除 300 = 0-10 分(与 discover 卡片公式一致)
  if (typeof params.minRating === 'number') {
    const threshold = Math.round(params.minRating * 300);
    conditions.push(
      sqlFn`(${therapists.scoreAppearance} + ${therapists.scoreBody} + ${therapists.scoreService}) >= ${threshold}`,
    );
  }

  // search · 先按 displayName ilike 找 user.id,再 in array 筛 therapists.userId
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    const { users: usersTable } = await import('@loverush/db');
    const matchedUsers = await ctx.db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(ilikeFn(usersTable.displayName, q));
    const matchedIds = matchedUsers.map((u) => u.id);
    if (matchedIds.length === 0 && !params.heightMin && !params.heightMax && !params.skill && !params.city) {
      // 纯关键词没匹配 + 没别的条件 = 空
      return { data: [], total: 0 };
    }
    if (matchedIds.length > 0) {
      conditions.push(inArrayFn(therapists.userId, matchedIds));
    }
    // 如果有其他条件 · search 没匹配 · 仍按其他条件返(用户体验更好)
  }

  const whereClause = conditions.length > 1 ? andFn(...conditions) : conditions[0];

  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const offset = Math.max(params.offset ?? 0, 0);

  // 地理模式:lat+lng 同时给才启用(radius 可选)。坐标在字典表(areas/cities)
  // 且要回退逻辑,SQL 算 haversine 不便,这里取全量候选→内存算距离→过滤排序→分页。
  const geoEnabled = typeof params.lat === 'number' && typeof params.lng === 'number';
  const viewerGeo: ViewerGeo | null = geoEnabled
    ? { lat: params.lat!, lng: params.lng!, radiusKm: typeof params.radiusKm === 'number' ? params.radiusKm : undefined }
    : null;

  if (geoEnabled) {
    // 取全量候选(不分页)· 再内存算距离/过滤/排序/分页
    const allRows = await ctx.db.query.therapists.findMany({
      where: whereClause,
      orderBy: (t, { desc }) => [desc(t.ratingBayes), desc(t.completedOrders)],
    });
    if (allRows.length === 0) return { data: [], total: 0 };

    // 批量取字典中心坐标:优先 area · 回退 city
    const areaIds = [...new Set(allRows.map((r) => r.serviceAreaId).filter((x): x is string => !!x))];
    const cityIds = [...new Set(allRows.map((r) => r.serviceCityId).filter((x): x is string => !!x))];
    const [areaRows, cityRows] = await Promise.all([
      areaIds.length > 0
        ? ctx.db.query.areas.findMany({ where: (a, { inArray }) => inArray(a.id, areaIds) })
        : Promise.resolve([] as Array<{ id: string; latCenter: string | null; lngCenter: string | null }>),
      cityIds.length > 0
        ? ctx.db.query.cities.findMany({ where: (cc, { inArray }) => inArray(cc.id, cityIds) })
        : Promise.resolve([] as Array<{ id: string; latCenter: string | null; lngCenter: string | null }>),
    ]);
    const areaCoord = new Map(areaRows.map((a) => [a.id, { lat: a.latCenter, lng: a.lngCenter }]));
    const cityCoord = new Map(cityRows.map((cc) => [cc.id, { lat: cc.latCenter, lng: cc.lngCenter }]));

    const geoItems: Array<GeoItem<Therapist>> = allRows.map((r) => {
      // 优先 area 中心(且坐标非空)· 否则回退 city 中心
      const ac = r.serviceAreaId ? areaCoord.get(r.serviceAreaId) : undefined;
      const cc = r.serviceCityId ? cityCoord.get(r.serviceCityId) : undefined;
      const coord = ac && ac.lat != null && ac.lng != null ? ac : cc;
      return { item: r, lat: coord?.lat, lng: coord?.lng };
    });

    const ranked = applyGeoDistance(geoItems, viewerGeo);
    const total = ranked.length; // radius 过滤后的真实总数
    const pageSlice = ranked.slice(offset, offset + limit);
    if (pageSlice.length === 0) return { data: [], total };

    const userIds = pageSlice.map((r) => r.item.userId);
    const userRows = await ctx.db.query.users.findMany({
      where: (u, { inArray }) => inArray(u.id, userIds),
    });
    const nameById = new Map(userRows.map((u) => [u.id, u.displayName]));

    const data = pageSlice.map((r) => {
      const v = publicView(r.item, 'customer_free', nameById.get(r.item.userId) ?? null);
      v.distance_km = r.distanceKm;
      return v;
    });
    return { data, total };
  }

  const rows = await ctx.db.query.therapists.findMany({
    where: whereClause,
    orderBy: (t, { desc }) => [desc(t.ratingBayes), desc(t.completedOrders)],
    limit,
    offset,
  });

  const totalRes = (await ctx.db.execute(
    sqlFn`SELECT COUNT(*)::int AS n FROM therapists t WHERE t.verification_status = 'passed' AND EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id AND u.status = 'active')${params.city ? sqlFn` AND t.service_city = ${params.city}` : sqlFn``}${params.online === true ? sqlFn` AND t.online_status = 'online'` : sqlFn``}${typeof params.minRating === 'number' ? sqlFn` AND (t.score_appearance + t.score_body + t.score_service) >= ${Math.round(params.minRating * 300)}` : sqlFn``}`,
  )) as Array<{ n: number }>;
  const total = totalRes[0]?.n ?? 0;

  // JOIN users.displayName 一次性拿（避免 N+1）
  if (rows.length === 0) return { data: [], total };
  const userIds = rows.map((r) => r.userId);
  const userRows = await ctx.db.query.users.findMany({
    where: (u, { inArray }) => inArray(u.id, userIds),
  });
  const nameById = new Map(userRows.map((u) => [u.id, u.displayName]));

  const data = rows.map((r) => publicView(r, 'customer_free', nameById.get(r.userId) ?? null));
  return { data, total };
}
