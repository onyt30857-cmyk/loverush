/**
 * M02b/M04 Phase 1 · 技师发布的服务节目(shows)
 *
 * v1 PRD 文档 M04 F04.2 定义的核心载体:
 *   技师挂"今晚 20:00 泰式 60min 600pts 剩 3 名额" → 客户抢拍
 *
 * 状态机: draft → open → closed / completed
 *   draft: 仅技师可见 · 可任意编辑
 *   open: 公开 · 可被客户拍 · 仅 add_ons 可改
 *   closed: 技师主动下架 或 slots 售罄
 *   completed: 服务时段已过 · cron 自动流转(本期靠 query 时 filter)
 *
 * 加项(add_ons)直接存 jsonb · M07 文档 price_lock.add_ons 设计就是 array
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const shows = pgTable(
  'shows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    // 服务类型(软关联 service_categories.code · 字符串 FK 简化)
    categoryCode: text('category_code').notNull(),

    // 时段
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    durationMin: integer('duration_min').notNull(), // 60/90/120/150/180

    // 价格(积分)
    pricePoints: integer('price_points').notNull(),

    // 加项 · M07 price_lock.add_ons
    addOns: jsonb('add_ons')
      .$type<Array<{ name: string; pricePoints: number; isDefault?: boolean }>>()
      .default([])
      .notNull(),

    // 套餐含项/不含项(技师手写 · 客户看到)
    includesNote: text('includes_note'),
    excludesNote: text('excludes_note'),

    // 名额(防超卖)
    slotsTotal: integer('slots_total').default(1).notNull(),
    slotsRemaining: integer('slots_remaining').default(1).notNull(),

    // 位置
    serviceCity: text('service_city'),
    serviceArea: text('service_area'),

    // 状态
    status: text('status').default('draft').notNull(), // draft/open/closed/completed

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxTherapistStatus: index('idx_shows_therapist_status').on(t.therapistUserId, t.status),
    idxOpenStartTime: index('idx_shows_open_start').on(t.startTime, t.status),
    idxCategoryStartTime: index('idx_shows_category_start').on(t.categoryCode, t.startTime),
  }),
);

export type Show = typeof shows.$inferSelect;
export type NewShow = typeof shows.$inferInsert;
