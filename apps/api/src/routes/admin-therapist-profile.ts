/**
 * 技师完整档案 · admin · (T3)
 *
 * GET /admin/users/:id/therapist-profile
 *
 * 返回 therapists 表 ~47 字段的全展开版本(非敏感字段全部返回 raw)。
 * 敏感字段(社交/地址/身体)走 T2 /decrypt-private 单独 audit。
 *
 * 用途:admin 客户/技师详情页 '完整档案' tab(技师专属)
 *
 * 权限:admin / cs / auditor / ops
 *   ops 看不到 systemPromptOverride / aiAlterPersonality(可能含隐私)
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { therapists, users } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { generateMatchPersona } from '../services/match';

export const adminTherapistProfileRoutes = new Hono();
adminTherapistProfileRoutes.use('*', requireAuth, requireRole(['admin', 'cs', 'auditor', 'ops']));

adminTherapistProfileRoutes.get('/:id/therapist-profile', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const roles = (c.get('userRoles' as never) as string[] | undefined) ?? [];
  const isAdmin = roles.includes('admin');
  const isOps = roles.length === 1 && roles[0] === 'ops';

  // 验证 user 存在 + 是技师
  const u = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: { id: true, displayName: true, userType: true },
  });
  if (!u) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'user not found');
  if (u.userType !== 'therapist') {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'not a therapist');
  }

  const t = await db.query.therapists.findFirst({ where: eq(therapists.userId, id) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist profile not found');

  return c.json({
    data: {
      // ── 身份 / 文档
      id: t.id,
      bio: t.bio,
      bioTranslations: t.bioTranslations,
      tags: t.tags,
      nationality: t.nationality,
      languages: t.languages,
      // ── 媒体 URL(公开)
      avatarUrl: t.avatarUrl,
      voiceIntroUrl: t.voiceIntroUrl,
      shortVideoUrl: t.shortVideoUrl,
      galleryJson: t.galleryJson,
      // ── 地址(粗粒度公开;精确加密走 T2)
      serviceCountry: t.serviceCountry,
      serviceCity: t.serviceCity,
      serviceArea: t.serviceArea,
      hasEncryptedAddress: !!t.serviceAddressFullEncrypted,
      // ── KYC
      verificationStatus: t.verificationStatus,
      verifiedAt: t.verifiedAt,
      realnessCheckLastAt: t.realnessCheckLastAt,
      realnessCheckProvider: t.realnessCheckProvider,
      hasLivenessVideo: !!t.livenessVideoUrl,
      // ── 服务能力
      skillsJson: t.skillsJson,
      preferencesJson: t.preferencesJson,
      basePriceJson: t.basePriceJson,
      socialUnlockPricePoints: t.socialUnlockPricePoints,
      hasEncryptedSocialContacts: !!t.socialContactsEncrypted,
      // ── 评分 / 统计
      scoreAppearance: t.scoreAppearance,
      scoreBody: t.scoreBody,
      scoreService: t.scoreService,
      rating: t.rating,
      ratingCount: t.ratingCount,
      completedOrders: t.completedOrders,
      repeatCustomerCount: t.repeatCustomerCount,
      profileCompleteness: t.profileCompleteness,
      // ── 在线 / 冷却
      onlineStatus: t.onlineStatus,
      lastOnlineAt: t.lastOnlineAt,
      coolingStatus: t.coolingStatus,
      coolingUntilAt: t.coolingUntilAt,
      // ── AI 分身(M06)
      aiAlterEnabled: t.aiAlterEnabled,
      aiAlterPersonality: isOps ? null : t.aiAlterPersonality,
      // ── M04 匹配语义画像(可在本页编辑 / 重新生成)
      matchPersona: t.matchPersona,
      // ── 身体数据存在性提示(具体值走 T2)
      hasBodyMetrics: !!(t.heightCm || t.weightKg || t.bustCm || t.hipCm),
      // ── 时间戳
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    },
    meta: { ops_masked: isOps, can_decrypt_private: isAdmin },
  });
});

// ──────── M04 · 技师匹配画像(match_persona)管理 ────────

/** 编辑技师匹配画像(人工修正 LLM 生成内容) */
adminTherapistProfileRoutes.put('/:id/match-persona', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const t = await db.query.therapists.findFirst({ where: eq(therapists.userId, id) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');
  const arr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim())
          .slice(0, 6)
      : [];
  const payload = {
    suitableFor: arr(body.suitableFor),
    toneTags: arr(body.toneTags),
    emotionalValue: arr(body.emotionalValue),
    notFor: arr(body.notFor),
    source: 'therapist_edited' as const,
    updatedAt: new Date().toISOString(),
  };
  await db.update(therapists).set({ matchPersona: payload }).where(eq(therapists.id, t.id));
  return c.json({ data: payload });
});

/** 用 LLM 从 bio/tags/skills 重新生成技师匹配画像 */
adminTherapistProfileRoutes.post('/:id/match-persona/regenerate', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const t = await db.query.therapists.findFirst({ where: eq(therapists.userId, id) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');
  const persona = await generateMatchPersona({ db }, t.id);
  if (!persona) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, '生成失败(无 LLM key 或模型未返回有效 JSON)');
  }
  return c.json({ data: persona });
});

// ──────── M06 · 技师 AI 分身语气配置(aiAlterPersonality)后台编辑 ────────

/** 编辑技师 AI 分身语气配置 · 之前只读,补后台编辑入口(对齐 match-persona 可改) */
adminTherapistProfileRoutes.put('/:id/ai-alter-personality', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const t = await db.query.therapists.findFirst({ where: eq(therapists.userId, id) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');

  const clampNum = (v: unknown): number | undefined => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : undefined;
  };
  const trimStr = (v: unknown, max: number): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s ? s.slice(0, max) : undefined;
  };

  const prev = (t.aiAlterPersonality as Record<string, unknown> | null) ?? {};
  const payload: Record<string, unknown> = {
    ...prev,
    tone: trimStr(body.tone, 20) ?? prev.tone,
    warmth: clampNum(body.warmth) ?? prev.warmth,
    humor: clampNum(body.humor) ?? prev.humor,
    proactivity: clampNum(body.proactivity) ?? prev.proactivity,
    selfDescription: trimStr(body.selfDescription, 1500) ?? prev.selfDescription,
    speechSample: trimStr(body.speechSample, 800) ?? prev.speechSample,
    nicknameForCustomer: trimStr(body.nicknameForCustomer, 20) ?? prev.nicknameForCustomer,
  };

  await db.update(therapists).set({ aiAlterPersonality: payload }).where(eq(therapists.id, t.id));
  return c.json({ data: payload });
});
