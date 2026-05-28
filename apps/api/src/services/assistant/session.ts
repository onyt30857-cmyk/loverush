/**
 * 会话生命周期 · M03
 *
 * - start(userId, sessionToken):写一条 customer_session_preferences,初始化 state
 * - finalize(userId, sessionToken):
 *     1. 拉 session 内的对话(client 端管理 turns,后端只看 session 最终状态)
 *     2. extractAndPersist 把整段对话的偏好归档到 L3
 *     3. 设置 expires_at = now()
 */

import { and, eq } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  customerSessionPreferences,
} from '@loverush/db';
import type { LLMGateway } from '@loverush/llm';
import { extractAndPersist } from './extractor';

export interface SessionContext {
  db: Database;
}

const SESSION_TTL_MS = 6 * 3600 * 1000; // 6 小时

export async function start(
  ctx: SessionContext,
  args: { userId: string; sessionToken: string },
): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  // 已存在则刷新 expires_at
  const existing = await ctx.db.query.customerSessionPreferences.findFirst({
    where: and(
      eq(customerSessionPreferences.userId, args.userId),
      eq(customerSessionPreferences.sessionToken, args.sessionToken),
    ),
  });
  if (existing) {
    await ctx.db
      .update(customerSessionPreferences)
      .set({ expiresAt, updatedAt: new Date() })
      .where(eq(customerSessionPreferences.id, existing.id));
    return;
  }
  await ctx.db.insert(customerSessionPreferences).values({
    userId: args.userId,
    sessionToken: args.sessionToken,
    currentIntent: 'browse',
    expiresAt,
  });
}

export async function finalize(
  ctx: SessionContext,
  gateway: LLMGateway,
  args: {
    userId: string;
    sessionToken: string;
    /** 客户最后一段对话(选填 · 用于偏好归档) */
    finalSummary?: string;
  },
): Promise<{ archived: boolean }> {
  const row = await ctx.db.query.customerSessionPreferences.findFirst({
    where: and(
      eq(customerSessionPreferences.userId, args.userId),
      eq(customerSessionPreferences.sessionToken, args.sessionToken),
    ),
  });
  if (!row) return { archived: false };

  // 归档偏好(如果有 final summary)
  if (args.finalSummary) {
    await extractAndPersist(
      { db: ctx.db },
      gateway,
      {
        userId: args.userId,
        text: args.finalSummary,
        intent: 'rotating',
        awaitLLM: true,
      },
    );
  }

  // 设置过期
  await ctx.db
    .update(customerSessionPreferences)
    .set({ expiresAt: new Date(), updatedAt: new Date() })
    .where(eq(customerSessionPreferences.id, row.id));

  return { archived: true };
}
