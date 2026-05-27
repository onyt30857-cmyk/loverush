/**
 * M16 · 积分代理分销
 *
 * 平台只批发积分给代理（USDT 9 折），客户找代理用法币买积分。
 * 代理身份挂在 user_roles（role='agent'）；积分余额复用 points_account。
 * 站内 1 积分 = $0.01 不变；代理批发 USD 面值 = 积分数 × $0.01，USDT 付 = 面值 × 0.9。
 *
 * 详见 v1/modules/M16-积分代理分销.md
 */

import { pgTable, uuid, text, timestamp, bigint, jsonb, boolean, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import {
  agentPaymentMethodTypeEnum,
  agentWholesaleStatusEnum,
  pointPurchaseStatusEnum,
} from './enums';

/** 代理资料（agent 角色挂 user_roles，这里存业务属性） */
export const agentProfiles = pgTable(
  'agent_profiles',
  {
    userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('active'), // active / suspended
    serviceCountries: jsonb('service_countries').$type<string[]>().default([]).notNull(), // ['TH','MY',...]
    serviceCities: jsonb('service_cities').$type<string[]>().default([]).notNull(),
    totalWholesalePoints: bigint('total_wholesale_points', { mode: 'number' }).default(0).notNull(),
    totalSoldPoints: bigint('total_sold_points', { mode: 'number' }).default(0).notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxStatus: index('idx_agent_profiles_status').on(t.status),
  }),
);

/** 代理收款方式（按国家可多条） */
export const agentPaymentMethods = pgTable(
  'agent_payment_methods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentUserId: uuid('agent_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    country: text('country').notNull(), // ISO 国家码 TH/MY/SG/...
    methodType: agentPaymentMethodTypeEnum('method_type').notNull(),
    // bank: {holder,account,bankName,swift?}; alipay/wechat: {account,qrUrl}
    fields: jsonb('fields').$type<Record<string, string>>().notNull(),
    minPurchasePoints: bigint('min_purchase_points', { mode: 'number' }).default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxAgent: index('idx_agent_pm_agent').on(t.agentUserId),
    idxAgentCountry: index('idx_agent_pm_agent_country').on(t.agentUserId, t.country),
  }),
);

/** 客户↔代理 绑定（1:1，按国家/城市自动分配） */
export const agentCustomerAssignment = pgTable(
  'agent_customer_assignment',
  {
    customerUserId: uuid('customer_user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentUserId: uuid('agent_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    country: text('country'),
    assignedBy: text('assigned_by').notNull().default('auto'), // auto / admin
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxAgent: index('idx_aca_agent').on(t.agentUserId),
  }),
);

/** 平台 → 代理 批发单（USDT 9 折，v1 后台手动确认到账） */
export const agentWholesaleOrders = pgTable(
  'agent_wholesale_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentUserId: uuid('agent_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    points: bigint('points', { mode: 'number' }).notNull(),
    usdFaceCents: bigint('usd_face_cents', { mode: 'number' }).notNull(), // 积分 × $0.01 = 积分（cents）
    usdtAmountCents: bigint('usdt_amount_cents', { mode: 'number' }).notNull(), // 面值 × 0.9
    usdtTxnRef: text('usdt_txn_ref'),
    status: agentWholesaleStatusEnum('status').notNull().default('pending'),
    confirmedBy: uuid('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    pointsTxnId: uuid('points_txn_id'), // 确认后入账的 points_transaction id
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxAgent: index('idx_awo_agent').on(t.agentUserId),
    idxStatus: index('idx_awo_status').on(t.status),
  }),
);

/** 代理 → 客户 购买单（核心凭证，平台不碰钱只留证 + 可仲裁） */
export const pointPurchaseOrders = pgTable(
  'point_purchase_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerUserId: uuid('customer_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    agentUserId: uuid('agent_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    points: bigint('points', { mode: 'number' }).notNull(),
    localAmount: text('local_amount'), // 当地法币金额（字符串保精度）
    localCurrency: text('local_currency'),
    paymentMethodId: uuid('payment_method_id').references(() => agentPaymentMethods.id, { onDelete: 'set null' }),
    methodSnapshot: jsonb('method_snapshot').$type<Record<string, unknown>>(), // 下单时收款方式快照
    customerPaidProofUrl: text('customer_paid_proof_url'),
    status: pointPurchaseStatusEnum('status').notNull().default('created'),
    transferTxnId: uuid('transfer_txn_id'), // transfer() 落的 credit txn id
    disputeStatus: text('dispute_status'), // null / open / resolved
    customerPaidAt: timestamp('customer_paid_at', { withTimezone: true }),
    agentConfirmedAt: timestamp('agent_confirmed_at', { withTimezone: true }),
    pointsSentAt: timestamp('points_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxCustomer: index('idx_ppo_customer').on(t.customerUserId, t.createdAt),
    idxAgentStatus: index('idx_ppo_agent_status').on(t.agentUserId, t.status),
  }),
);

export type AgentProfile = typeof agentProfiles.$inferSelect;
export type NewAgentProfile = typeof agentProfiles.$inferInsert;
export type AgentPaymentMethod = typeof agentPaymentMethods.$inferSelect;
export type NewAgentPaymentMethod = typeof agentPaymentMethods.$inferInsert;
export type AgentCustomerAssignment = typeof agentCustomerAssignment.$inferSelect;
export type NewAgentCustomerAssignment = typeof agentCustomerAssignment.$inferInsert;
export type AgentWholesaleOrder = typeof agentWholesaleOrders.$inferSelect;
export type NewAgentWholesaleOrder = typeof agentWholesaleOrders.$inferInsert;
export type PointPurchaseOrder = typeof pointPurchaseOrders.$inferSelect;
export type NewPointPurchaseOrder = typeof pointPurchaseOrders.$inferInsert;
