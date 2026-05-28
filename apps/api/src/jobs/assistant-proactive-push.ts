/**
 * Job · 主动 push · 每小时扫一次
 *
 * 流程:
 *   1. 扫 S5+ 客户(behavior_profile.total_orders >= 6 + outreach.proactive_enabled=true)
 *   2. 三命中规则检测(checkPushTriggers)
 *   3. weekly cap ≤ 2 检查
 *   4. 生成话术 + enqueue notification
 *   5. recordPushSent 计数
 *
 * 候选可用性:这里简化为"该 user 关注的某技师 onlineStatus='online'"
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import {
  canSendPush,
  checkPushTriggers,
  generatePushMessage,
  recordPushSent,
} from '../services/assistant/outreach';
import { enqueue } from '../services/notifications';
import { getGateway } from '../services/assistant/chat';
import { logger } from '../services/logger';
import { readReference } from '../services/assistant/memory';

export interface JobContext {
  db: Database;
}

export async function runProactivePush(ctx: JobContext): Promise<{
  candidates: number;
  triggered: number;
  sent: number;
}> {
  const rows = (await ctx.db.execute(sql`
    SELECT o.user_id
    FROM customer_outreach_state o
    JOIN customer_behavior_profile b ON b.user_id = o.user_id
    WHERE o.proactive_enabled = true
      AND b.total_orders >= 6
      AND (o.last_push_at IS NULL OR o.last_push_at < NOW() - INTERVAL '1 day')
    LIMIT 500
  `)) as unknown as Array<{ user_id: string }>;

  let triggered = 0;
  let sent = 0;

  for (const r of rows) {
    try {
      // 看是否有 L4 relation 关联的 therapist online
      const relations = await readReference(ctx, r.user_id, 'relation', 5);
      const tIds = relations.map((rel) => rel.refTherapistId).filter((x): x is string => !!x);
      let candidateAvailable = false;
      let candidateNames: string[] = [];
      if (tIds.length > 0) {
        const therapists = (await ctx.db.execute(sql`
          SELECT id, COALESCE(bio, '') as bio, online_status
          FROM therapists
          WHERE id = ANY(${tIds}::uuid[])
            AND online_status = 'online'
          LIMIT 5
        `)) as unknown as Array<{ id: string; bio: string; online_status: string }>;
        candidateAvailable = therapists.length > 0;
        candidateNames = therapists.map((t) => t.bio.slice(0, 12) || 'Anonymous');
      }

      const hit = await checkPushTriggers(ctx, r.user_id, candidateAvailable);
      if (!hit.hit || !hit.regularSlot) continue;
      triggered++;

      const gate = await canSendPush(ctx, r.user_id);
      if (!gate.ok) continue;

      const msg = await generatePushMessage(getGateway(), {
        userId: r.user_id,
        slot: hit.regularSlot,
        candidateNames: candidateNames.length ? candidateNames : ['你的固定技师'],
      });
      if (!msg) continue;

      await enqueue(
        { db: ctx.db },
        {
          recipientUserId: r.user_id,
          category: 'promo',
          level: 'info',
          title: '小助理',
          body: msg,
          deepLink: '/assistant',
        },
      );
      await recordPushSent(ctx, r.user_id);
      sent++;
    } catch (err) {
      logger.warn('assistant.proactive_push.user_failed', {
        userId: r.user_id,
        err: String(err),
      });
    }
  }
  logger.info('assistant.proactive_push.done', {
    candidates: rows.length,
    triggered,
    sent,
  });
  return { candidates: rows.length, triggered, sent };
}

let timer: NodeJS.Timeout | null = null;
export function startProactivePushCron(ctx: JobContext, intervalMs = 3600 * 1000): void {
  if (timer) return;
  timer = setInterval(() => {
    runProactivePush(ctx).catch((err) => {
      logger.error('assistant.proactive_push.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}
export function stopProactivePushCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
