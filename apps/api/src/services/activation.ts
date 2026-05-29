/**
 * 账户激活服务 · 无效账户治理
 *
 * 用户首次产生真实业务活动时 set users.activated_at = NOW()。
 * 触发时机:
 *   - 首次 /assistant/chat(M03)
 *   - 首次开 conversation(私聊)
 *   - 首次下单
 *
 * 设计:
 *   - SQL 用 WHERE activated_at IS NULL 兜底,所以多次调用幂等(只写一次)
 *   - fire-and-forget,失败不阻塞业务主链路
 *   - 不在 register 时调用(就是要让"只注册不用"的账户留 NULL)
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { users } from '@loverush/db';
import { eq, and, isNull } from 'drizzle-orm';
import { fireAndForget } from './logger';

/**
 * 标记账户已激活(首次业务活动)
 * - 只在 activated_at IS NULL 时才 update,幂等
 * - 同时 set last_active_at = NOW()
 */
export async function markActivated(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({
      activatedAt: sql`COALESCE(${users.activatedAt}, NOW())`,
      lastActiveAt: new Date(),
    })
    .where(and(eq(users.id, userId), isNull(users.activatedAt)));
}

/**
 * fire-and-forget 包装:业务主链路调用,失败仅记 warn,不影响主流程
 */
export function markActivatedAsync(db: Database, userId: string): void {
  fireAndForget(markActivated(db, userId), 'activation.mark_failed', { userId });
}
