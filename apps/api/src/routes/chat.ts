/**
 * 私聊路由 · M05
 *
 * POST   /conversations                       开会话（首次接触）
 * GET    /conversations                       我的会话列表
 * GET    /conversations/:id/messages          消息分页
 * POST   /conversations/:id/messages          发消息
 * POST   /conversations/:id/read              标记已读
 * POST   /translate                           独立翻译（不入消息表）
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import {
  listMessages,
  listMyConversations,
  markMessagesRead,
  openConversation,
  sendMessage,
  type ChatContext,
} from '../services/chat';
import { translate, type TranslateContext } from '../services/translate';

function cctx(): ChatContext {
  return { db: getDb() };
}
function tctx(): TranslateContext {
  return { db: getDb() };
}

const OpenBody = z.object({ therapist_user_id: z.string().uuid() });

const SendBody = z.object({
  text: z.string().min(1).max(4000), // 加密 blob 比明文长
  source_language: z.enum(['zh', 'en', 'th', 'vi', 'ms', 'id']).optional(),
  type: z.enum(['text', 'image', 'voice']).optional(),
  media_ref: z.string().uuid().optional(),
  is_encrypted: z.boolean().optional(),
});

const TranslateBody = z.object({
  text: z.string().min(1).max(2000),
  src_lang: z.enum(['zh', 'en', 'th', 'vi', 'ms', 'id']),
  tgt_lang: z.enum(['zh', 'en', 'th', 'vi', 'ms', 'id']),
});

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before_id: z.string().uuid().optional(),
});

export const chatRoutes = new Hono();
chatRoutes.use('*', requireAuth);

chatRoutes.post('/', zValidator('json', OpenBody), async (c) => {
  const body = c.req.valid('json');
  const conv = await openConversation(cctx(), {
    customerId: c.get('userId'),
    therapistUserId: body.therapist_user_id,
  });
  return c.json({ data: conv });
});

chatRoutes.get('/', async (c) => {
  const list = await listMyConversations(cctx(), c.get('userId'));
  return c.json({ data: list });
});

chatRoutes.get('/:id/messages', zValidator('query', ListQuery), async (c) => {
  const q = c.req.valid('query');
  const list = await listMessages(cctx(), {
    conversationId: c.req.param('id'),
    viewerUserId: c.get('userId'),
    limit: q.limit,
    beforeId: q.before_id,
  });
  return c.json({ data: list });
});

chatRoutes.post('/:id/messages', zValidator('json', SendBody), async (c) => {
  const body = c.req.valid('json');
  const msg = await sendMessage(cctx(), {
    conversationId: c.req.param('id'),
    senderUserId: c.get('userId'),
    text: body.text,
    sourceLanguage: body.source_language,
    type: body.type,
    mediaRef: body.media_ref,
    isEncrypted: body.is_encrypted,
  });
  return c.json({ data: msg });
});

chatRoutes.post('/:id/read', async (c) => {
  await markMessagesRead(cctx(), {
    conversationId: c.req.param('id'),
    viewerUserId: c.get('userId'),
  });
  return c.json({ data: { ok: true } });
});

// 独立翻译接口
export const translateRoutes = new Hono();
translateRoutes.use('*', requireAuth);

translateRoutes.post('/', zValidator('json', TranslateBody), async (c) => {
  const body = c.req.valid('json');
  const result = await translate(tctx(), {
    text: body.text,
    srcLang: body.src_lang,
    tgtLang: body.tgt_lang,
    userId: c.get('userId'),
  });
  return c.json({ data: result });
});
