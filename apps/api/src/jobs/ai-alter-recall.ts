/**
 * Job · 技师分身「老客唤回」· 每日扫一次（M06 F06.11）
 *
 * 触发：setInterval 24h（进程启动也跑一次）
 * 流程：
 *   1. 扫 customer_relationship_profile：技师 ai_alter_enabled=1、未拉黑
 *      L2 静默 14d / L3 静默 21d（M06 文档阈值）
 *      频率帽：last_proactive_at 14 天内有过 → 跳过（调研铁律：低频，高频=骚扰）
 *   2. proactiveReachOut(scenario=recall_*) 以技师身份发真实私聊（零标识）
 *      —— 零推销 + 同理心：惦记 ta、关心近况，绝不催来/提价格（system prompt 已硬约束）
 *
 * 注：只唤回"有过订单"的真老客（last_order_at 非空）；陌生客户不在此列。
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { proactiveReachOut } from '../services/ai_alter';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

interface RecallRow {
  customer_id: string;
  therapist_user_id: string;
  tier: string;
  days_since: number;
}

export async function runAlterRecall(ctx: JobContext): Promise<{ candidates: number; sent: number }> {
  const rows = (await ctx.db.execute(sql`
    SELECT crp.customer_id,
           t.user_id AS therapist_user_id,
           crp.tier,
           EXTRACT(DAY FROM NOW() - crp.last_order_at)::int AS days_since
    FROM customer_relationship_profile crp
    JOIN therapists t ON t.id = crp.therapist_id
    WHERE t.ai_alter_enabled = 1
      AND crp.is_blocked = 0
      AND crp.last_order_at IS NOT NULL
      AND (
        (crp.tier = 'L2' AND crp.last_order_at < NOW() - INTERVAL '14 days') OR
        (crp.tier = 'L3' AND crp.last_order_at < NOW() - INTERVAL '21 days')
      )
      AND (crp.last_proactive_at IS NULL OR crp.last_proactive_at < NOW() - INTERVAL '14 days')
    LIMIT 200
  `)) as unknown as RecallRow[];

  let sent = 0;
  for (const r of rows) {
    try {
      const days = r.days_since ?? 0;
      const res = await proactiveReachOut(
        { db: ctx.db },
        {
          customerId: r.customer_id,
          therapistUserId: r.therapist_user_id,
          scenario: `recall_${(r.tier ?? 'l2').toLowerCase()}`,
          situationPrompt:
            `（内部触发·不是客户发来的消息）这位老客已经 ${days} 天没来找你了。以你本人的身份，` +
            `主动发一条惦记 ta 的话，自然地开启对话——单纯想起 ta、关心 ta 最近怎么样，可以结合你记得的` +
            `关于 ta 的事。绝对不要催 ta 来、不要提约钟/价格/优惠/"再来找我"，就是纯粹的惦记和关心。` +
            `直接输出你要发的那一两句话。`,
        },
      );
      if (res.sent) sent++;
    } catch (err) {
      logger.warn('ai_alter.recall.user_failed', { customerId: r.customer_id, err: String(err) });
    }
  }
  logger.info('ai_alter.recall.done', { candidates: rows.length, sent });
  return { candidates: rows.length, sent };
}

let timer: NodeJS.Timeout | null = null;
export function startAlterRecallCron(ctx: JobContext, intervalMs = 24 * 3600 * 1000): void {
  if (timer) return;
  timer = setInterval(() => {
    runAlterRecall(ctx).catch((err) => {
      logger.error('ai_alter.recall.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}
export function stopAlterRecallCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
