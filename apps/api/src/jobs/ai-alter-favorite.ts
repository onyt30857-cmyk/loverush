/**
 * Job · 技师分身「收藏破冰」· 每 6h 扫一次（M06 F06.8）
 *
 * 流程：
 *   1. 扫 favorites：收藏 1~24h 前（给点延迟，不在收藏瞬间扑上去显得在盯着）、
 *      技师 ai_alter_enabled=1、未拉黑，且是"纯新客"——还没下过单、也没被主动联系过
 *      （crp 不存在 OR last_proactive_at/last_order_at 皆空）。老客收藏走唤回/关怀，不破冰。
 *   2. proactiveReachOut(favorite_greeting)：轻松打个招呼、谢谢关注，零推销、不黏人、给空间
 *      —— 破冰对象是没聊过的陌生客，绝不能装熟（system prompt 无档案时会当初识处理）
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { proactiveReachOut } from '../services/ai_alter';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

interface FavoriteRow {
  customer_id: string;
  therapist_user_id: string;
}

export async function runAlterFavorite(ctx: JobContext): Promise<{ candidates: number; sent: number }> {
  const rows = (await ctx.db.execute(sql`
    SELECT f.customer_id, t.user_id AS therapist_user_id
    FROM favorites f
    JOIN therapists t ON t.id = f.therapist_id
    LEFT JOIN customer_relationship_profile crp
      ON crp.customer_id = f.customer_id AND crp.therapist_id = f.therapist_id
    WHERE f.created_at < NOW() - INTERVAL '1 hour'
      AND f.created_at > NOW() - INTERVAL '24 hours'
      AND t.ai_alter_enabled = 1
      AND (crp.is_blocked IS NULL OR crp.is_blocked = 0)
      AND (crp.customer_id IS NULL OR (crp.last_proactive_at IS NULL AND crp.last_order_at IS NULL))
    LIMIT 200
  `)) as unknown as FavoriteRow[];

  let sent = 0;
  for (const r of rows) {
    try {
      const res = await proactiveReachOut(
        { db: ctx.db },
        {
          customerId: r.customer_id,
          therapistUserId: r.therapist_user_id,
          scenario: 'favorite_greeting',
          situationPrompt:
            `（内部触发·不是客户发来的消息）这位客户刚收藏了你，但你们还没聊过。以你本人的身份，主动发一句` +
            `轻松自然的话——被人留意到、有点开心地打个招呼，谢谢 ta 的关注。要轻、别太正式、别黏人、给 ta 空间，` +
            `绝对不要推销/不要催 ta 来/不要提价格。可以随口问一句 ta 最近怎么样、或怎么看到你的。直接输出那一两句话。`,
        },
      );
      if (res.sent) sent++;
    } catch (err) {
      logger.warn('ai_alter.favorite.user_failed', { customerId: r.customer_id, err: String(err) });
    }
  }
  logger.info('ai_alter.favorite.done', { candidates: rows.length, sent });
  return { candidates: rows.length, sent };
}

let timer: NodeJS.Timeout | null = null;
export function startAlterFavoriteCron(ctx: JobContext, intervalMs = 6 * 3600 * 1000): void {
  if (timer) return;
  timer = setInterval(() => {
    runAlterFavorite(ctx).catch((err) => {
      logger.error('ai_alter.favorite.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}
export function stopAlterFavoriteCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
