/**
 * Webhook 路由 · D-101
 *
 * POST /webhooks/stripe
 *   - 不走 auth 中间件
 *   - 用 stripe-signature header 校验
 *   - rawBody 用 c.req.raw.text()（Hono 不会强制 parse）
 */

import { Hono } from 'hono';
import { getDb } from '../db';
import { constructEvent, handleEvent, type StripeContext } from '../services/stripe';
import { logger } from '../services/logger';

function ctx(): StripeContext {
  return { db: getDb() };
}

export const webhookRoutes = new Hono();

webhookRoutes.post('/stripe', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    return c.json({ error: 'missing stripe-signature' }, 400);
  }

  let raw: string;
  try {
    raw = await c.req.raw.clone().text();
  } catch {
    return c.json({ error: 'cannot read body' }, 400);
  }

  let event;
  try {
    event = await constructEvent(raw, signature);
  } catch (err) {
    logger.warn('stripe signature verify failed', { err });
    return c.json({ error: 'invalid signature' }, 400);
  }

  try {
    const result = await handleEvent(ctx(), event);
    return c.json({ received: true, ...result });
  } catch (err) {
    logger.error('stripe webhook handler failed', { err, eventId: event.id, eventType: event.type });
    return c.json({ error: 'handler failed' }, 500);
  }
});
