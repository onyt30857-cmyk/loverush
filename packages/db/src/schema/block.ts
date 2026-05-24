/**
 * 一键封锁 · M03 F03.27
 *
 * 客户可以一键封锁某个技师（互不可见 / 不可派单 / 不可私聊）。
 * 反向：技师也可封锁某客户。
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const blockList = pgTable(
  'block_list',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    blockerUserId: uuid('blocker_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    blockedUserId: uuid('blocked_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxPair: uniqueIndex('uidx_block_pair').on(t.blockerUserId, t.blockedUserId),
    idxBlocker: index('idx_block_blocker').on(t.blockerUserId),
    idxBlocked: index('idx_block_blocked').on(t.blockedUserId),
  }),
);

export type BlockEntry = typeof blockList.$inferSelect;
export type NewBlockEntry = typeof blockList.$inferInsert;
