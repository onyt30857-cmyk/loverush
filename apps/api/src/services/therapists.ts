/**
 * 技师服务 · M02
 *
 * 三件事：
 * 1. profile 增量 upsert（首次自动建 therapists 行）
 * 2. 按调用方差异化字段输出（公开 / 付费 / 仅平台）
 * 3. profile_completeness 计算
 */

import { eq } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  therapists,
  users,
  type Therapist,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';

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
  voiceIntroUrl: string | null;
  shortVideoUrl: string | null;
  galleryPublic: Array<{ url: string; thumbnailUrl?: string }>;
  galleryPaidCount: number;
  skillsJson: unknown;
  preferencesJson: unknown;
  basePriceJson: unknown;
  onlineStatus: string;
  scoreAppearance: number;
  scoreBody: number;
  scoreService: number;
  ratingCount: number;
  completedOrders: number;
  verificationStatus: string;
  profileCompleteness?: number;
  // 付费可见
  galleryPaid?: Array<{ url: string; thumbnailUrl?: string; pricePoints?: number }>;
  socialContacts?: Record<string, string>;
  serviceAddressFull?: string;
  // 仅 self / admin
  heightCm?: number | null;
  weightKg?: number | null;
  bustCm?: number | null;
  hipCm?: number | null;
  bodyFatPct?: string | null;
  education?: string | null;
  livenessVideoUrl?: string | null;
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
    voiceIntroUrl: t.voiceIntroUrl,
    shortVideoUrl: t.shortVideoUrl,
    galleryPublic,
    galleryPaidCount: galleryPaid.length,
    skillsJson: t.skillsJson,
    preferencesJson: t.preferencesJson,
    basePriceJson: t.basePriceJson,
    onlineStatus: t.onlineStatus,
    scoreAppearance: t.scoreAppearance,
    scoreBody: t.scoreBody,
    scoreService: t.scoreService,
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
    if (t.socialContactsEncrypted) {
      v.socialContacts = JSON.parse(t.socialContactsEncrypted) as Record<string, string>;
    }
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
  return publicView(row, scope, u?.displayName ?? null);
}

export async function getMyProfile(ctx: TherapistContext, userId: string): Promise<PublicTherapistView> {
  const row = await ensureTherapistRow(ctx, userId);
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, userId) });
  return publicView(row, 'self', u?.displayName ?? null);
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
}

export async function listTherapists(
  ctx: TherapistContext,
  params: ListTherapistsParams,
): Promise<{ data: PublicTherapistView[]; total: number }> {
  const { eq: eqFn, and: andFn, sql: sqlFn, inArray: inArrayFn, ilike: ilikeFn, gte: gteFn, lte: lteFn } = await import('drizzle-orm');

  const conditions = [eqFn(therapists.verificationStatus, 'passed')] as ReturnType<typeof eqFn>[];
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
  if (params.skill) {
    // skills jsonb 数组 · jsonb_path_exists 模糊匹配 skill 名
    conditions.push(
      sqlFn`EXISTS (SELECT 1 FROM jsonb_array_elements(${therapists.skillsJson}) elem WHERE elem->>'skill' ILIKE ${`%${params.skill}%`})`,
    );
  }
  if (typeof params.scoreMin === 'number') conditions.push(gteFn(therapists.scoreService, params.scoreMin));

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

  const rows = await ctx.db.query.therapists.findMany({
    where: whereClause,
    orderBy: (t, { desc }) => [desc(t.scoreService), desc(t.completedOrders)],
    limit,
    offset,
  });

  const totalRes = (await ctx.db.execute(
    sqlFn`SELECT COUNT(*)::int AS n FROM therapists WHERE verification_status = 'passed'${params.city ? sqlFn` AND service_city = ${params.city}` : sqlFn``}${params.online === true ? sqlFn` AND online_status = 'online'` : sqlFn``}`,
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
