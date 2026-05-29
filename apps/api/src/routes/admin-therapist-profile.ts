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
      // ── 身体数据存在性提示(具体值走 T2)
      hasBodyMetrics: !!(t.heightCm || t.weightKg || t.bustCm || t.hipCm),
      // ── 时间戳
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    },
    meta: { ops_masked: isOps, can_decrypt_private: isAdmin },
  });
});
