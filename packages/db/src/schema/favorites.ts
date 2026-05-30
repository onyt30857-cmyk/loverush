/**
 * 客户收藏技师 · M02 Phase 6
 *
 * 联合主键(customerId, therapistId)· 一行=一个收藏关系
 * 客户视角:GET /me/favorites 列收藏夹
 * 技师视角:本期不暴露被谁收藏(隐私 · Phase 2+ 再说)
 */

import { pgTable, uuid, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users';
import { therapists } from './therapists';

export const favorites = pgTable(
  'favorites',
  {
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    therapistId: uuid('therapist_id')
      .notNull()
      .references(() => therapists.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.customerId, t.therapistId] }),
    idxCustomer: index('idx_favorites_customer').on(t.customerId, t.createdAt),
    idxTherapist: index('idx_favorites_therapist').on(t.therapistId),
  }),
);

export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;
