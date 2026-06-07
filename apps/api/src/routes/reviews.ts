/**
 * 评价路由 · M08
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, lte, sql } from 'drizzle-orm';
import { reviews } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { recordAudit } from '../services/audit';
import {
  appealReview,
  getReceivedReviews,
  getTherapistReviewSummary,
  listReviewsForTherapist,
  resolveAppeal,
  submitReview,
  type ReviewContext,
} from '../services/reviews';
import { refreshTherapistRating } from '../services/rating';
import { fireAndForget } from '../services/logger';

function rctx(): ReviewContext {
  return { db: getDb() };
}

const SubmitBody = z.object({
  order_id: z.string().uuid(),
  // 总分必填(0-100=5星×20)· 体验向四维可选
  score_overall: z.number().int().min(0).max(100),
  score_service: z.number().int().min(0).max(100).optional(),
  score_attitude: z.number().int().min(0).max(100).optional(),
  score_authenticity: z.number().int().min(0).max(100).optional(),
  score_punctuality: z.number().int().min(0).max(100).optional(),
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
    reviewerUserId: c.get('userId'),
    scoreOverall: body.score_overall,
    scoreService: body.score_service,
    scoreAttitude: body.score_attitude,
    scoreAuthenticity: body.score_authenticity,
    scorePunctuality: body.score_punctuality,
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

// 技师端:我收到的评价(含申诉状态)
reviewRoutes.get('/me', async (c) => {
  const list = await getReceivedReviews(rctx(), c.get('userId'));
  return c.json({ data: list });
});

reviewRoutes.get('/therapist/:therapistId/summary', async (c) => {
  const summary = await getTherapistReviewSummary(rctx(), c.req.param('therapistId'));
  return c.json({ data: summary });
});

reviewRoutes.post('/:id/appeal', zValidator('json', AppealBody), async (c) => {
  const body = c.req.valid('json');
  const row = await appealReview(rctx(), {
    reviewId: c.req.param('id'),
    therapistUserId: c.get('userId'),
    reason: body.reason,
  });
  return c.json({ data: row });
});

// admin · 仲裁评价申诉
import { requireRole } from '../middleware/role';

export const adminReviewRoutes = new Hono();
adminReviewRoutes.use('*', requireAuth, requireRole(['admin', 'cs']));

const AdminListQuery = z.object({
  filter: z.enum(['low_score', 'appeal_pending', 'hidden', 'all']).optional(),
  target_user_id: z.string().uuid().optional(),
  reviewer_user_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// 评价管理列表(运营)
adminReviewRoutes.get('/', zValidator('query', AdminListQuery), async (c) => {
  const q = c.req.valid('query');
  const db = getDb();
  const conds = [];

  switch (q.filter ?? 'appeal_pending') {
    case 'low_score':
      conds.push(lte(reviews.scoreService, 40)); // 4 分以下(10×10 制)
      conds.push(eq(reviews.isHidden, 0));
      break;
    case 'appeal_pending':
      conds.push(eq(reviews.appealStatus, 'pending'));
      break;
    case 'hidden':
      conds.push(eq(reviews.isHidden, 1));
      break;
    case 'all':
      // no extra cond
      break;
  }
  if (q.target_user_id) conds.push(eq(reviews.targetUserId, q.target_user_id));
  if (q.reviewer_user_id) conds.push(eq(reviews.reviewerUserId, q.reviewer_user_id));

  // JOIN users 两次拿 reviewer + target 昵称(走 raw SQL,drizzle 双 join 别扭)
  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;
  const whereSql =
    conds.length === 0
      ? sql`1=1`
      : conds.reduce<ReturnType<typeof sql>>((acc, c, i) => (i === 0 ? sql`${c}` : sql`${acc} AND ${c}`), sql``);

  const rows = (await db.execute(sql`
    SELECT
      reviews.id,
      reviews.order_id,
      reviews.reviewer_user_id,
      reviews.target_user_id,
      reviews.score_service,
      reviews.score_appearance,
      reviews.score_body,
      reviews.content,
      reviews.tags,
      reviews.is_hidden,
      reviews.is_anonymous,
      reviews.appeal_status,
      reviews.appeal_reason,
      reviews.created_at,
      rev.display_name AS reviewer_name,
      tgt.display_name AS target_name
    FROM reviews
    LEFT JOIN users rev ON rev.id = reviews.reviewer_user_id
    LEFT JOIN users tgt ON tgt.id = reviews.target_user_id
    WHERE ${whereSql}
    ORDER BY reviews.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<{
    id: string;
    order_id: string;
    reviewer_user_id: string;
    target_user_id: string;
    score_service: number;
    score_appearance: number | null;
    score_body: number | null;
    content: string | null;
    tags: string[] | null;
    is_hidden: number;
    is_anonymous: number;
    appeal_status: string | null;
    appeal_reason: string | null;
    created_at: string;
    reviewer_name: string | null;
    target_name: string | null;
  }>;

  return c.json({ data: rows });
});

// 列表概览统计
adminReviewRoutes.get('/stats', async (c) => {
  const db = getDb();
  const [s] = (await db.execute(sql`
    SELECT
      COUNT(*)::int                                                  AS total,
      COUNT(*) FILTER (WHERE is_hidden = 1)::int                     AS hidden,
      COUNT(*) FILTER (WHERE appeal_status = 'pending')::int          AS appeal_pending,
      COUNT(*) FILTER (WHERE score_service <= 40 AND is_hidden = 0)::int AS low_score,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS recent_7d
    FROM reviews
  `)) as unknown as Array<{
    total: number;
    hidden: number;
    appeal_pending: number;
    low_score: number;
    recent_7d: number;
  }>;
  return c.json({ data: s });
});

adminReviewRoutes.post('/:id/resolve', zValidator('json', ResolveBody), async (c) => {
  const body = c.req.valid('json');
  const row = await resolveAppeal(rctx(), {
    reviewId: c.req.param('id'),
    adminUserId: c.get('userId'),
    outcome: body.outcome,
    note: body.note,
  });
  return c.json({ data: row });
});

const HideBody = z.object({ reason: z.string().min(1).max(500) });

// 软删(隐藏评价)
adminReviewRoutes.post('/:id/hide', zValidator('json', HideBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const db = getDb();
  const target = await db.query.reviews.findFirst({ where: eq(reviews.id, id) });
  if (!target) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'review not found');
  await db.update(reviews).set({ isHidden: 1, updatedAt: new Date() }).where(eq(reviews.id, id));
  // 隐藏后该评价应从聚合剔除 → 重算技师评分(原 bug:只 resolveAppeal 触发,直接隐藏不触发)
  if (target.targetTherapistId) {
    fireAndForget(refreshTherapistRating({ db }, target.targetTherapistId), 'reviews.refresh_scores_failed', { therapistId: target.targetTherapistId });
  }
  await recordAudit({ db }, c, {
    action: 'review.hide',
    targetType: 'review',
    targetId: id,
    before: { isHidden: target.isHidden },
    after: { isHidden: 1 },
    reason: body.reason,
  });
  return c.json({ data: { ok: true } });
});

// 恢复曝光
adminReviewRoutes.post('/:id/unhide', zValidator('json', HideBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const db = getDb();
  const target = await db.query.reviews.findFirst({ where: eq(reviews.id, id) });
  if (!target) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'review not found');
  await db.update(reviews).set({ isHidden: 0, updatedAt: new Date() }).where(eq(reviews.id, id));
  // 恢复曝光后该评价重新计入聚合 → 重算技师评分
  if (target.targetTherapistId) {
    fireAndForget(refreshTherapistRating({ db }, target.targetTherapistId), 'reviews.refresh_scores_failed', { therapistId: target.targetTherapistId });
  }
  await recordAudit({ db }, c, {
    action: 'review.unhide',
    targetType: 'review',
    targetId: id,
    before: { isHidden: target.isHidden },
    after: { isHidden: 0 },
    reason: body.reason,
  });
  return c.json({ data: { ok: true } });
});
