import { pgTable, uuid, text, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * 平台收入流水 · 各抽成点差额统一入账。
 *
 * 此前所有抽成(陪聊30%/媒体30%/打赏12%/解锁/心动金罚没)的差额都"算了不入账"、
 * 从积分账本蒸发,平台收入不可对账。本表把每笔差额记一行 → 可对账、可报表。
 *
 * source 用 text(不用 enum,避免枚举漂移坑);(source, ref_id) 唯一 → 幂等防重。
 * amount 为正数积分。不动用户 points 账本,只做平台侧收入记录。
 */
export const platformRevenue = pgTable(
  'platform_revenue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    source: text('source').notNull(), // chat_pass / companion / chat_media / tip / paywall / deposit_forfeit / shop
    amount: integer('amount').notNull(), // 平台收入积分(正数)
    refId: text('ref_id').notNull(), // 来源单/会话/动作 id(与 source 一起幂等)
    customerUserId: uuid('customer_user_id').references(() => users.id, { onDelete: 'set null' }),
    therapistUserId: uuid('therapist_user_id').references(() => users.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqSourceRef: uniqueIndex('uq_platform_revenue_source_ref').on(t.source, t.refId),
    idxCreated: index('idx_platform_revenue_created').on(t.createdAt),
    idxSource: index('idx_platform_revenue_source').on(t.source, t.createdAt),
  }),
);
