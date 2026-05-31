/**
 * Job · 技师分身「服务后关怀」· 每 6h 扫一次（M06 F06.10）
 *
 * 流程：
 *   1. 扫 orders：status=COMPLETED、完成 12~48h 前（次日窗口，不当场打扰）、
 *      技师 ai_alter_enabled=1、未拉黑，且"完成后还没主动关怀过"
 *      （crp.last_proactive_at < o.completed_at，复用频率帽时间戳，无需新列）
 *   2. proactiveReachOut(aftercare)：关心 ta 服务后的身体感受，零推销
 *      —— 不提"下次再来"/约钟/优惠（system prompt 已硬约束零推销）
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { proactiveReachOut } from '../services/ai_alter';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

interface AftercareRow {
  customer_id: string;
  therapist_user_id: string;
}

export async function runAlterAftercare(ctx: JobContext): Promise<{ candidates: number; sent: number }> {
  const rows = (await ctx.db.execute(sql`
    SELECT o.customer_id, o.therapist_user_id
    FROM orders o
    JOIN therapists t ON t.id = o.therapist_id
    LEFT JOIN customer_relationship_profile crp
      ON crp.customer_id = o.customer_id AND crp.therapist_id = o.therapist_id
    WHERE o.status = 'COMPLETED'
      AND o.completed_at IS NOT NULL
      AND o.completed_at < NOW() - INTERVAL '12 hours'
      AND o.completed_at > NOW() - INTERVAL '48 hours'
      AND t.ai_alter_enabled = 1
      AND (crp.is_blocked IS NULL OR crp.is_blocked = 0)
      AND (crp.last_proactive_at IS NULL OR crp.last_proactive_at < o.completed_at)
    LIMIT 200
  `)) as unknown as AftercareRow[];

  let sent = 0;
  for (const r of rows) {
    try {
      const res = await proactiveReachOut(
        { db: ctx.db },
        {
          customerId: r.customer_id,
          therapistUserId: r.therapist_user_id,
          scenario: 'aftercare',
          situationPrompt:
            `（内部触发·不是客户发来的消息）这位客户大约一天前刚找你做过一次。以你本人的身份，主动发一条` +
            `关心 ta 服务后身体感受的话——问问那次之后有没有舒服点、哪里还酸不酸，像真在意 ta 身体那样。` +
            `绝对不要提下次再来/约钟/优惠/任何推销，就是纯粹关心 ta 这次之后的感受。可以结合你记得的 ta 的情况` +
            `（比如肩颈）。直接输出你要发的那一两句话。`,
        },
      );
      if (res.sent) sent++;
    } catch (err) {
      logger.warn('ai_alter.aftercare.user_failed', { customerId: r.customer_id, err: String(err) });
    }
  }
  logger.info('ai_alter.aftercare.done', { candidates: rows.length, sent });
  return { candidates: rows.length, sent };
}

let timer: NodeJS.Timeout | null = null;
export function startAlterAftercareCron(ctx: JobContext, intervalMs = 6 * 3600 * 1000): void {
  if (timer) return;
  timer = setInterval(() => {
    runAlterAftercare(ctx).catch((err) => {
      logger.error('ai_alter.aftercare.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}
export function stopAlterAftercareCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
