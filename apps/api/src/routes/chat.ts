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
import { eq } from 'drizzle-orm';
import { conversations } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import {
  hideConversation,
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
  // bug 修(2026-06-01): 前端拿不到 src_lang(消息 contentLanguage 可能空),
  // 强制必填让所有翻译请求 0ms 400 reject(zValidator 在 LLM 之前) ·
  // 前端 silent catch 吞错 → 用户看"翻译不工作"
  // 改 optional · endpoint 内 fallback 'auto' · LLM 自检测
  src_lang: z.enum(['zh', 'en', 'th', 'vi', 'ms', 'id']).optional(),
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

// 技师手动发"可约时段"卡(B2)· 仅本会话技师可发;今明全满返回 sent:false 让前端提示
chatRoutes.post('/:id/schedule-offer', async (c) => {
  const conversationId = c.req.param('id');
  const userId = c.get('userId');
  const conv = await getDb().query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
  if (!conv) return c.json({ error: { code: 'E0003', message: 'conversation not found' } }, 404);
  if (conv.therapistUserId !== userId) {
    return c.json({ error: { code: 'E0001', message: '仅技师可发可约时段' } }, 403);
  }
  const { sendScheduleOfferManual } = await import('../services/scheduleOffer');
  const r = await sendScheduleOfferManual(cctx(), { conversationId, therapistUserId: userId });
  return c.json({ data: r });
});

// per-user 软删会话 (参照微信 · 我删了对方不知道 · 对方发新消息自动 unhide)
chatRoutes.delete('/:id', async (c) => {
  await hideConversation(cctx(), {
    conversationId: c.req.param('id'),
    userId: c.get('userId'),
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
    // 缺 src_lang 时传 'auto' · LLM prompt 内"from auto to {tgt}"会自检测原语言
    // 代价: cache key 跟显式 src_lang 不同 · 跨用户 cache hit 率略低 · 可接受
    srcLang: body.src_lang ?? 'auto',
    tgtLang: body.tgt_lang,
    userId: c.get('userId'),
  });
  return c.json({ data: result });
});
