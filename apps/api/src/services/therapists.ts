/**
 * 技师服务 · M02
 *
 * 三件事：
 * 1. profile 增量 upsert（首次自动建 therapists 行）
 * 2. 按调用方差异化字段输出（公开 / 付费 / 仅平台）
 * 3. profile_completeness 计算
 */

import { eq } from 'drizzle-orm';
import {
  Database,
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
  { key: 'preferencesJson', weight: 3, check: (t) => !!t.preferencesJson && Object.keys(t.preferencesJson as object).length > 0 },
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

  const merged: Therapist = { ...row, ...patch } as Therapist;
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
