/**
 * 客户偏好（会话级 + 长期主偏好）· 对应 PRD §4.3.6
 *
 * - customer_preferences：本次会话临时偏好（短时效，由 AI 分身用）
 * - customer_master_preferences：长期主偏好（用户主动设置 / 长期沉淀）
 */

import { pgTable, uuid, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';

/** 会话级偏好（短时效） */
export const customerPreferences = pgTable(
  'customer_preferences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    sessionToken: text('session_token').notNull(), // 关联到 sessions.id 或独立会话
    preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull(),

    sourceType: text('source_type').notNull(), // user_input / ai_inferred / system_default
    confidenceScore: integer('confidence_score').default(50).notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxUser: index('idx_cust_pref_user').on(t.userId),
    idxExpires: index('idx_cust_pref_expires').on(t.expiresAt),
  }),
);

/** 长期主偏好（用户主动设置 / 长期沉淀） */
export const customerMasterPreferences = pgTable(
  'customer_master_preferences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),

    // 风格偏好（多选）
    bodyTypePrefs: text('body_type_prefs').array(),
    serviceStylePrefs: text('service_style_prefs').array(),
    communicationStyle: text('communication_style'), // 温柔 / 直接 / 调皮
    languagePrefs: text('language_prefs').array(), // zh / th / en

    // 商业偏好
    priceSensitivity: integer('price_sensitivity').default(50).notNull(), // 0-100
    budgetRangeMinPoints: integer('budget_range_min_points'),
    budgetRangeMaxPoints: integer('budget_range_max_points'),

    // 时间偏好
    preferredTimeSlots: jsonb('preferred_time_slots').$type<Array<{ day: string; from: string; to: string }>>(),

    // 隐私设置
    privacyLevel: integer('privacy_level').default(2).notNull(), // 1=低 / 2=中 / 3=高
    allowAiInfer: integer('allow_ai_infer').default(1).notNull(),

    // 扩展字段
    extraPrefs: jsonb('extra_prefs').$type<Record<string, unknown>>().default({}),

    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxUser: index('idx_master_pref_user').on(t.userId),
  }),
);

export type CustomerPreference = typeof customerPreferences.$inferSelect;
export type NewCustomerPreference = typeof customerPreferences.$inferInsert;
export type CustomerMasterPreference = typeof customerMasterPreferences.$inferSelect;
export type NewCustomerMasterPreference = typeof customerMasterPreferences.$inferInsert;
