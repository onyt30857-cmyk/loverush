/**
 * 评价路由 · M08
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import {
  appealReview,
  listReviewsForTherapist,
  resolveAppeal,
  submitReview,
  type ReviewContext,
} from '../services/reviews';

function rctx(): ReviewContext {
  return { db: getDb() };
}

const SubmitBody = z.object({
  order_id: z.string().uuid(),
  score_appearance: z.number().int().min(0).max(100).optional(),
  score_body: z.number().int().min(0).max(100).optional(),
  score_service: z.number().int().min(0).max(100),
  content: z.string().max(500).optional(),
  tags: z.array(z.string().max(20)).max(10).optional(),
  is_anonymous: z.boolean().optional(),
});

const AppealBody = z.object({ reason: z.string().min(1).max(500) });
const ResolveBody = z.object({
  outcome: z.enum(['uphold', 'hide']),
  note: z.string().min(1).max(500),
});

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const reviewRoutes = new Hono();
reviewRoutes.use('*', requireAuth);

reviewRoutes.post('/', zValidator('json', SubmitBody), async (c) => {
  const body = c.req.valid('json');
  const row = await submitReview(rctx(), {
    orderId: body.order_id,
    reviewerUserId: c.get('userId') as string,
    scoreAppearance: body.score_appearance,
    scoreBody: body.score_body,
    scoreService: body.score_service,
    content: body.content,
    tags: body.tags,
    isAnonymous: body.is_anonymous,
  });
  return c.json({ data: row });
});

reviewRoutes.get('/therapist/:therapistId', zValidator('query', ListQuery), async (c) => {
  const q = c.req.valid('query');
  const list = await listReviewsForTherapist(rctx(), {
    therapistId: c.req.param('therapistId'),
    limit: q.limit,
    offset: q.offset,
  });
  return c.json({ data: list });
});

reviewRoutes.post('/:id/appeal', zValidator('json', AppealBody), async (c) => {
  const body = c.req.valid('json');
  const row = await appealReview(rctx(), {
    reviewId: c.req.param('id'),
    therapistUserId: c.get('userId') as string,
    reason: body.reason,
  });
  return c.json({ data: row });
});

// admin · 仲裁评价申诉
import { requireRole } from '../middleware/role';

export const adminReviewRoutes = new Hono();
adminReviewRoutes.use('*', requireAuth, requireRole(['admin', 'cs']));

adminReviewRoutes.post('/:id/resolve', zValidator('json', ResolveBody), async (c) => {
  const body = c.req.valid('json');
  const row = await resolveAppeal(rctx(), {
    reviewId: c.req.param('id'),
    adminUserId: c.get('userId') as string,
    outcome: body.outcome,
    note: body.note,
  });
  return c.json({ data: row });
});
