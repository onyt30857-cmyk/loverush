/**
 * Job · 跨次比对(L5 diff)
 *
 * 触发:订单创建 hook(预约前 5 分钟)+ 手动触发
 * 行为:对单客户跑 diff.ts
 *
 * 备注:不挂 setInterval(扫全表) · 而是由 orders.ts 在 createOrder 时
 * fireAndForget 调 runDiffForOrder。
 */

import type { Database } from '@loverush/db';
import { diffForUser } from '../services/assistant/diff';
import { getGateway } from '../services/assistant/chat';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

export async function runDiffForUser(
  ctx: JobContext,
  userId: string,
): Promise<{ written: number }> {
  try {
    const written = await diffForUser(ctx, getGateway(), { userId });
    logger.info('assistant.diff.done', { userId, written });
    return { written };
  } catch (err) {
    logger.warn('assistant.diff.failed', { userId, err: String(err) });
    return { written: 0 };
  }
}
