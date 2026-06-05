/**
 * M16 P1 · 积分回收（持有人 → 代理 变现）
 *
 * 客户/技师把积分卖回代理换法币。平台冻结担保:持有人积分发起即冻结,代理线下付款后
 * 持有人确认到账,积分释放给代理库存。平台不碰法币,只留凭证 + 可仲裁。
 * 回收价 = 积分面值 × 代理公示回收率(rate_bps),发起时锁定快照。
 * 流水类型 AGENT_REDEEM_OUT(持有人扣) / AGENT_REDEEM_IN(代理收) 已在 0038 预加。
 */
import { pgTable, uuid, text, timestamp, bigint, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { pointRedeemStatusEnum } from './enums';

export const pointRedeemOrders = pgTable(
  'point_redeem_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    holderUserId: uuid('holder_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    agentUserId: uuid('agent_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    points: bigint('points', { mode: 'number' }).notNull(),
    // 回收价快照（发起时按代理公示回收率锁定，平台不碰钱只留证）
    rateBps: integer('rate_bps').notNull(), // 锁定回收率（8000=80%）
    payoutAmount: text('payout_amount').notNull(), // 应付法币金额（字符串保精度）
    payoutCurrency: text('payout_currency').notNull(),
    // 持有人收款方式快照（钱付到哪）
    payoutMethodType: text('payout_method_type').notNull(), // bank/usdt_trc20/promptpay/...
    payoutMethodFields: jsonb('payout_method_fields').$type<Record<string, string>>().notNull(),
    status: pointRedeemStatusEnum('status').notNull().default('created'),
    frozenTxnId: uuid('frozen_txn_id'), // 发起时冻结的 points_transaction id
    transferTxnId: uuid('transfer_txn_id'), // 完成时转给代理的 txn id
    agentPaidProofUrl: text('agent_paid_proof_url'), // 代理付款凭证
    disputeStatus: text('dispute_status'), // null / open / resolved
    agentAcceptedAt: timestamp('agent_accepted_at', { withTimezone: true }),
    agentPaidAt: timestamp('agent_paid_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxHolder: index('idx_pro_holder').on(t.holderUserId, t.createdAt),
    idxAgentStatus: index('idx_pro_agent_status').on(t.agentUserId, t.status),
  }),
);

export type PointRedeemOrder = typeof pointRedeemOrders.$inferSelect;
export type NewPointRedeemOrder = typeof pointRedeemOrders.$inferInsert;
