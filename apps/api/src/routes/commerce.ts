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
import { withdrawals } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { recharge, type PaymentContext } from '../services/payments';
import { unlock, listUnlocked, type PaywallContext } from '../services/paywall';
import {
  listShopItems,
  listTherapistShop,
  placeShopOrder,
  upsertListing,
  type ShopContext,
} from '../services/shop';
import { giveTip, type TipsContext } from '../services/tips';
import { recordAudit } from '../services/audit';
import {
  approveWithdrawal,
  rejectWithdrawal,
  requestWithdrawal,
  type WithdrawContext,
} from '../services/withdrawals';

function pctx(): PaymentContext {
  return { db: getDb() };
}
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

const RechargeBody = z.object({
  amount_usd_cents: z.number().int().min(100).max(100_000), // $1 - $1000
  channel: z.enum(['stub', 'stripe', 'adyen', 'alipay_hk']).optional(),
});

paymentRoutes.post('/recharge', zValidator('json', RechargeBody), async (c) => {
  const body = c.req.valid('json');
  const result = await recharge(pctx(), {
    userId: c.get('userId') as string,
    amountUsdCents: body.amount_usd_cents,
    channel: body.channel ?? 'stub',
  });
  return c.json({ data: result });
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
    customerId: c.get('userId') as string,
    therapistId: c.req.param('therapistId'),
    unlockType: body.unlock_type,
  });
  return c.json({ data: result });
});

paywallRoutes.get('/:therapistId/unlocks', async (c) => {
  const list = await listUnlocked(pwctx(), c.get('userId') as string, c.req.param('therapistId'));
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
    therapistUserId: c.get('userId') as string,
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
});

shopRoutes.post('/orders', zValidator('json', PlaceOrderBody), async (c) => {
  const body = c.req.valid('json');
  const order = await placeShopOrder(sctx(), {
    customerId: c.get('userId') as string,
    therapistId: body.therapist_id,
    shopItemId: body.shop_item_id,
    qty: body.qty,
    shippingAddressEncrypted: body.shipping_address_encrypted,
  });
  return c.json({ data: order });
});

// 公开：按技师拉橱窗
shopRoutes.get('/by-therapist/:therapistId', async (c) => {
  const list = await listTherapistShop(sctx(), c.req.param('therapistId'));
  return c.json({ data: list });
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
});

tipRoutes.post('/', zValidator('json', TipBody), async (c) => {
  const body = c.req.valid('json');
  const tip = await giveTip(tctx(), {
    customerId: c.get('userId') as string,
    therapistId: body.therapist_id,
    grossPoints: body.gross_points,
    timing: body.timing,
    message: body.message,
    orderId: body.order_id,
  });
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
    therapistUserId: c.get('userId') as string,
    amountCents: body.amount_cents,
    method: body.method,
    payoutDetailsEncrypted: body.payout_details_encrypted,
  });
  return c.json({ data: w });
});

withdrawRoutes.get('/', async (c) => {
  const list = await getDb().query.withdrawals.findMany({
    where: eq(withdrawals.therapistUserId, c.get('userId') as string),
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
    adminUserId: c.get('userId') as string,
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
    adminUserId: c.get('userId') as string,
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
