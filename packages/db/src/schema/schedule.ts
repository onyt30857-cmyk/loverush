/**
 * 技师排班(M07)
 *
 * 三件套:
 *   1. therapist_working_hours · 每周固定排班(7 行/技师)
 *   2. therapist_unavailable_period · 临时挡时段(覆盖 recurring)
 *   3. therapists 表加 slot/buffer 列(在 therapists.ts 内扩展)
 *
 * 可约时段计算:
 *   all_slots = generate(working_hours[weekday], slot_minutes)
 *   booked    = orders WHERE therapist_user_id=X AND scheduled_at::date = Y
 *   blocked   = unavailable_period OVERLAPS day
 *   available = all_slots - booked(含 duration + buffer)- blocked
 */

import {
  pgTable, uuid, smallint, time, timestamp, text, boolean, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';

// ────────────────── 每周固定排班 ──────────────────

export const therapistWorkingHours = pgTable(
  'therapist_working_hours',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    therapistUserId: uuid('therapist_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 0=Sunday · 6=Saturday(对齐 JS Date.getDay) */
    weekday: smallint('weekday').notNull(),
    /** 'HH:MM:SS' 当地时间(技师 service_city 时区) */
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    /** 关闭此天 · 不接单 · isActive=false 等同未配置 */
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    /** 每 (技师, weekday) 唯一 · 7 行/技师 */
    uniq: uniqueIndex('uniq_working_hours_therapist_weekday').on(t.therapistUserId, t.weekday),
    idxTherapist: index('idx_working_hours_therapist').on(t.therapistUserId),
  }),
);

export type TherapistWorkingHours = typeof therapistWorkingHours.$inferSelect;
export type NewTherapistWorkingHours = typeof therapistWorkingHours.$inferInsert;

// ────────────────── 临时挡时段 / 休假 ──────────────────

export const therapistUnavailablePeriod = pgTable(
  'therapist_unavailable_period',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    therapistUserId: uuid('therapist_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** UTC 时间戳 · 客户端按 service_city 时区显示 */
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    /** '休假' / '生病' / '私事' / '其它' · 仅技师自己可见 */
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxTherapist: index('idx_unavail_therapist').on(t.therapistUserId),
    /** 查"某日期是否有 unavailable" · 按 therapist + range 索引 */
    idxRange: index('idx_unavail_range').on(t.therapistUserId, t.startAt, t.endAt),
  }),
);

export type TherapistUnavailablePeriod = typeof therapistUnavailablePeriod.$inferSelect;
export type NewTherapistUnavailablePeriod = typeof therapistUnavailablePeriod.$inferInsert;
