/**
 * 法币 + 心动金 业务模型 · 0027 migration
 *
 * 核心概念:
 *   - currencies        法币字典(THB/SGD/MYR/IDR/USD)
 *   - country_currencies 国家→默认法币 lookup
 *   - exchange_rates    法币↔积分汇率(admin 手动改 · 时间倒序拿最新)
 *   - order_deposits    心动金状态机(HOLDING/RELEASED/FORFEITED_*/REFUNDED)
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  numeric,
  index,
} from 'drizzle-orm/pg-core';
import { orders } from './orders';

/** 法币字典 · admin 维护 */
export const currencies = pgTable('currencies', {
  code: text('code').primaryKey(),           // 'THB' / 'SGD' / 'MYR' / 'IDR' / 'USD'
  symbol: text('symbol').notNull(),          // '฿' / 'S$' / 'RM' / 'Rp' / '$'
  nameZh: text('name_zh').notNull(),
  nameEn: text('name_en').notNull(),
  decimals: integer('decimals').default(2).notNull(),
  displayOrder: integer('display_order').default(100).notNull(),
  isActive: integer('is_active').default(1).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** 国家→默认法币(从 GPS 国家码自动 select default currency) */
export const countryCurrencies = pgTable('country_currencies', {
  countryCode: text('country_code').primaryKey(), // 'TH' / 'SG' / 'MY' / 'ID'(ISO alpha-2)
  defaultCurrency: text('default_currency').notNull(),
});

/** 汇率(法币→积分)· 同 currency 多条记录 · 按 effective_at 倒序拿最新 */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    currencyCode: text('currency_code').notNull(),
    // 1 单位法币 = N 积分(numeric 高精度 · 防 float 误差)
    pointsPerUnit: numeric('points_per_unit', { precision: 12, scale: 4 }).notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).defaultNow().notNull(),
    updatedByUserId: uuid('updated_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxCurrencyEffective: index('idx_fx_currency_effective').on(t.currencyCode, t.effectiveAt),
  }),
);

/** 心动金状态机 · 一笔订单一条记录 */
export const orderDeposits = pgTable(
  'order_deposits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull(),
    therapistUserId: uuid('therapist_user_id').notNull(),
    depositPoints: bigint('deposit_points', { mode: 'number' }).notNull(),
    /**
     * HOLDING            已冻结 · 等服务完成
     * RELEASED           服务完成 · 退客户(frozen-=)
     * FORFEITED_TO_THERAPIST 客户鸽子 · 50% 给技师
     * FORFEITED_TO_PLATFORM  客户鸽子 · 50% 给平台收入
     * REFUNDED           技师鸽子 · 全退客户 + 技师降分
     */
    status: text('status').default('HOLDING').notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    /** auto_complete / customer_no_show / therapist_no_show / dispute_admin */
    resolution: text('resolution'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxOrder: index('idx_deposits_order').on(t.orderId),
    idxStatus: index('idx_deposits_status').on(t.status),
  }),
);

export type Currency = typeof currencies.$inferSelect;
export type NewCurrency = typeof currencies.$inferInsert;
export type CountryCurrency = typeof countryCurrencies.$inferSelect;
export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type NewExchangeRate = typeof exchangeRates.$inferInsert;
export type OrderDeposit = typeof orderDeposits.$inferSelect;
export type NewOrderDeposit = typeof orderDeposits.$inferInsert;
