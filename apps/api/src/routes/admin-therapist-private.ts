/**
 * 技师私密字段查看 · admin · (T2)
 *
 * POST /admin/users/:id/decrypt-private
 *   body: { scope: 'social' | 'address' | 'body' | 'all', reason: string }
 *
 * 返回:
 *   - social: 微信/Line/WhatsApp/Telegram 等(从 socialContactsEncrypted JSON 解析)
 *   - address: 完整门牌号 + 楼层 + 房号(从 serviceAddressFullEncrypted)
 *   - body: 身高 / 体重 / 胸围 / 腰围 / 体脂率 / 教育(明文字段,platform_only)
 *   - all: 三者一次返
 *
 * 权限:
 *   - admin:全 scope
 *   - cs:仅 social(地址不给)
 *   - 其他角色:403
 *
 * 审计:每次访问写 admin_audit_log
 *   action='therapist.private_view'
 *   metadata={ scope, reason }
 *
 * 注:虽然字段名带 Encrypted 后缀,实际为 JSON 文本(未端云加密)
 * 后端取数即可,前端用 modal 显 + 30s 自动消失
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { therapists, users } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { recordAudit } from '../services/audit';

const DecryptBody = z.object({
  scope: z.enum(['social', 'address', 'body', 'all']),
  reason: z.string().min(1).max(500),
});

export const adminTherapistPrivateRoutes = new Hono();
adminTherapistPrivateRoutes.use('*', requireAuth, requireRole(['admin', 'cs']));

adminTherapistPrivateRoutes.post('/:id/decrypt-private', zValidator('json', DecryptBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const db = getDb();
  const roles = (c.get('userRoles' as never) as string[] | undefined) ?? [];
  const isAdmin = roles.includes('admin');

  // cs 只能看 social,不能看 address/body/all
  if (!isAdmin && body.scope !== 'social') {
    throw HttpError.forbidden(ErrorCode.E1002_INSUFFICIENT_ROLE ?? 'E1002', 'cs role can only view social contacts');
  }

  // 拉用户 + 技师档案
  const u = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: { id: true, userType: true, displayName: true },
  });
  if (!u) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'user not found');
  if (u.userType !== 'therapist') {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'not a therapist');
  }

  const t = await db.query.therapists.findFirst({ where: eq(therapists.userId, id) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist profile not found');

  // 解析 + 组装返回
  const result: {
    social?: Record<string, string> | null;
    socialUnlockPricePoints?: number | null;
    address?: string | null;
    body?: {
      heightCm: number | null;
      weightKg: number | null;
      bustCm: number | null;
      hipCm: number | null;
      bodyFatPct: number | string | null;
      education: string | null;
    } | null;
  } = {};

  if (body.scope === 'social' || body.scope === 'all') {
    try {
      result.social = t.socialContactsEncrypted ? (JSON.parse(t.socialContactsEncrypted) as Record<string, string>) : null;
    } catch {
      result.social = null;
    }
    result.socialUnlockPricePoints = t.socialUnlockPricePoints ?? null;
  }
  if ((body.scope === 'address' || body.scope === 'all') && isAdmin) {
    result.address = t.serviceAddressFullEncrypted ?? null;
  }
  if ((body.scope === 'body' || body.scope === 'all') && isAdmin) {
    result.body = {
      heightCm: t.heightCm ?? null,
      weightKg: t.weightKg ?? null,
      bustCm: t.bustCm ?? null,
      hipCm: t.hipCm ?? null,
      bodyFatPct: (t.bodyFatPct as number | string | null) ?? null,
      education: t.education ?? null,
    };
  }

  // 写审计日志 · 谁、何时、看了什么 scope、原因
  await recordAudit({ db }, c, {
    action: 'therapist.private_view',
    targetType: 'therapist',
    targetId: id,
    before: null,
    after: { scope: body.scope, fields_seen: Object.keys(result) },
    reason: body.reason,
  });

  return c.json({ data: result });
});
