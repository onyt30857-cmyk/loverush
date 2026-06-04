/**
 * M18 撩拨发图 · Phase 2b · 付费私密图解锁路由
 *
 * POST /companion-media/:mediaId/unlock   {conversation_id}  解锁一张 paid 私密图（扣费+分成+发图+幂等）
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { unlockChatMedia, type ChatMediaUnlockContext } from '../services/chatMediaUnlock';

function cctx(): ChatMediaUnlockContext {
  return { db: getDb() };
}

export const companionMediaRoutes = new Hono();
companionMediaRoutes.use('*', requireAuth);

const UnlockBody = z.object({
  conversation_id: z.string().uuid(),
});

companionMediaRoutes.post(
  '/:mediaId/unlock',
  zValidator('json', UnlockBody),
  async (c) => {
    const mediaId = c.req.param('mediaId');
    const body = c.req.valid('json');
    const res = await unlockChatMedia(cctx(), {
      customerId: c.get('userId'),
      mediaId,
      conversationId: body.conversation_id,
    });
    return c.json({ data: res });
  },
);
