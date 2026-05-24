/**
 * 橱窗带货 · M09a
 *
 * - shop_items：平台维护的商品池（情趣用品 / 健康产品等）
 * - therapist_shop_listings：技师选品上架（决定佣金分配权重）
 * - shop_orders：客户从技师橱窗下单
 *
 * 平台不做支付结算（用户对用户）— 但橱窗带货需要支付通道，
 * Phase 4 先用 stub，Phase 5 接 Stripe + Adyen。
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { therapists } from './therapists';

/** 商品池（平台维护） */
export const shopItems = pgTable(
  'shop_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sku: text('sku').notNull().unique(),

    title: text('title').notNull(),
    titleTranslations: jsonb('title_translations').$type<Record<string, string>>(),
    description: text('description'),
    descriptionTranslations: jsonb('description_translations').$type<Record<string, string>>(),

    category: text('category').notNull(), // adult_toys / health / massage_oil / accessory ...
    tags: text('tags').array(),

    // 价格 · 用积分计价，避免跨币种问题
    pricePoints: bigint('price_points', { mode: 'number' }).notNull(),
    costPoints: bigint('cost_points', { mode: 'number' }).default(0).notNull(),

    // 分成（基点，1/10000）
    commissionBpsDefault: integer('commission_bps_default').default(2000).notNull(), // 20%

    // 媒体
    coverUrl: text('cover_url'),
    mediaUrls: text('media_urls').array(),

    // 库存
    stockQty: integer('stock_qty').default(0).notNull(),
    soldCount: integer('sold_count').default(0).notNull(),

    isActive: integer('is_active').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxCategory: index('idx_shop_item_category').on(t.category),
    idxActive: index('idx_shop_item_active').on(t.isActive),
    idxPrice: index('idx_shop_item_price').on(t.pricePoints),
  }),
);

/** 技师上架（哪个技师把哪个商品放进自己的橱窗） */
export const therapistShopListings = pgTable(
  'therapist_shop_listings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    therapistId: uuid('therapist_id').notNull().references(() => therapists.id, { onDelete: 'cascade' }),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    shopItemId: uuid('shop_item_id').notNull().references(() => shopItems.id, { onDelete: 'cascade' }),

    // 自定义介绍
    displayOrder: integer('display_order').default(0).notNull(),
    therapistNote: text('therapist_note'),

    // 个性化分成（覆盖默认）
    commissionBpsOverride: integer('commission_bps_override'),

    // 统计
    impressionsCount: integer('impressions_count').default(0).notNull(),
    clicksCount: integer('clicks_count').default(0).notNull(),
    soldCount: integer('sold_count').default(0).notNull(),

    isActive: integer('is_active').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxPair: uniqueIndex('uidx_listing_pair').on(t.therapistId, t.shopItemId),
    idxTherapist: index('idx_listing_therapist').on(t.therapistId, t.isActive),
    idxItem: index('idx_listing_item').on(t.shopItemId),
  }),
);

/** 橱窗订单 */
export const shopOrders = pgTable(
  'shop_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderNo: text('order_no').notNull().unique(),

    customerId: uuid('customer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    therapistId: uuid('therapist_id').references(() => therapists.id, { onDelete: 'set null' }),
    therapistUserId: uuid('therapist_user_id').references(() => users.id, { onDelete: 'set null' }),
    shopItemId: uuid('shop_item_id').notNull().references(() => shopItems.id, { onDelete: 'restrict' }),

    qty: integer('qty').default(1).notNull(),
    unitPricePoints: bigint('unit_price_points', { mode: 'number' }).notNull(),
    totalPoints: bigint('total_points', { mode: 'number' }).notNull(),

    // 分成快照
    commissionBps: integer('commission_bps').notNull(),
    therapistCommissionPoints: bigint('therapist_commission_points', { mode: 'number' }).default(0).notNull(),
    platformRevenuePoints: bigint('platform_revenue_points', { mode: 'number' }).default(0).notNull(),

    // 状态
    status: text('status').default('pending').notNull(), // pending / paid / shipped / delivered / cancelled / refunded

    // 发货
    shippingAddressEncrypted: text('shipping_address_encrypted'),
    trackingNumber: text('tracking_number'),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),

    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxCustomer: index('idx_shop_order_customer').on(t.customerId, t.createdAt),
    idxTherapist: index('idx_shop_order_therapist').on(t.therapistId, t.createdAt),
    idxItem: index('idx_shop_order_item').on(t.shopItemId),
    idxStatus: index('idx_shop_order_status').on(t.status),
  }),
);

export type ShopItem = typeof shopItems.$inferSelect;
export type NewShopItem = typeof shopItems.$inferInsert;
export type TherapistShopListing = typeof therapistShopListings.$inferSelect;
export type ShopOrder = typeof shopOrders.$inferSelect;
export type NewShopOrder = typeof shopOrders.$inferInsert;
