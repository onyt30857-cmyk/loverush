/**
 * 订单路由 · M07
 *
 * POST   /orders                            创建草稿订单（客户）
 * POST   /orders/:id/submit                 提交确认（客户）
 * POST   /orders/:id/confirm                技师确认 + 锁价
 * POST   /orders/:id/pay                    客户支付完成回调
 * POST   /orders/:id/start                  技师开始服务
 * POST   /orders/:id/complete               技师标记完成
 * POST   /orders/:id/review                 客户评价
 * POST   /orders/:id/cancel                 任一方取消
 * POST   /orders/:id/dispute                提起争议
 * POST   /admin/orders/:id/resolve          仲裁裁决
 * GET    /orders/:id                        查询订单
 * GET    /orders/:id/chain                  查询凭证链
 * GET    /orders/:id/chain/verify           验证凭证链完整性
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, asc } from 'drizzle-orm';
import { orderChain } from '@loverush/db';
import { getDb } from '../db';
import { requireAuth } from '../middleware/auth';
import { verifyChain } from '../services/chain';
import {
  cancelOrder,
  completeService,
  confirmAndLock,
  getOrderDetail,
  getActiveOrderForConversation,
  confirmOfflinePaid,
  createOrder,
  quoteOrder,
  customerNoShow,
  listOrders,
  markPaid,
  raiseDispute,
  resolveDispute,
  reviewOrder,
  startService,
  submitOrder,
  therapistNoShow,
  adminListOrders,
  adminGetOrder,
  adminListOrderAlerts,
  getAdminOrdersSummary,
  type AdminOrderFilters,
  type OrderContext,
} from '../services/orders';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

function ctx(): OrderContext {
  return { db: getDb() };
}

const CreateBody = z.object({
  therapist_id: z.string().uuid(),
  service_snapshot: z.object({
    skills: z.array(z.string()),
    durationMin: z.number().int().positive(),
    pricePoints: z.number().int().nonnegative(),
    itemsBreakdown: z
      .array(z.object({ name: z.string(), pricePoints: z.number().int() }))
      .optional(),
  }),
  scheduled_at: z.string().datetime().optional(),
  // M02b/M04 Phase 1 · 节目订单 · atomic claim 1 slot
  source_show_id: z.string().uuid().optional(),
  // 本单服务方式 · 仅 both 技师下单时由客户选(incall/outcall 技师自动定)
  service_mode: z.enum(['incall', 'outcall']).optional(),
  // 上门服务 · 客户上门地址(本单=上门时必填)
  customer_address: z.string().max(500).optional(),
  customer_address_note: z.string().max(200).optional(),
  customer_address_media: z
    .array(
      z.object({
        mediaId: z.string().uuid(),
        kind: z.enum(['image', 'video']),
        caption: z.string().max(200).optional(),
      }),
    )
    .max(9)
    .optional(),
  customer_lat: z.string().optional(),
  customer_lng: z.string().optional(),
  customer_area_name: z.string().max(80).optional(),
});

const QuoteBody = z.object({
  therapist_id: z.string().uuid(),
  service_snapshot: z.object({
    skills: z.array(z.string()),
    durationMin: z.number().int().positive(),
    pricePoints: z.number().int().nonnegative(),
  }),
  source_show_id: z.string().uuid().optional(),
});

const ReviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  review: z.string().max(500).optional(),
});

const CancelBody = z.object({ reason: z.string().min(1).max(200) });
const DisputeBody = z.object({ reason: z.string().min(1).max(500) });
const PayBody = z.object({ payment_txn_id: z.string().min(1) });
// 运营 UI 三动作:全额退款 / 部分退款 / 驳回(refund_partial 须带 refund_points)
const ResolveBody = z.object({
  resolution: z.enum(['refund_full', 'refund_partial', 'reject']),
  refund_points: z.number().int().nonnegative().optional(),
  note: z.string().max(500).optional(),
});

export const orderRoutes = new Hono();

orderRoutes.use('*', requireAuth);

orderRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const role = (c.req.query('role') === 'therapist' ? 'therapist' : 'customer');
  const statusParam = c.req.query('status');
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;
  const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : undefined;

  const ALLOWED = ['DRAFT', 'PENDING_CONFIRM', 'LOCKED', 'PAID', 'IN_SERVICE', 'COMPLETED', 'REVIEWED', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'CLOSED'] as const;
  type Status = (typeof ALLOWED)[number];
  let status: Status | Status[] | undefined;
  if (statusParam) {
    const parts = statusParam.split(',').map((s) => s.trim()).filter((s): s is Status => (ALLOWED as readonly string[]).includes(s));
    if (parts.length === 1) status = parts[0];
    else if (parts.length > 1) status = parts;
  }

  const rows = await listOrders(ctx(), { userId, role, status, limit, offset });
  return c.json({ data: rows });
});

// 下单报价(不建单)· 前端下单前预检余额是否够冻结心动金
orderRoutes.post('/quote', zValidator('json', QuoteBody), async (c) => {
  const body = c.req.valid('json');
  const pricing = await quoteOrder(ctx(), {
    therapistId: body.therapist_id,
    serviceSnapshot: { ...body.service_snapshot },
    sourceShowId: body.source_show_id,
  });
  return c.json({ data: pricing });
});

orderRoutes.post('/', zValidator('json', CreateBody), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId');
  const order = await createOrder(ctx(), {
    customerId: userId,
    therapistId: body.therapist_id,
    serviceSnapshot: body.service_snapshot,
    scheduledAt: body.scheduled_at ? new Date(body.scheduled_at) : undefined,
    sourceShowId: body.source_show_id,
    serviceMode: body.service_mode,
    customerAddress: body.customer_address,
    customerAddressNote: body.customer_address_note,
    customerAddressMedia: body.customer_address_media,
    customerLat: body.customer_lat,
    customerLng: body.customer_lng,
    customerAreaName: body.customer_area_name,
  });
  return c.json({ data: order });
});

orderRoutes.post('/:id/submit', async (c) => {
  const order = await submitOrder(ctx(), c.req.param('id'), c.get('userId'));
  return c.json({ data: order });
});

orderRoutes.post('/:id/confirm', async (c) => {
  const order = await confirmAndLock(ctx(), c.req.param('id'), c.get('userId'));
  return c.json({ data: order });
});

orderRoutes.post('/:id/pay', zValidator('json', PayBody), async (c) => {
  const body = c.req.valid('json');
  const order = await markPaid(ctx(), c.req.param('id'), body.payment_txn_id, c.get('userId'));
  return c.json({ data: order });
});

orderRoutes.post('/:id/start', async (c) => {
  const order = await startService(ctx(), c.req.param('id'), c.get('userId'));
  return c.json({ data: order });
});

// 0027 法币模式 · 技师确认已线下收款(替代 markPaid · 不需要 paymentTxnId)
orderRoutes.post('/:id/confirm-offline-paid', async (c) => {
  const order = await confirmOfflinePaid(ctx(), c.req.param('id'), c.get('userId'));
  return c.json({ data: order });
});

// 0027 · 技师标记客户没到场(30min 后才能 · 扣留心动金 50/50 分账)
orderRoutes.post('/:id/customer-no-show', async (c) => {
  const order = await customerNoShow(ctx(), c.req.param('id'), c.get('userId'));
  return c.json({ data: order });
});

// 0027 · 客户标记技师没到场(全退心动金 + 技师降信用)
orderRoutes.post('/:id/therapist-no-show', async (c) => {
  const order = await therapistNoShow(ctx(), c.req.param('id'), c.get('userId'));
  return c.json({ data: order });
});

orderRoutes.post('/:id/complete', async (c) => {
  const order = await completeService(ctx(), c.req.param('id'), c.get('userId'));
  return c.json({ data: order });
});

orderRoutes.post('/:id/review', zValidator('json', ReviewBody), async (c) => {
  const body = c.req.valid('json');
  const order = await reviewOrder(ctx(), c.req.param('id'), c.get('userId'), {
    rating: body.rating,
    review: body.review,
  });
  return c.json({ data: order });
});

orderRoutes.post('/:id/cancel', zValidator('json', CancelBody), async (c) => {
  const body = c.req.valid('json');
  const order = await cancelOrder(ctx(), c.req.param('id'), c.get('userId'), body.reason);
  return c.json({ data: order });
});

orderRoutes.post('/:id/dispute', zValidator('json', DisputeBody), async (c) => {
  const body = c.req.valid('json');
  const order = await raiseDispute(ctx(), c.req.param('id'), c.get('userId'), body.reason);
  return c.json({ data: order });
});

// M-OAC · 会话活跃订单(顶部常驻操作条)· 必须在 /:id 之前注册(否则被动态段吞掉)
orderRoutes.get('/active-for-conversation', async (c) => {
  const conversationId = c.req.query('conversationId');
  if (!conversationId) throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'conversationId required');
  const summary = await getActiveOrderForConversation(ctx(), conversationId, c.get('userId'));
  return c.json({ data: summary });
});

orderRoutes.get('/:id', async (c) => {
  const order = await getOrderDetail(ctx(), c.req.param('id'), c.get('userId'));
  if (!order) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');
  return c.json({ data: order });
});

orderRoutes.get('/:id/chain', async (c) => {
  const list = await getDb().query.orderChain.findMany({
    where: eq(orderChain.orderId, c.req.param('id')),
    orderBy: [asc(orderChain.seq)],
  });
  return c.json({ data: list });
});

orderRoutes.get('/:id/chain/verify', async (c) => {
  const result = await verifyChain(getDb(), c.req.param('id'));
  return c.json({ data: result });
});

// Admin · 仲裁裁决（仅 admin 或 cs 客服可裁决）
import { requireRole } from '../middleware/role';
import { recordAudit } from '../services/audit';

export const adminOrderRoutes = new Hono();
adminOrderRoutes.use('*', requireAuth, requireRole(['admin', 'cs']));

const OrderStatusEnum = z.enum([
  'DRAFT', 'PENDING_CONFIRM', 'LOCKED', 'PAID', 'IN_SERVICE', 'COMPLETED', 'REVIEWED', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'CLOSED',
]);

// list/summary 共用的筛选字段(summary 不含分页)
const FilterShape = {
  status: OrderStatusEnum.optional(),
  search: z.string().max(60).optional(),
  customer_id: z.string().uuid().optional(),
  therapist_user_id: z.string().uuid().optional(),
  currency_code: z.string().max(8).optional(),
  paid_state: z.enum(['paid', 'unpaid']).optional(),
  country: z.string().max(4).optional(),
  city_id: z.string().uuid().optional(),
  created_from: z.string().max(40).optional(),
  created_to: z.string().max(40).optional(),
};
const AdminListQuery = z.object({
  ...FilterShape,
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const AdminSummaryQuery = z.object(FilterShape);

// query(snake) → service filters(camel)
function toFilters(q: z.infer<typeof AdminSummaryQuery>): AdminOrderFilters {
  return {
    status: q.status,
    search: q.search,
    customerId: q.customer_id,
    therapistUserId: q.therapist_user_id,
    currencyCode: q.currency_code,
    paidState: q.paid_state,
    country: q.country?.toUpperCase(),
    cityId: q.city_id,
    createdFrom: q.created_from,
    createdTo: q.created_to,
  };
}

adminOrderRoutes.get('/', zValidator('query', AdminListQuery), async (c) => {
  const q = c.req.valid('query');
  const list = await adminListOrders(ctx(), {
    ...toFilters(q),
    limit: q.limit,
    offset: q.offset,
  });
  return c.json({ data: list });
});

// 运营指标(跟随筛选即时统计)· 必须在 /:id 之前注册
adminOrderRoutes.get('/summary', zValidator('query', AdminSummaryQuery), async (c) => {
  const q = c.req.valid('query');
  const summary = await getAdminOrdersSummary(ctx(), toFilters(q));
  return c.json({ data: summary });
});

// 异常订单监控(卡住的非终态单)· 必须在 /:id 之前注册,否则被 /:id 抢匹配
adminOrderRoutes.get('/alerts', async (c) => {
  const list = await adminListOrderAlerts(ctx());
  return c.json({ data: list });
});

// admin 强制取消(任意可转 CANCELLED 的状态)· 复用 cancelOrder(已解冻心动金)
const AdminCancelBody = z.object({ reason: z.string().min(1).max(200) });
adminOrderRoutes.post('/:id/cancel', zValidator('json', AdminCancelBody), async (c) => {
  const body = c.req.valid('json');
  const order = await cancelOrder(ctx(), c.req.param('id'), c.get('userId'), body.reason, 'admin');
  await recordAudit(ctx(), c, {
    action: 'order.admin_cancel',
    targetType: 'order',
    targetId: c.req.param('id'),
    after: { status: order.status },
    reason: body.reason,
    actorRole: 'admin',
  });
  return c.json({ data: order });
});

// 订单时间线(凭证链)· 运营看订单全过程
adminOrderRoutes.get('/:id/chain', async (c) => {
  const list = await getDb().query.orderChain.findMany({
    where: eq(orderChain.orderId, c.req.param('id')),
    orderBy: [asc(orderChain.seq)],
  });
  return c.json({ data: list });
});

adminOrderRoutes.get('/:id', async (c) => {
  const order = await adminGetOrder(ctx(), c.req.param('id'));
  if (!order) {
    return c.json({ error: { code: 'E0003', message: 'order not found', timestamp: new Date().toISOString() } }, 404);
  }
  return c.json({ data: order });
});

adminOrderRoutes.post('/:id/resolve', zValidator('json', ResolveBody), async (c) => {
  const body = c.req.valid('json');
  const id = c.req.param('id');
  // UI 三动作 → service 二态:全额/部分退款都走 'refund'(差异在 refundPoints),驳回走 'reject'
  const mapped: 'refund' | 'reject' = body.resolution === 'reject' ? 'reject' : 'refund';
  let refundPoints = body.refund_points;
  if (body.resolution === 'refund_full') {
    // 全额 = 冻结心动金;老积分单无 deposit 则退订单积分
    const ord = await adminGetOrder(ctx(), id);
    refundPoints = ord ? ord.depositPoints ?? ord.pricePoints : undefined;
  }
  const order = await resolveDispute(ctx(), id, c.get('userId'), {
    resolution: mapped,
    refundPoints,
    note: body.note,
  });
  await recordAudit(ctx(), c, {
    action: 'order.resolve_dispute',
    targetType: 'order',
    targetId: id,
    after: {
      status: order.status,
      resolution: body.resolution,
      refundPoints: refundPoints ?? 0,
    },
    reason: body.note,
    actorRole: 'cs',
  });
  return c.json({ data: order });
});
