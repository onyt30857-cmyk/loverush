/**
 * 商业模块路由 · M09
 *
 * 充值
 *   POST   /payments/recharge                {amount_usd_cents, channel?}
 *
 * 付费墙
 *   POST   /therapists/:id/unlock            {unlock_type}
 *   GET    /therapists/:id/unlocks           列出已解锁项
 *
 * 橱窗
 *   GET    /shop/items                       商品池
 *   GET    /therapists/:id/shop              技师橱窗
 *   PUT    /therapists/me/shop/:itemId       上架/修改
 *   POST   /shop/orders                      下单
 *
 * 小费
 *   POST   /tips                             给小费
 *
 * 提现
 *   POST   /me/withdrawals                   申请提现
 *   GET    /me/withdrawals                   我的提现记录
 *   POST   /admin/withdrawals/:id/approve    审批通过
 *   POST   /admin/withdrawals/:id/reject     拒绝
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { withdrawals, therapists } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { unlock, listUnlocked, type PaywallContext } from '../services/paywall';
import {
  listShopItems,
  listTherapistShop,
  placeShopOrder,
  upsertListing,
  type ShopContext,
} from '../services/shop';
import { giveTip, type TipsContext } from '../services/tips';
import { reactToGift } from '../services/companion';
import { recordAudit } from '../services/audit';
import {
  approveWithdrawal,
  rejectWithdrawal,
  requestWithdrawal,
  type WithdrawContext,
} from '../services/withdrawals';
import { getCityCountryById } from '../services/countries';
import { logger } from '../services/logger';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

function pwctx(): PaywallContext {
  return { db: getDb() };
}
function sctx(): ShopContext {
  return { db: getDb() };
}
function tctx(): TipsContext {
  return { db: getDb() };
}
function wctx(): WithdrawContext {
  return { db: getDb() };
}

// ──────────────── 充值 ────────────────

export const paymentRoutes = new Hono();
paymentRoutes.use('*', requireAuth);

// M16 纯分销:平台不再直接卖积分给客户,积分一律通过代理购买(/point-purchases · 前端 /me/recharge)。
// 直充端点保留壳但封禁,防客户端或脚本绕过。前端已无任何调用。
paymentRoutes.post('/recharge', async (c) => {
  return c.json(
    { error: { code: 'E_RECHARGE_DISABLED', message: '积分请通过代理购买,直充已关闭' } },
    410,
  );
});

// ──────────────── 付费墙 ────────────────

export const paywallRoutes = new Hono();
paywallRoutes.use('*', requireAuth);

const UnlockBody = z.object({
  unlock_type: z.enum(['social_contacts', 'gallery_paid']),
});

paywallRoutes.post('/:therapistId/unlock', zValidator('json', UnlockBody), async (c) => {
  const body = c.req.valid('json');
  const result = await unlock(pwctx(), {
    customerId: c.get('userId'),
    therapistId: c.req.param('therapistId'),
    unlockType: body.unlock_type,
  });
  return c.json({ data: result });
});

paywallRoutes.get('/:therapistId/unlocks', async (c) => {
  const list = await listUnlocked(pwctx(), c.get('userId'), c.req.param('therapistId'));
  return c.json({ data: list });
});

// ──────────────── 橱窗 ────────────────

export const shopRoutes = new Hono();
shopRoutes.use('*', requireAuth);

const ShopListQuery = z.object({
  category: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

shopRoutes.get('/items', zValidator('query', ShopListQuery), async (c) => {
  const q = c.req.valid('query');
  // 客户泛列：尝试从 requestor 的 therapist 记录推国家（客户无 serviceCityId，暂不过滤）
  // MVP：客户端不传国家时不过滤，避免误拦
  const list = await listShopItems(sctx(), q);
  return c.json({ data: list });
});

const ListingBody = z.object({
  shop_item_id: z.string().uuid(),
  display_order: z.number().int().min(0).max(1000).optional(),
  therapist_note: z.string().max(200).optional(),
  commission_bps_override: z.number().int().min(0).max(10000).optional(),
  is_active: z.boolean().optional(),
});

shopRoutes.put('/me/listings', zValidator('json', ListingBody), async (c) => {
  const body = c.req.valid('json');
  await upsertListing(sctx(), {
    therapistUserId: c.get('userId'),
    shopItemId: body.shop_item_id,
    displayOrder: body.display_order,
    therapistNote: body.therapist_note,
    commissionBpsOverride: body.commission_bps_override,
    isActive: body.is_active,
  });
  return c.json({ data: { ok: true } });
});

const PlaceOrderBody = z.object({
  therapist_id: z.string().uuid(),
  shop_item_id: z.string().uuid(),
  qty: z.number().int().min(1).max(20),
  shipping_address_encrypted: z.string().optional(),
  request_id: z.string().max(64).optional(),
});

shopRoutes.post('/orders', zValidator('json', PlaceOrderBody), async (c) => {
  const body = c.req.valid('json');

  // ── 国家校验：取技师服务国家，校验商品 countryCodes 包含它 ──
  const db = getDb();
  const ther = await db.query.therapists.findFirst({ where: eq(therapists.id, body.therapist_id) });
  const therapistCountryCode = ther?.serviceCityId
    ? getCityCountryById(ther.serviceCityId)
    : undefined;

  if (therapistCountryCode) {
    // 取商品的 countryCodes 快速校验（不走 service 避免多一次查询）
    const { shopItems: shopItemsTbl } = await import('@loverush/db');
    const item = await db.query.shopItems.findFirst({ where: eq(shopItemsTbl.id, body.shop_item_id) });
    // 空 country_codes = 全球可售;仅当配置了国家且不含本国才拦
    if (item && item.countryCodes.length > 0 && !item.countryCodes.includes(therapistCountryCode)) {
      throw HttpError.badRequest(
        ErrorCode.E0001_INVALID_PARAM,
        `该商品不在服务区域可售（技师所在国家：${therapistCountryCode}）`,
      );
    }
  } else {
    // 技师国家推不出（无 serviceCityId）：MVP 放行，但记录 warn
    if (ther) {
      logger.warn('shop.order.country_gate: therapist has no serviceCityId, skipping country check', {
        therapistId: body.therapist_id,
      });
    }
  }

  const order = await placeShopOrder(sctx(), {
    customerId: c.get('userId'),
    therapistId: body.therapist_id,
    shopItemId: body.shop_item_id,
    qty: body.qty,
    shippingAddressEncrypted: body.shipping_address_encrypted,
    requestId: body.request_id,
  });
  return c.json({ data: order });
});

// 公开：按技师拉橱窗（国家过滤：只展示该技师所在国的可售商品）
shopRoutes.get('/by-therapist/:therapistId', async (c) => {
  const therapistId = c.req.param('therapistId');
  const db = getDb();
  const ther = await db.query.therapists.findFirst({ where: eq(therapists.id, therapistId) });
  const countryCode = ther?.serviceCityId ? getCityCountryById(ther.serviceCityId) : undefined;
  const list = await listTherapistShop(sctx(), therapistId, countryCode);
  return c.json({ data: list });
});

// 技师：查看该技师国家可选的平台商品（选品页用）
shopRoutes.get('/me/available', async (c) => {
  const db = getDb();
  const ther = await db.query.therapists.findFirst({ where: eq(therapists.userId, c.get('userId')) });
  // 技师档案行尚未创建（注册后档案懒创建）或无服务城市 → 提示去设置
  if (!ther || !ther.serviceCityId) {
    return c.json({ data: [], meta: { noCity: true } });
  }

  const countryCode = getCityCountryById(ther.serviceCityId);
  if (!countryCode) {
    return c.json({ data: [], meta: { noCity: true } });
  }

  const items = await listShopItems(sctx(), { countryCode, limit: 100 });
  return c.json({ data: items, meta: { countryCode } });
});

// 客户：查看自己的橱窗订单（含商品标题/技师名/状态/积分/时间）· 按时间倒序
const ShopOrdersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

shopRoutes.get('/me/orders', zValidator('query', ShopOrdersQuery), async (c) => {
  const userId = c.get('userId');
  const q = c.req.valid('query');
  const db = getDb();

  const { shopOrders: soTbl, shopItems: siTbl, therapists: tTbl, users: uTbl } = await import('@loverush/db');
  const { desc: descFn, eq: eqFn, and: andFn } = await import('drizzle-orm');

  const rows = await db
    .select({
      id: soTbl.id,
      orderNo: soTbl.orderNo,
      status: soTbl.status,
      qty: soTbl.qty,
      totalPoints: soTbl.totalPoints,
      // 商品：仅类目（不含具体商品名，隐私包装）
      itemCategory: siTbl.category,
      // 技师显示名
      therapistDisplayName: uTbl.displayName,
      therapistId: soTbl.therapistId,
      trackingNumber: soTbl.trackingNumber,
      paidAt: soTbl.paidAt,
      shippedAt: soTbl.shippedAt,
      deliveredAt: soTbl.deliveredAt,
      refundedAt: soTbl.refundedAt,
      createdAt: soTbl.createdAt,
    })
    .from(soTbl)
    .leftJoin(siTbl, eqFn(siTbl.id, soTbl.shopItemId))
    .leftJoin(tTbl, andFn(eqFn(tTbl.id, soTbl.therapistId)))
    .leftJoin(uTbl, andFn(eqFn(uTbl.id, soTbl.therapistUserId)))
    .where(eqFn(soTbl.customerId, userId))
    .orderBy(descFn(soTbl.createdAt))
    .limit(q.limit ?? 30)
    .offset(q.offset ?? 0);

  return c.json({ data: rows });
});

// 客户：单个橱窗订单详情（本人可见全貌：商品名/图/数量/单价/地址/物流/时间线）
// 归属校验:customerId===userId,否则 404(不泄露他人订单/地址)
shopRoutes.get('/me/orders/:id', async (c) => {
  const userId = c.get('userId');
  const orderId = c.req.param('id');
  const db = getDb();

  const { shopOrders: soTbl, shopItems: siTbl, users: uTbl } = await import('@loverush/db');
  const { eq: eqFn, and: andFn } = await import('drizzle-orm');

  const [row] = await db
    .select({
      id: soTbl.id,
      orderNo: soTbl.orderNo,
      status: soTbl.status,
      qty: soTbl.qty,
      unitPricePoints: soTbl.unitPricePoints,
      totalPoints: soTbl.totalPoints,
      itemTitle: siTbl.title,
      itemCover: siTbl.coverUrl,
      itemCategory: siTbl.category,
      itemDescription: siTbl.description,
      therapistId: soTbl.therapistId,
      therapistDisplayName: uTbl.displayName,
      // 收货地址(明文存储,仅本人可见)
      shippingAddress: soTbl.shippingAddressEncrypted,
      trackingNumber: soTbl.trackingNumber,
      paidAt: soTbl.paidAt,
      shippedAt: soTbl.shippedAt,
      deliveredAt: soTbl.deliveredAt,
      refundedAt: soTbl.refundedAt,
      createdAt: soTbl.createdAt,
    })
    .from(soTbl)
    .leftJoin(siTbl, eqFn(siTbl.id, soTbl.shopItemId))
    .leftJoin(uTbl, andFn(eqFn(uTbl.id, soTbl.therapistUserId)))
    .where(andFn(eqFn(soTbl.id, orderId), eqFn(soTbl.customerId, userId)))
    .limit(1);

  if (!row) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');
  return c.json({ data: row });
});

// 技师：查看自己所有已上架项（含已下架，用于选品管理）
shopRoutes.get('/me/listings', async (c) => {
  const db = getDb();
  const ther = await db.query.therapists.findFirst({ where: eq(therapists.userId, c.get('userId')) });
  if (!ther) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');

  // 拉所有上架记录（含 isActive=0，技师管理页需要看到已下架的）
  const { therapistShopListings: tslTbl, shopItems: siTbl } = await import('@loverush/db');
  const listings = await db.query.therapistShopListings.findMany({
    where: eq(tslTbl.therapistId, ther.id),
    orderBy: [desc(tslTbl.displayOrder), desc(tslTbl.soldCount)],
  });

  if (!listings.length) return c.json({ data: [] });

  const itemIds = listings.map((l) => l.shopItemId);
  const { inArray } = await import('drizzle-orm');
  const items = await db.query.shopItems.findMany({
    where: inArray(siTbl.id, itemIds),
  });
  const itemMap = new Map(items.map((i) => [i.id, i]));

  const result = listings
    .map((l) => ({ listing: l, item: itemMap.get(l.shopItemId) ?? null }))
    .filter((x) => x.item !== null);

  return c.json({ data: result });
});

// ──────────────── 小费 ────────────────

export const tipRoutes = new Hono();
tipRoutes.use('*', requireAuth);

const TipBody = z.object({
  therapist_id: z.string().uuid(),
  gross_points: z.number().int().min(10).max(100_000),
  timing: z.enum(['pre_service', 'post_service']).optional(),
  message: z.string().max(200).optional(),
  order_id: z.string().uuid().optional(),
  // 在聊天里送礼时带上,触发礼物消息(双方可见) + 分身娇羞道谢 + 亲密度推进(心动陪伴飞轮)
  conversation_id: z.string().uuid().optional(),
  gift_emoji: z.string().max(8).optional(),
  gift_name: z.string().max(40).optional(),
});

tipRoutes.post('/', zValidator('json', TipBody), async (c) => {
  const body = c.req.valid('json');
  const customerId = c.get('userId');
  const tip = await giveTip(tctx(), {
    customerId,
    therapistId: body.therapist_id,
    grossPoints: body.gross_points,
    timing: body.timing,
    message: body.message,
    orderId: body.order_id,
  });
  // 异步:分身收礼反应(加亲密度+娇羞道谢发进对话)·失败不影响已成功的打赏
  void reactToGift({ db: getDb() }, {
    customerId,
    therapistUserId: tip.therapistUserId,
    conversationId: body.conversation_id,
    giftEmoji: body.gift_emoji ?? '💝',
    giftName: body.gift_name ?? '一份心意',
    grossPoints: body.gross_points,
  }).catch((err) => console.warn('[tips] reactToGift failed:', err?.message));
  return c.json({ data: tip });
});

// ──────────────── 提现 ────────────────

export const withdrawRoutes = new Hono();
withdrawRoutes.use('*', requireAuth);

const WithdrawBody = z.object({
  amount_cents: z.number().int().min(5000),
  method: z.enum(['bank', 'paynow', 'wise', 'usdt']),
  payout_details_encrypted: z.string().min(1),
});

withdrawRoutes.post('/', zValidator('json', WithdrawBody), async (c) => {
  const body = c.req.valid('json');
  const w = await requestWithdrawal(wctx(), {
    therapistUserId: c.get('userId'),
    amountCents: body.amount_cents,
    method: body.method,
    payoutDetailsEncrypted: body.payout_details_encrypted,
  });
  return c.json({ data: w });
});

withdrawRoutes.get('/', async (c) => {
  const list = await getDb().query.withdrawals.findMany({
    where: eq(withdrawals.therapistUserId, c.get('userId')),
    orderBy: [desc(withdrawals.requestedAt)],
  });
  return c.json({ data: list });
});

// admin · 财务审批
import { requireRole } from '../middleware/role';

export const adminWithdrawRoutes = new Hono();
adminWithdrawRoutes.use('*', requireAuth, requireRole(['admin', 'finance']));

const ApproveBody = z.object({ external_txn_ref: z.string().min(1) });
const RejectBody = z.object({ reason: z.string().min(1).max(500) });

adminWithdrawRoutes.post('/:id/approve', zValidator('json', ApproveBody), async (c) => {
  const body = c.req.valid('json');
  const w = await approveWithdrawal(wctx(), {
    withdrawalId: c.req.param('id'),
    adminUserId: c.get('userId'),
    externalTxnRef: body.external_txn_ref,
  });
  await recordAudit(wctx(), c, {
    action: 'withdraw.approve',
    targetType: 'withdrawal',
    targetId: w.id,
    after: { status: w.status, externalTxnRef: body.external_txn_ref, amountCents: w.amountCents },
    actorRole: 'finance',
  });
  return c.json({ data: w });
});

adminWithdrawRoutes.post('/:id/reject', zValidator('json', RejectBody), async (c) => {
  const body = c.req.valid('json');
  const w = await rejectWithdrawal(wctx(), {
    withdrawalId: c.req.param('id'),
    adminUserId: c.get('userId'),
    reason: body.reason,
  });
  await recordAudit(wctx(), c, {
    action: 'withdraw.reject',
    targetType: 'withdrawal',
    targetId: w.id,
    after: { status: w.status, amountCents: w.amountCents },
    reason: body.reason,
    actorRole: 'finance',
  });
  return c.json({ data: w });
});

const AdminWithdrawQuery = z.object({
  status: z.enum(['pending', 'processing', 'paid', 'rejected', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

adminWithdrawRoutes.get('/', zValidator('query', AdminWithdrawQuery), async (c) => {
  const q = c.req.valid('query');
  const { withdrawals } = await import('@loverush/db');
  const { eq, desc } = await import('drizzle-orm');
  const list = await getDb().query.withdrawals.findMany({
    where: q.status ? eq(withdrawals.status, q.status) : undefined,
    orderBy: [desc(withdrawals.requestedAt)],
    limit: q.limit ?? 50,
    offset: q.offset ?? 0,
  });
  return c.json({ data: list });
});
