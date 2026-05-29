/**
 * 地理位置中枢 · M02 Phase 5
 *
 * 三张表(运营字典 + 用户偏好):
 * 1. cities                       城市字典(code + 6 语种 translations + 中心坐标)
 * 2. areas                        区域字典(隶属 city · 二级)
 * 3. user_location_preference     客户位置偏好(独立表 · 不污染 users)
 *
 * 设计:
 *  - 多语言用 jsonb translations · 一行存 6 语种 · 不开 i18n 文案表
 *  - 中心坐标(lat/lng) 给 Phase 2 GPS 用 · 本期可不填
 *  - therapists.serviceCity text 字段保留(双写过渡)· Phase 5 新加 serviceCityId uuid
 */

import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

// ─────────────────── 1. 城市字典 ───────────────────

export const cities = pgTable(
  'cities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** 'bangkok' / 'chiang-mai' · URL/log 友好 stable slug */
    code: text('code').notNull(),
    /** ISO 国家码 · 'TH' / 'MY' / 'VN' / 'ID' */
    countryCode: text('country_code').notNull(),
    /** 6 语种翻译 · { zh: '曼谷', en: 'Bangkok', th: 'กรุงเทพ', ... } */
    translations: jsonb('translations').$type<Record<string, string>>().notNull().default({}),
    /** 中心坐标(numeric 字符串 · 避精度损失)· Phase 2 GPS 用 */
    latCenter: text('lat_center'),
    lngCenter: text('lng_center'),
    sortOrder: integer('sort_order').notNull().default(100),
    enabled: integer('enabled').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxCode: uniqueIndex('uidx_cities_code').on(t.code),
    idxCountrySort: index('idx_cities_country_sort').on(t.countryCode, t.sortOrder),
    idxEnabledSort: index('idx_cities_enabled_sort').on(t.enabled, t.sortOrder),
  }),
);

export type City = typeof cities.$inferSelect;
export type NewCity = typeof cities.$inferInsert;

// ─────────────────── 2. 区域字典 ───────────────────

export const areas = pgTable(
  'areas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    /** 'asok' / 'thonglor' (city 内唯一) */
    code: text('code').notNull(),
    translations: jsonb('translations').$type<Record<string, string>>().notNull().default({}),
    latCenter: text('lat_center'),
    lngCenter: text('lng_center'),
    sortOrder: integer('sort_order').notNull().default(100),
    enabled: integer('enabled').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxCityCode: uniqueIndex('uidx_areas_city_code').on(t.cityId, t.code),
    idxCityEnabledSort: index('idx_areas_city_enabled_sort').on(t.cityId, t.enabled, t.sortOrder),
  }),
);

export type Area = typeof areas.$inferSelect;
export type NewArea = typeof areas.$inferInsert;

// ─────────────────── 3. 客户位置偏好 ───────────────────

export const userLocationPreference = pgTable('user_location_preference', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  cityId: uuid('city_id').references(() => cities.id, { onDelete: 'set null' }),
  areaId: uuid('area_id').references(() => areas.id, { onDelete: 'set null' }),
  /** manual | inferred | gps_resolved */
  source: text('source').notNull().default('manual'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type UserLocationPreference = typeof userLocationPreference.$inferSelect;
export type NewUserLocationPreference = typeof userLocationPreference.$inferInsert;
