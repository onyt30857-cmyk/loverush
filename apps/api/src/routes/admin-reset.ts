/**
 * 一次性 admin 操作 · 重置所有客户和技师账户
 *
 * POST /admin/_internal/reset-all-accounts
 *   body: { confirm: 'I_KNOW_I_WILL_DELETE_ALL_DATA' }
 *
 * 删除:所有 user_type ∈ {'customer', 'therapist'} 的账户 + 关联数据
 * 保留:有 admin/cs/auditor/finance/ops 角色的账户(后台管理员)
 *
 * ⚠️ 不可撤销 · 调用前必须确认
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { recordAudit } from '../services/audit';

const Body = z.object({
  confirm: z.literal('I_KNOW_I_WILL_DELETE_ALL_DATA'),
  reset_invite_codes: z.boolean().optional(),
});

export const adminResetRoutes = new Hono();
adminResetRoutes.use('*', requireAuth, requireRole(['admin']));

adminResetRoutes.post('/reset-all-accounts', zValidator('json', Body), async (c) => {
  const body = c.req.valid('json');
  const db = getDb();

  // 1. 算预删除数量(用于返回 + audit)
  const beforeRow = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE user_type IN ('customer', 'therapist'))::int AS total_cu_th,
      count(*) FILTER (WHERE user_type IN ('customer', 'therapist')
                        AND EXISTS (SELECT 1 FROM user_roles ur
                                    WHERE ur.user_id = users.id
                                      AND ur.revoked_at IS NULL))::int AS keep_with_roles
    FROM users
  `);
  const beforeData = (beforeRow as { rows?: Array<{ total_cu_th: number; keep_with_roles: number }> }).rows?.[0]
    ?? (beforeRow as unknown as { total_cu_th: number; keep_with_roles: number }[])[0]
    ?? { total_cu_th: 0, keep_with_roles: 0 };
  const willDelete = beforeData.total_cu_th - beforeData.keep_with_roles;

  if (willDelete === 0) {
    return c.json({ data: { deleted: 0, kept_with_roles: beforeData.keep_with_roles, message: '没有需要清理的账户' } });
  }

  // 2. 执行清理(顺序敏感 · 先清 RESTRICT 表)
  try {
    // points_transaction(RESTRICT)
    await db.execute(sql`
      DELETE FROM points_transaction WHERE user_id IN (
        SELECT id FROM users WHERE user_type IN ('customer', 'therapist')
          AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.revoked_at IS NULL)
      )
    `);
    // orders(RESTRICT)
    await db.execute(sql`
      DELETE FROM orders WHERE customer_id IN (
        SELECT id FROM users WHERE user_type IN ('customer', 'therapist')
          AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.revoked_at IS NULL)
      ) OR therapist_user_id IN (
        SELECT id FROM users WHERE user_type IN ('customer', 'therapist')
          AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.revoked_at IS NULL)
      )
    `);
    // withdrawals(RESTRICT)
    await db.execute(sql`
      DELETE FROM withdrawals WHERE therapist_user_id IN (
        SELECT id FROM users WHERE user_type IN ('customer', 'therapist')
          AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.revoked_at IS NULL)
      )
    `);
    // tips(SET NULL 关联 orders 已删,这里清自身)
    await db.execute(sql`
      DELETE FROM tips WHERE customer_id IN (
        SELECT id FROM users WHERE user_type IN ('customer', 'therapist')
          AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.revoked_at IS NULL)
      )
    `);
    // 真删 users(CASCADE 自动清剩下的)
    await db.execute(sql`
      DELETE FROM users
       WHERE user_type IN ('customer', 'therapist')
         AND NOT EXISTS (
           SELECT 1 FROM user_roles ur WHERE ur.user_id = users.id AND ur.revoked_at IS NULL
         )
    `);
    // 可选 · 重置 invite_codes.used_count
    if (body.reset_invite_codes) {
      await db.execute(sql`UPDATE invite_codes SET used_count = 0 WHERE disabled_at IS NULL`);
    }
  } catch (e) {
    throw HttpError.internal(`reset failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. 算清理后剩余数
  const afterRow = await db.execute(sql`SELECT count(*)::int AS remaining FROM users`);
  const remaining = (afterRow as { rows?: Array<{ remaining: number }> }).rows?.[0]?.remaining
    ?? (afterRow as unknown as { remaining: number }[])[0]?.remaining
    ?? 0;

  // 4. audit
  await recordAudit({ db }, c, {
    action: 'system.reset_all_accounts',
    targetType: 'system',
    targetId: null,
    before: { total_cu_th: beforeData.total_cu_th, with_roles: beforeData.keep_with_roles },
    after: { deleted: willDelete, remaining_total_users: remaining },
    reason: '产品从 mnemonic 切换到账号密码模式 · 清旧账户',
  });

  return c.json({
    data: {
      deleted: willDelete,
      kept_with_roles: beforeData.keep_with_roles,
      remaining_total_users: remaining,
      invite_codes_reset: body.reset_invite_codes ?? false,
    },
  });
});
