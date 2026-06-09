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
  pointsTransaction,
  type ShopItem,
  type ShopOrder,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { debit, credit, type PointsContext } from './points';
import { logger, fireAndForget } from './logger';
import { nanoid } from 'nanoid';
import { enqueue, type NotifyContext } from './notifications';

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
      // 空 country_codes = 全球可售(不限国家);仅当配置了国家且不含本国才排除
      q.countryCode
        ? sql`(cardinality(${shopItems.countryCodes}) = 0 OR ${q.countryCode} = ANY(${shopItems.countryCodes}))`
        : undefined,
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
  countryCode?: string,
): Promise<Array<{ listing: typeof therapistShopListings.$inferSelect; item: ShopItem }>> {
  const listings = await ctx.db.query.therapistShopListings.findMany({
    where: and(eq(therapistShopListings.therapistId, therapistId), eq(therapistShopListings.isActive, 1)),
    orderBy: [desc(therapistShopListings.displayOrder), desc(therapistShopListings.soldCount)],
  });
  const itemIds = listings.map((l) => l.shopItemId);
  if (!itemIds.length) return [];
  const items = await ctx.db.query.shopItems.findMany({
    where: (i, { inArray, and: iAnd }) =>
      iAnd(
        inArray(i.id, itemIds),
        // 空 country_codes = 全球可售(不限国家);仅当配置了国家且不含本国才排除
        countryCode
          ? sql`(cardinality(${shopItems.countryCodes}) = 0 OR ${countryCode} = ANY(${shopItems.countryCodes}))`
          : undefined,
      ),
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
    requestId?: string;
  },
): Promise<ShopOrder> {
  const requestId = args.requestId ?? nanoid(12);
  const idempotencyKey = `shop.order.${requestId}`;

  // 幂等检查优先：同一 request_id 已有扣款流水则直接返回对应订单（跳过库存等校验）
  if (args.requestId) {
    const existingTxn = await ctx.db.query.pointsTransaction.findFirst({
      where: and(eq(pointsTransaction.userId, args.customerId), eq(pointsTransaction.idempotencyKey, idempotencyKey)),
    });
    if (existingTxn) {
      const meta = existingTxn.metadata as Record<string, unknown> | null;
      const shopOrderId = meta?.shopOrderId as string | undefined;
      if (shopOrderId) {
        const existing = await ctx.db.query.shopOrders.findFirst({ where: eq(shopOrders.id, shopOrderId) });
        if (existing) return existing;
      }
      // 兜底：找不到订单就继续正常流程（理论上不会走到）
    }
  }

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

  // 扣积分 + 建订单 + 扣库存 原子事务
  const order = await ctx.db.transaction(async (tx) => {
    // 先建订单（在 debit 之前，这样可以将 orderId 存入 debit metadata 供幂等查找）
    const [created] = await tx
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

    if (!created) throw HttpError.internal('shop order create failed');

    // 扣客户积分（传 tx 使 debit 内部 savepoint 嵌套在同一事务；metadata 含 shopOrderId 供幂等查找）
    await debit({ db: tx as unknown as Database }, {
      userId: args.customerId,
      type: 'SHOP_PURCHASE',
      amount: totalPoints,
      description: `橱窗购买 ${item.title} × ${args.qty}`,
      relatedUserId: listing.therapistUserId,
      metadata: { shopItemId: item.id, qty: args.qty, sku: item.sku, shopOrderId: created.id },
      idempotencyKey,
    });

    // 库存 / 销量
    await tx
      .update(shopItems)
      .set({
        stockQty: sql`${shopItems.stockQty} - ${args.qty}`,
        soldCount: sql`${shopItems.soldCount} + ${args.qty}`,
      })
      .where(eq(shopItems.id, item.id));

    await tx
      .update(therapistShopListings)
      .set({ soldCount: sql`${therapistShopListings.soldCount} + ${args.qty}` })
      .where(eq(therapistShopListings.id, listing.id));

    return created;
  });

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

  // refunded 单不可 settle/deliver
  if (order.status === 'refunded') {
    throw HttpError.badRequest(ErrorCode.E3050_ORDER_STATE_ILLEGAL, 'cannot settle a refunded order');
  }

  // 幂等短路：已结算直接返回
  if (order.commissionStatus !== 'PENDING') return;

  const therapistCommission = order.therapistCommissionPoints;

  // credit + earnings upsert + 置态 原子事务
  await ctx.db.transaction(async (tx) => {
    if (therapistCommission > 0 && order.therapistUserId) {
      // credit 技师积分（传 tx，savepoint 嵌套）
      await credit({ db: tx as unknown as Database }, {
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
      await tx
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
    await tx
      .update(shopOrders)
      .set({
        commissionStatus: 'SETTLED',
        status: 'delivered',
        deliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shopOrders.id, order.id));
  });

  // 送达通知（脱敏，技师佣金由 credit → maybeNotifyWallet 自动发，不重复）
  fireAndForget(
    enqueue({ db: ctx.db }, {
      recipientUserId: order.customerId,
      level: 'important',
      category: 'order_status',
      title: '你的订单已送达',
      body: `你的成人用品订单已送达 · 订单 ${order.orderNo}`,
      refType: 'shop_order',
      refId: order.id,
      deepLink: '/me/shop-orders',
    }),
    'shop.notify.delivered_failed',
    { orderId: order.id },
  );
}

// ──────────────── admin 商品管理 ────────────────

export async function createShopItem(
  ctx: ShopContext,
  args: {
    sku: string;
    title: string;
    category: string;
    pricePoints: number;
    costPoints?: number;
    commissionBpsDefault?: number;
    stockQty?: number;
    countryCodes?: string[];
    coverUrl?: string;
    mediaUrls?: string[];
    isActive?: number;
  },
): Promise<ShopItem> {
  const [item] = await ctx.db
    .insert(shopItems)
    .values({
      sku: args.sku,
      title: args.title,
      category: args.category,
      pricePoints: args.pricePoints,
      costPoints: args.costPoints ?? 0,
      commissionBpsDefault: args.commissionBpsDefault ?? 2000,
      stockQty: args.stockQty ?? 0,
      countryCodes: args.countryCodes ?? [],
      coverUrl: args.coverUrl,
      mediaUrls: args.mediaUrls,
      isActive: args.isActive ?? 1,
    })
    .returning();
  if (!item) throw HttpError.internal('shop item create failed');
  return item;
}

export async function updateShopItem(
  ctx: ShopContext,
  id: string,
  patch: Partial<{
    title: string;
    category: string;
    pricePoints: number;
    costPoints: number;
    commissionBpsDefault: number;
    stockQty: number;
    countryCodes: string[];
    coverUrl: string;
    mediaUrls: string[];
    isActive: number;
  }>,
): Promise<ShopItem> {
  const [item] = await ctx.db
    .update(shopItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(shopItems.id, id))
    .returning();
  if (!item) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'shop item not found');
  return item;
}

export async function markShipped(
  ctx: ShopContext,
  args: { orderId: string; trackingNumber?: string },
): Promise<void> {
  const order = await ctx.db.query.shopOrders.findFirst({ where: eq(shopOrders.id, args.orderId) });
  if (!order) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'shop order not found');

  // 只允许 paid/shipped 状态发货；refunded/cancelled 不可标发货
  if (order.status === 'refunded' || order.status === 'cancelled') {
    throw HttpError.badRequest(ErrorCode.E3050_ORDER_STATE_ILLEGAL, `cannot mark shipped: order status is ${order.status}`);
  }
  if (order.status === 'delivered') {
    throw HttpError.badRequest(ErrorCode.E3050_ORDER_STATE_ILLEGAL, 'order already delivered');
  }

  await ctx.db
    .update(shopOrders)
    .set({
      status: 'shipped',
      shippedAt: new Date(),
      trackingNumber: args.trackingNumber ?? null,
      updatedAt: new Date(),
    })
    .where(eq(shopOrders.id, args.orderId));

  // 发货通知（脱敏：不含具体商品名，只提类目和订单号）
  const trackingHint = args.trackingNumber ? ` · 快递单号 ${args.trackingNumber}` : '';
  fireAndForget(
    enqueue({ db: ctx.db }, {
      recipientUserId: order.customerId,
      level: 'important',
      category: 'order_status',
      title: '你的订单已发货',
      body: `你的成人用品订单已发货 · 订单 ${order.orderNo}${trackingHint}`,
      refType: 'shop_order',
      refId: order.id,
      deepLink: '/me/shop-orders',
    }),
    'shop.notify.shipped_failed',
    { orderId: order.id },
  );
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

  // 先查 listing（在事务外查，避免 tx 内 relation query 方式不同）
  const listing = order.therapistId
    ? await ctx.db.query.therapistShopListings.findFirst({
        where: and(
          eq(therapistShopListings.therapistId, order.therapistId),
          eq(therapistShopListings.shopItemId, order.shopItemId),
        ),
      })
    : null;

  // 主事务：1. 退客户积分 + 2. 回补库存 + 3. listing 回补 + 5. 置退款态
  await ctx.db.transaction(async (tx) => {
    // 1. 退客户积分（传 tx，savepoint 嵌套）
    await credit({ db: tx as unknown as Database }, {
      userId: order.customerId,
      type: 'REFUND',
      amount: totalPoints,
      description: `橱窗退款 · 订单 ${order.orderNo}`,
      relatedUserId: order.therapistUserId ?? undefined,
      metadata: { shopOrderId: order.id },
      idempotencyKey: `shop.refund.${order.id}`,
    });

    // 2. 回补库存（防负）
    await tx
      .update(shopItems)
      .set({
        stockQty: sql`${shopItems.stockQty} + ${order.qty}`,
        soldCount: sql`GREATEST(${shopItems.soldCount} - ${order.qty}, 0)`,
      })
      .where(eq(shopItems.id, order.shopItemId));

    // 3. listing soldCount 回补（防负）
    if (listing) {
      await tx
        .update(therapistShopListings)
        .set({ soldCount: sql`GREATEST(${therapistShopListings.soldCount} - ${order.qty}, 0)` })
        .where(eq(therapistShopListings.id, listing.id));
    }

    // 5. 置退款态
    await tx
      .update(shopOrders)
      .set({
        status: 'refunded',
        commissionStatus: 'VOID',
        refundedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shopOrders.id, order.id));
  });

  // 4. 若已结算，扣回技师佣金（独立执行：debit 可失败不影响主退款事务）
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
}
