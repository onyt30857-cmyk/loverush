/**
 * M18 心动陪伴（陪聊付费）
 *
 * companion_actions：亲密动作目录 · 价格/分成配置驱动（seed/admin 设值，代码不硬编码）
 * intimacy：客户 × 技师 亲密度 · 经验值累积 → 等级
 */
import { pgTable, uuid, text, integer, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users';

export const companionActions = pgTable('companion_actions', {
  code: text('code').primaryKey(),
  actionType: text('action_type').notNull(),
  pricePoints: integer('price_points').notNull(),
  revenueShareBps: integer('revenue_share_bps').notNull().default(7000),
  expReward: integer('exp_reward').notNull().default(10),
  isActive: integer('is_active').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const intimacy = pgTable(
  'intimacy',
  {
    customerId: uuid('customer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    exp: integer('exp').notNull().default(0),
    level: integer('level').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.customerId, t.therapistUserId] }),
    idxTherapist: index('idx_intimacy_therapist').on(t.therapistUserId),
  }),
);
