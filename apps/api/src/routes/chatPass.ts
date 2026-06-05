/**
 * 陪聊付费服务路由
 *
 * POST /chat-pass/:therapistUserId/session   买陪聊时段(扣积分+分成+建 session 倒计时)
 * GET  /chat-pass/:therapistUserId/active     查进行中时段(倒计时 UI)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { startChatSession, getActiveSession, type ChatPassContext } from '../services/chatPass';

function cctx(): ChatPassContext {
  return { db: getDb() };
}

export const chatPassRoutes = new Hono();
chatPassRoutes.use('*', requireAuth);

const SessionBody = z.object({
  duration_minutes: z.number().int(),
  idempotency_key: z.string().min(8).max(128).optional(),
});

chatPassRoutes.post('/:therapistUserId/session', zValidator('json', SessionBody), async (c) => {
  const therapistUserId = c.req.param('therapistUserId');
  const body = c.req.valid('json');
  const res = await startChatSession(cctx(), {
    customerId: c.get('userId') as string,
    therapistUserId,
    durationMinutes: body.duration_minutes,
    idempotencyKey: body.idempotency_key,
  });
  return c.json({ data: res });
});

chatPassRoutes.get('/:therapistUserId/active', async (c) => {
  const therapistUserId = c.req.param('therapistUserId');
  const res = await getActiveSession(cctx(), {
    customerId: c.get('userId') as string,
    therapistUserId,
  });
  return c.json({ data: res }); // { expireAt } | null
});
