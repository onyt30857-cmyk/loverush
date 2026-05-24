/**
 * 橱窗带货 · M09a
 *
 * - 商品池 list / 详情（admin 维护，技师选品上架）
 * - 技师上架 / 下架
 * - 客户下单（扣积分 + 分成结算 + 库存扣减）
 */

import { and, eq, sql, desc } from 'drizzle-orm';
import {
  Database,
  shopItems,
  therapistShopListings,
  shopOrders,
  therapistEarnings,
  therapists,
  type ShopItem,
  type ShopOrder,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { debit, credit, type PointsContext } from './points';
import { nanoid } from 'nanoid';

export interface ShopContext {
  db: Database;
}

const POINTS_PER_USD = 100;

// ──────────────── 商品池 ────────────────

export async function listShopItems(
  ctx: ShopContext,
  q: { category?: string; limit?: number; offset?: number },
): Promise<ShopItem[]> {
  return ctx.db.query.shopItems.findMany({
    where: and(eq(shopItems.isActive, 1), q.category ? eq(shopItems.category, q.category) : undefined),
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

  const totalPoints = item.pricePoints * args.qty;
  const commissionBps = listing.commissionBpsOverride ?? item.commissionBpsDefault;
  const therapistCommission = Math.floor((totalPoints * commissionBps) / 10000);
  const platformRevenue = totalPoints - therapistCommission;

  // 扣客户积分
  await debit({ db: ctx.db } as PointsContext, {
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
      shippingAddressEncrypted: args.shippingAddressEncrypted,
      paidAt: new Date(),
    })
    .returning();

  if (!order) throw HttpError.internal('shop order create failed');

  // 技师分成（同时入积分账户 + 现金提现账户）
  if (therapistCommission > 0) {
    await credit({ db: ctx.db } as PointsContext, {
      userId: listing.therapistUserId,
      type: 'SHOP_COMMISSION',
      amount: therapistCommission,
      description: `橱窗分成 · ${item.title} × ${args.qty}`,
      relatedUserId: args.customerId,
      metadata: { shopOrderId: order.id, commissionBps },
      idempotencyKey: `shop.commission.${order.id}`,
    });

    // 现金口径累计（积分 → USD cents 换算 · 1 积分 ≈ 1 cent）
    const commissionCents = Math.floor(therapistCommission * 100 / POINTS_PER_USD);
    await ctx.db
      .insert(therapistEarnings)
      .values({
        therapistUserId: listing.therapistUserId,
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
