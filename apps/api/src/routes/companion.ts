/**
 * M18 心动陪伴路由
 *
 * POST   /companion/:therapistUserId/action      发起亲密动作（计费+分成+亲密度）
 * GET    /companion/:therapistUserId/intimacy     查我对该技师的亲密度
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import {
  triggerCompanionAction,
  getIntimacy,
  type CompanionContext,
} from '../services/companion';

function cctx(): CompanionContext {
  return { db: getDb() };
}

export const companionRoutes = new Hono();
companionRoutes.use('*', requireAuth);

const ActionBody = z.object({
  action_code: z.string().min(1).max(64),
  // 客户端每次发起生成一个 token(crypto.randomUUID)→ 同次 retry 复用 → 后端幂等不重复扣款
  idempotency_key: z.string().min(8).max(128).optional(),
  // 当前会话 id · voice_whisper 语音入库(刷新可恢复)需要
  conversation_id: z.string().uuid().optional(),
});

companionRoutes.post(
  '/:therapistUserId/action',
  zValidator('json', ActionBody),
  async (c) => {
    const therapistUserId = c.req.param('therapistUserId');
    const body = c.req.valid('json');
    const res = await triggerCompanionAction(cctx(), {
      customerId: c.get('userId'),
      therapistUserId,
      actionCode: body.action_code,
      idempotencyKey: body.idempotency_key,
      conversationId: body.conversation_id,
    });
    return c.json({ data: res });
  },
);

companionRoutes.get('/:therapistUserId/intimacy', async (c) => {
  const therapistUserId = c.req.param('therapistUserId');
  const res = await getIntimacy(cctx(), {
    customerId: c.get('userId'),
    therapistUserId,
  });
  // voiceCloneReady=技师传了语音样本(可发"她的声音") · 前端据此决定是否展示 voice_whisper 动作
  const { getVoiceCloneStatus } = await import('../services/voice');
  const voice = await getVoiceCloneStatus(cctx(), therapistUserId).catch(() => null);
  return c.json({ data: { ...res, voiceCloneReady: voice?.hasSample ?? false } });
});
