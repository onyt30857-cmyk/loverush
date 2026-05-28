/**
 * AI 分身配置路由 · M06
 *
 * POST   /therapists/me/ai-alter/configure    启用/禁用 + personality
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
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
