/**
 * AI 分身配置路由 · M06
 *
 * POST   /therapists/me/ai-alter/configure    启用/禁用 + personality
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { configureAiAlter, type AiAlterContext } from '../services/ai_alter';

function actx(): AiAlterContext {
  return { db: getDb() };
}

const ConfigureBody = z.object({
  enabled: z.boolean(),
  personality: z
    .object({
      tone: z.string().max(20).optional(),
      warmth: z.number().int().min(0).max(100).optional(),
      proactivity: z.number().int().min(0).max(100).optional(),
      humor: z.number().int().min(0).max(100).optional(),
      // 对话式人设(自由文本 + 样本 + 称呼)· 长度上限对齐 token 预算
      selfDescription: z.string().max(1500).optional(),
      speechSample: z.string().max(800).optional(),
      nicknameForCustomer: z.string().max(20).optional(),
    })
    .optional(),
});

export const aiAlterRoutes = new Hono();
aiAlterRoutes.use('*', requireAuth);

aiAlterRoutes.post('/configure', zValidator('json', ConfigureBody), async (c) => {
  const body = c.req.valid('json');
  await configureAiAlter(actx(), {
    therapistUserId: c.get('userId'),
    enabled: body.enabled,
    personality: body.personality,
  });
  return c.json({ data: { ok: true } });
});

/**
 * 技师自己看今日 AI 分身代发统计 · 给私聊列表 banner 用
 * 不暴露 cost USD(技师不应该看运营成本) · 转换成"帮你接了 N 个客户"语言
 */
aiAlterRoutes.get('/today', async (c) => {
  const userId = c.get('userId') as string;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // 今日代发条数 + 涉及对话数
  const rows = (await getDb().execute(sql`
    SELECT
      COUNT(*)::int AS message_count,
      COUNT(DISTINCT m.conversation_id)::int AS conversation_count
    FROM ai_alter_messages a
    JOIN messages m ON m.id = a.message_id
    WHERE a.therapist_user_id = ${userId}::uuid
      AND a.created_at >= ${todayStart.toISOString()}::timestamptz
  `)) as unknown as Array<{ message_count: number; conversation_count: number }>;

  // 当前 AI 启用状态
  const therapist = (await getDb().execute(sql`
    SELECT ai_alter_enabled, ai_kill_switch_reason
    FROM therapists
    WHERE user_id = ${userId}::uuid
    LIMIT 1
  `)) as unknown as Array<{ ai_alter_enabled: number; ai_kill_switch_reason: string | null }>;

  return c.json({
    data: {
      enabled: (therapist[0]?.ai_alter_enabled ?? 0) === 1,
      kill_switch_reason: therapist[0]?.ai_kill_switch_reason ?? null,
      today_message_count: rows[0]?.message_count ?? 0,
      today_conversation_count: rows[0]?.conversation_count ?? 0,
    },
  });
});
