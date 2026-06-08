/**
 * 橱窗带货 · M09a
 *
 * - 商品池 list / 详情（admin 维护，技师选品上架）
 * - 技师上架 / 下架
 * - 客户下单（扣积分 + 分成结算 + 库存扣减）
 */

import { and, eq, sql, desc } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  shopItems,
  therapistShopListings,
  shopOrders,
  therapistEarnings,
  therapists,
  users,
  type ShopItem,
  type ShopOrder,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { debit, credit, type PointsContext } from './points';
import { logger } from './logger';
import { nanoid } from 'nanoid';

export interface ShopContext {
  db: Database;
}

const POINTS_PER_USD = 100;

// ──────────────── 商品池 ────────────────

export async function listShopItems(
  ctx: ShopContext,
  q: { category?: string; countryCode?: string; limit?: number; offset?: number },
): Promise<ShopItem[]> {
  return ctx.db.query.shopItems.findMany({
    where: and(
      eq(shopItems.isActive, 1),
      q.category ? eq(shopItems.category, q.category) : undefined,
      q.countryCode ? sql`${q.countryCode} = ANY(${shopItems.countryCodes})` : undefined,
    ),
    orderBy: [desc(shopItems.soldCount), desc(shopItems.createdAt)],
    limit: q.limit ?? 30,
    offset: q.offset ?? 0,
  });
}

// ──────────────── 技师上架 ────────────────

export async function listTherapistShop(
  ctx: ShopContext,
  therapistId: string,
): Promise<Array<{ listing: typeof therapistShopListings.$inferSelect; item: ShopItem }>> {
  const listings = await ctx.db.query.therapistShopListings.findMany({
    where: and(eq(therapistShopListings.therapistId, therapistId), eq(therapistShopListings.isActive, 1)),
    orderBy: [desc(therapistShopListings.displayOrder), desc(therapistShopListings.soldCount)],
  });
  const itemIds = listings.map((l) => l.shopItemId);
  if (!itemIds.length) return [];
  const items = await ctx.db.query.shopItems.findMany({
    where: (i, { inArray }) => inArray(i.id, itemIds),
  });
  const itemMap = new Map(items.map((i) => [i.id, i]));
  return listings
    .map((l) => ({ listing: l, item: itemMap.get(l.shopItemId)! }))
    .filter((x) => x.item);
}

export async function upsertListing(
  ctx: ShopContext,
  args: {
    therapistUserId: string;
    shopItemId: string;
    displayOrder?: number;
    therapistNote?: string;
    commissionBpsOverride?: number;
    isActive?: boolean;
  },
): Promise<void> {
  const t = await ctx.db.query.therapists.findFirst({ where: eq(therapists.userId, args.therapistUserId) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');

  await ctx.db
    .insert(therapistShopListings)
    .values({
      therapistId: t.id,
      therapistUserId: args.therapistUserId,
      shopItemId: args.shopItemId,
      displayOrder: args.displayOrder ?? 0,
      therapistNote: args.therapistNote,
      commissionBpsOverride: args.commissionBpsOverride,
      isActive: args.isActive === false ? 0 : 1,
    })
    .onConflictDoUpdate({
      target: [therapistShopListings.therapistId, therapistShopListings.shopItemId],
      set: {
        displayOrder: args.displayOrder ?? 0,
        therapistNote: args.therapistNote,
        commissionBpsOverride: args.commissionBpsOverride,
        isActive: args.isActive === false ? 0 : 1,
      },
    });
}

// ──────────────── 下单 + 分成 ────────────────

export async function placeShopOrder(
  ctx: ShopContext,
  args: {
    customerId: string;
    therapistId: string;
    shopItemId: string;
    qty: number;
    shippingAddressEncrypted?: string;
  },
): Promise<ShopOrder> {
  const item = await ctx.db.query.shopItems.findFirst({ where: eq(shopItems.id, args.shopItemId) });
  if (!item || !item.isActive) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'item not active');
  }
  if (item.stockQty < args.qty) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'insufficient stock');
  }

  const listing = await ctx.db.query.therapistShopListings.findFirst({
    where: and(
      eq(therapistShopListings.therapistId, args.therapistId),
      eq(therapistShopListings.shopItemId, args.shopItemId),
    ),
  });
  if (!listing || !listing.isActive) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'listing inactive');
  }

  // 成人用品下单须先完成年龄确认
  const customer = await ctx.db.query.users.findFirst({ where: eq(users.id, args.customerId) });
  if (!customer?.adultConfirmedAt) {
    throw HttpError.forbidden(ErrorCode.E2030_ADULT_CONFIRM_REQUIRED, 'adult confirmation required');
  }

  const totalPoints = item.pricePoints * args.qty;
  const commissionBps = listing.commissionBpsOverride ?? item.commissionBpsDefault;
  const therapistCommission = Math.floor((totalPoints * commissionBps) / 10000);
  const platformRevenue = totalPoints - therapistCommission;

  // 扣客户积分
  await debit({ db: ctx.db }, {
    userId: args.customerId,
    type: 'SHOP_PURCHASE',
    amount: totalPoints,
    description: `橱窗购买 ${item.title} × ${args.qty}`,
    relatedUserId: listing.therapistUserId,
    metadata: { shopItemId: item.id, qty: args.qty, sku: item.sku },
    idempotencyKey: `shop.${args.customerId}.${item.id}.${Date.now()}`,
  });

  // 创建订单
  const [order] = await ctx.db
    .insert(shopOrders)
    .values({
      orderNo: `SH${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${nanoid(8).toUpperCase()}`,
      customerId: args.customerId,
      therapistId: args.therapistId,
      therapistUserId: listing.therapistUserId,
      shopItemId: args.shopItemId,
      qty: args.qty,
      unitPricePoints: item.pricePoints,
      totalPoints,
      commissionBps,
      therapistCommissionPoints: therapistCommission,
      platformRevenuePoints: platformRevenue,
      status: 'paid',
      commissionStatus: 'PENDING',
      shippingAddressEncrypted: args.shippingAddressEncrypted,
      paidAt: new Date(),
    })
    .returning();

  if (!order) throw HttpError.internal('shop order create failed');

  // 库存 / 销量
  await ctx.db
    .update(shopItems)
    .set({
      stockQty: sql`${shopItems.stockQty} - ${args.qty}`,
      soldCount: sql`${shopItems.soldCount} + ${args.qty}`,
    })
    .where(eq(shopItems.id, item.id));

  await ctx.db
    .update(therapistShopListings)
    .set({ soldCount: sql`${therapistShopListings.soldCount} + ${args.qty}` })
    .where(eq(therapistShopListings.id, listing.id));

  return order;
}

// ──────────────── 送达结算 ────────────────

/**
 * 送达后结算佣金（幂等）
 *
 * - 将 commissionStatus: PENDING → SETTLED
 * - credit 技师积分账户（idempotency key：shop.commission.${orderId}）
 * - 累计 therapistEarnings.shopCommissionCents / availableCents
 * - 置 status='delivered' + deliveredAt=now
 *
 * 若 commissionStatus 已非 PENDING 直接幂等返回。
 */
export async function settleShopOrder(
  ctx: ShopContext,
  args: { orderId: string },
): Promise<void> {
  const order = await ctx.db.query.shopOrders.findFirst({
    where: eq(shopOrders.id, args.orderId),
  });
  if (!order) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'shop order not found');

  // 幂等短路：已结算直接返回
  if (order.commissionStatus !== 'PENDING') return;

  const therapistCommission = order.therapistCommissionPoints;

  if (therapistCommission > 0 && order.therapistUserId) {
    // credit 技师积分（幂等键与下单时保持一致，保证不重复入账）
    await credit({ db: ctx.db }, {
      userId: order.therapistUserId,
      type: 'SHOP_COMMISSION',
      amount: therapistCommission,
      description: `橱窗分成结算 · 订单 ${order.orderNo}`,
      relatedUserId: order.customerId,
      metadata: { shopOrderId: order.id, commissionBps: order.commissionBps },
      idempotencyKey: `shop.commission.${order.id}`,
    });

    // 现金口径累计（1 积分 ≈ 1 cent）
    const commissionCents = Math.floor(therapistCommission * 100 / POINTS_PER_USD);
    await ctx.db
      .insert(therapistEarnings)
      .values({
        therapistUserId: order.therapistUserId,
        availableCents: commissionCents,
        shopCommissionCents: commissionCents,
      })
      .onConflictDoUpdate({
        target: therapistEarnings.therapistUserId,
        set: {
          availableCents: sql`${therapistEarnings.availableCents} + ${commissionCents}`,
          shopCommissionCents: sql`${therapistEarnings.shopCommissionCents} + ${commissionCents}`,
          updatedAt: new Date(),
        },
      });
  }

  // 置结算态 + 送达
  await ctx.db
    .update(shopOrders)
    .set({
      commissionStatus: 'SETTLED',
      status: 'delivered',
      deliveredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(shopOrders.id, order.id));
}

// ──────────────── 退款回滚 ────────────────

/**
 * 退款回滚（幂等）
 *
 * 1. 已 refunded 短路返回
 * 2. credit 退客户积分（idempotencyKey: shop.refund.${orderId}）
 * 3. 回补库存（stockQty+qty，soldCount-qty GREATEST 防负）；listing soldCount 同步
 * 4. 若 commissionStatus=SETTLED 且有佣金：debit 技师积分（ADJUSTMENT）
 *    + earnings availableCents/shopCommissionCents -= cents
 *    余额不足时 debit 会抛错，用 try/catch 捕获后 logger.warn，earnings 依然减
 * 5. 置 status=refunded，commissionStatus=VOID，refundedAt/updatedAt=now
 */
export async function refundShopOrder(
  ctx: ShopContext,
  args: { orderId: string },
): Promise<void> {
  const order = await ctx.db.query.shopOrders.findFirst({
    where: eq(shopOrders.id, args.orderId),
  });
  if (!order) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'shop order not found');

  // 幂等短路
  if (order.status === 'refunded') return;

  const totalPoints = order.totalPoints;

  // 1. 退客户积分
  await credit({ db: ctx.db }, {
    userId: order.customerId,
    type: 'REFUND',
    amount: totalPoints,
    description: `橱窗退款 · 订单 ${order.orderNo}`,
    relatedUserId: order.therapistUserId ?? undefined,
    metadata: { shopOrderId: order.id },
    idempotencyKey: `shop.refund.${order.id}`,
  });

  // 2. 回补库存（防负）
  await ctx.db
    .update(shopItems)
    .set({
      stockQty: sql`${shopItems.stockQty} + ${order.qty}`,
      soldCount: sql`GREATEST(${shopItems.soldCount} - ${order.qty}, 0)`,
    })
    .where(eq(shopItems.id, order.shopItemId));

  // 3. listing soldCount 回补（防负）
  const listing = order.therapistId
    ? await ctx.db.query.therapistShopListings.findFirst({
        where: and(
          eq(therapistShopListings.therapistId, order.therapistId),
          eq(therapistShopListings.shopItemId, order.shopItemId),
        ),
      })
    : null;
  if (listing) {
    await ctx.db
      .update(therapistShopListings)
      .set({ soldCount: sql`GREATEST(${therapistShopListings.soldCount} - ${order.qty}, 0)` })
      .where(eq(therapistShopListings.id, listing.id));
  }

  // 4. 若已结算，扣回技师佣金
  if (order.commissionStatus === 'SETTLED' && order.therapistCommissionPoints > 0 && order.therapistUserId) {
    const commissionCents = Math.floor(order.therapistCommissionPoints * 100 / POINTS_PER_USD);

    // debit 技师积分（余额不足时抛错，捕获后 warn，earnings 依然减）
    try {
      await debit({ db: ctx.db }, {
        userId: order.therapistUserId,
        type: 'ADJUSTMENT',
        amount: order.therapistCommissionPoints,
        description: `橱窗佣金扣回 · 退款订单 ${order.orderNo}`,
        relatedUserId: order.customerId,
        metadata: { shopOrderId: order.id },
        idempotencyKey: `shop.refund.clawback.${order.id}`,
      });
    } catch (err) {
      logger.warn('shop.refund: therapist commission clawback debit failed, manual action required', {
        err,
        orderId: order.id,
        therapistUserId: order.therapistUserId,
        commissionPoints: order.therapistCommissionPoints,
      });
    }

    // earnings 无论 debit 成否都减（积分账户与 earnings 台账分离，保持两侧一致）
    await ctx.db
      .insert(therapistEarnings)
      .values({
        therapistUserId: order.therapistUserId,
        availableCents: 0,
        shopCommissionCents: 0,
      })
      .onConflictDoUpdate({
        target: therapistEarnings.therapistUserId,
        set: {
          availableCents: sql`GREATEST(${therapistEarnings.availableCents} - ${commissionCents}, 0)`,
          shopCommissionCents: sql`GREATEST(${therapistEarnings.shopCommissionCents} - ${commissionCents}, 0)`,
          updatedAt: new Date(),
        },
      });
  }

  // 5. 置退款态
  await ctx.db
    .update(shopOrders)
    .set({
      status: 'refunded',
      commissionStatus: 'VOID',
      refundedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(shopOrders.id, order.id));
}
