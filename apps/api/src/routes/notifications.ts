/**
 * 通知路由 · M13
 *
 * GET    /notifications                      列表
 * POST   /notifications/read                 批量标已读
 * POST   /notifications/read-all             全部标已读
 * GET    /notifications/preferences          推送偏好
 * PUT    /notifications/preferences          更新推送偏好
 * POST   /notifications/web-push/subscribe   Web Push 订阅
 * POST   /notifications/web-push/unsubscribe
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { userPushPreferences } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import {
  listForUser,
  markAllRead,
  markRead,
  subscribeWebPush,
  unsubscribeWebPush,
  updatePreferences,
  type NotifyContext,
} from '../services/notifications';

function nctx(): NotifyContext {
  return { db: getDb() };
}

const ListQuery = z.object({
  unread_only: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const ReadBody = z.object({ notification_ids: z.array(z.string().uuid()).max(200) });

const PrefBody = z.object({
  chat_msg_enabled: z.boolean().optional(),
  order_status_enabled: z.boolean().optional(),
  dispatch_offer_enabled: z.boolean().optional(),
  review_enabled: z.boolean().optional(),
  withdraw_enabled: z.boolean().optional(),
  promo_enabled: z.boolean().optional(),
  quiet_hours_start: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quiet_hours_end: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  obfuscate_previews: z.boolean().optional(),
});

const SubscribeBody = z.object({
  endpoint: z.string().url(),
  p256dh_key: z.string().min(1),
  auth_key: z.string().min(1),
  user_agent: z.string().max(500).optional(),
});

const UnsubscribeBody = z.object({ endpoint: z.string().url() });

export const notificationRoutes = new Hono();
notificationRoutes.use('*', requireAuth);

notificationRoutes.get('/', zValidator('query', ListQuery), async (c) => {
  const q = c.req.valid('query');
  const list = await listForUser(nctx(), {
    userId: c.get('userId') as string,
    unreadOnly: q.unread_only,
    limit: q.limit,
    offset: q.offset,
  });
  return c.json({ data: list });
});

notificationRoutes.post('/read', zValidator('json', ReadBody), async (c) => {
  const body = c.req.valid('json');
  const updated = await markRead(nctx(), {
    userId: c.get('userId') as string,
    notificationIds: body.notification_ids,
  });
  return c.json({ data: { updated } });
});

notificationRoutes.post('/read-all', async (c) => {
  const updated = await markAllRead(nctx(), c.get('userId') as string);
  return c.json({ data: { updated } });
});

notificationRoutes.get('/preferences', async (c) => {
  const row = await getDb().query.userPushPreferences.findFirst({
    where: eq(userPushPreferences.userId, c.get('userId') as string),
  });
  return c.json({ data: row });
});

notificationRoutes.put('/preferences', zValidator('json', PrefBody), async (c) => {
  const body = c.req.valid('json');
  const row = await updatePreferences(nctx(), {
    userId: c.get('userId') as string,
    patch: {
      chatMsgEnabled: body.chat_msg_enabled,
      orderStatusEnabled: body.order_status_enabled,
      dispatchOfferEnabled: body.dispatch_offer_enabled,
      reviewEnabled: body.review_enabled,
      withdrawEnabled: body.withdraw_enabled,
      promoEnabled: body.promo_enabled,
      quietHoursStart: body.quiet_hours_start,
      quietHoursEnd: body.quiet_hours_end,
      obfuscatePreviews: body.obfuscate_previews,
    },
  });
  return c.json({ data: row });
});

notificationRoutes.post('/web-push/subscribe', zValidator('json', SubscribeBody), async (c) => {
  const body = c.req.valid('json');
  await subscribeWebPush(nctx(), {
    userId: c.get('userId') as string,
    endpoint: body.endpoint,
    p256dhKey: body.p256dh_key,
    authKey: body.auth_key,
    userAgent: body.user_agent,
  });
  return c.json({ data: { ok: true } });
});

notificationRoutes.post('/web-push/unsubscribe', zValidator('json', UnsubscribeBody), async (c) => {
  const body = c.req.valid('json');
  await unsubscribeWebPush(nctx(), { userId: c.get('userId') as string, endpoint: body.endpoint });
  return c.json({ data: { ok: true } });
});
