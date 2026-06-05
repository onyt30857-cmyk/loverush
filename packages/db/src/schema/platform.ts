/**
 * 平台级收款账户 · M16 批发采购用
 *
 * 代理向平台采购积分（批发）时,平台公示这些收款账户（USDT-TRC20 地址等）。
 * 代理按 label 选账户转账 → 填 txn hash → admin 链上核对后确认/驳回批发单。
 * 后台可配多条（不同链/币种），isActive 控制对代理可见。
 */
import { pgTable, uuid, text, integer, jsonb, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const platformReceivingAccounts = pgTable(
  'platform_receiving_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    methodType: text('method_type').notNull(), // usdt_trc20 / bank / ...
    label: text('label').notNull(), // 显示名,如 "USDT-TRC20 主收款"
    fields: jsonb('fields').$type<Record<string, string>>().notNull(), // {address} / {bank...}
    isActive: boolean('is_active').default(true).notNull(),
    displayOrder: integer('display_order').default(0).notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxActive: index('idx_pra_active').on(t.isActive, t.displayOrder),
  }),
);

export type PlatformReceivingAccount = typeof platformReceivingAccounts.$inferSelect;
export type NewPlatformReceivingAccount = typeof platformReceivingAccounts.$inferInsert;
