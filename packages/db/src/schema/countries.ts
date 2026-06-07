/**
 * 国家字典 · 单一事实源(时区 + 默认法币 + 国旗 + 名称)
 *
 * 病根:此前国家维度散落 —— 时区硬编码在 services/therapist_facts.ts(COUNTRY_TZ),
 * 法币国家映射硬编码在 services/therapists.ts(COUNTRY_TO_CURRENCY),country_currencies
 * 表已 seed 但代码从不查。加一个国家要改 4 处代码。
 *
 * 本表把这些收成一张表:运营在后台「系统·国家配置」加一行 = resolveTz / 法币立即生效。
 * 读路径经 services/countries.ts 缓存,硬编码常量降级为「表缺数据时」的最终兜底。
 *
 * 时区粒度:默认国家级(此表 timezone);印尼这类跨时区国家可在 cities.timezone 做城市级覆盖。
 */

import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core';

export const countries = pgTable(
  'countries',
  {
    /** ISO alpha-2 · 'TH' / 'VN' / 'SG' ... (大写) */
    code: text('code').primaryKey(),
    nameZh: text('name_zh').notNull(),
    nameEn: text('name_en').notNull(),
    /** 国旗 emoji · '🇹🇭' */
    flagEmoji: text('flag_emoji'),
    /** IANA 时区 · 'Asia/Bangkok' · 国家级默认(城市可在 cities.timezone 覆盖) */
    timezone: text('timezone').notNull(),
    /** 默认法币 code → currencies.code · 'THB' */
    defaultCurrency: text('default_currency').notNull(),
    /** 国际区号 · '+66'(可空) */
    dialCode: text('dial_code'),
    enabled: integer('enabled').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxEnabledSort: index('idx_countries_enabled_sort').on(t.enabled, t.sortOrder),
  }),
);

export type Country = typeof countries.$inferSelect;
export type NewCountry = typeof countries.$inferInsert;
