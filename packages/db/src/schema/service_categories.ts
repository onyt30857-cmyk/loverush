/**
 * M02b/M04 Phase 1 · 服务类型字典
 *
 * Admin 维护的服务类型枚举(平台预设默认 6 种 · 可加减)
 * 技师发布节目时必须从这里选 categoryCode
 *
 * 默认 6 种(seed):
 *   thai / oil / chinese_tuina / spa / foot / shiatsu
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const serviceCategories = pgTable(
  'service_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull().unique(), // 'thai' / 'oil' / ... 程序用
    nameZh: text('name_zh').notNull(),
    nameEn: text('name_en').notNull(),
    description: text('description'),
    iconEmoji: text('icon_emoji'),
    displayOrder: integer('display_order').default(0).notNull(),
    isActive: integer('is_active').default(1).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxActive: index('idx_service_categories_active').on(t.isActive, t.displayOrder),
  }),
);

export type ServiceCategory = typeof serviceCategories.$inferSelect;
export type NewServiceCategory = typeof serviceCategories.$inferInsert;
