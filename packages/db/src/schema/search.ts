/**
 * 搜索后台 · M02 Phase 4
 *
 * 三张表:
 * 1. search_query_logs        — 每次搜索 + 点击的明细日志(BI 看板源数据)
 * 2. search_hot_keywords      — 运营可配的热门词 chips(替换 /search 页前端硬编码)
 * 3. search_categories        — 运营可配的类目网格(替换 /search 页前端硬编码)
 *
 * 决策记录:
 * - 不寄生 analytics_events:专表查询效率高 10x,BI 独立建模(见 plan 调研)
 * - 不复用 feature_flags:概念独立(运营物料 ≠ 灰度开关)
 * - enabled 用 integer(1/0)而非 boolean:对齐 codebase 现有惯例(flags.ts/redline 都用 1/0)
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';

// ───────────────────────────── 1. 搜索日志 ─────────────────────────────

export const searchQueryLogs = pgTable(
  'search_query_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    /** 搜索的客户 · null 允许(未登录访问入口页时不强制) */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    /** 原始 query 字符串(用户敲的) */
    rawQuery: text('raw_query').notNull(),

    /** Phase 2 NLP 结构化解析输出 · ParsedSearchQuery 形状 */
    parsedQuery: jsonb('parsed_query'),

    /** 命中的技师数 · 0 = 零结果词(运营需要看) */
    resultCount: integer('result_count').notNull().default(0),

    /** Phase 3 是否真走了个性化排序 · 1/0 */
    personalized: integer('personalized').notNull().default(0),

    /** 首个被点击的技师 id · null = 没点(高 bounce 词) */
    clickedTherapistId: uuid('clicked_therapist_id'),
    clickedAt: timestamp('clicked_at', { withTimezone: true }),

    /** 元数据 */
    locale: text('locale'),
    ipHash: text('ip_hash'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxUserOccurred: index('idx_search_log_user_occurred').on(t.userId, t.occurredAt),
    idxOccurred: index('idx_search_log_occurred').on(t.occurredAt),
    idxRawQuery: index('idx_search_log_raw_query').on(t.rawQuery),
    idxClicked: index('idx_search_log_clicked').on(t.clickedTherapistId),
  }),
);

export type SearchQueryLog = typeof searchQueryLogs.$inferSelect;
export type NewSearchQueryLog = typeof searchQueryLogs.$inferInsert;

// ─────────────────────────── 2. 热门词运营物料 ───────────────────────────

export const searchHotKeywords = pgTable(
  'search_hot_keywords',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    /** 唯一 key · 'thai-night' / 'sukhumvit' · 不用做用户可见文案 */
    keyword: text('keyword').notNull(),

    /** 用户可见展示文案 · '今晚有空' / '素坤逸' */
    displayLabel: text('display_label').notNull(),

    /** 排序(asc) · 0=置顶 */
    sortOrder: integer('sort_order').notNull().default(100),

    /** 总开关 · 1/0 */
    enabled: integer('enabled').notNull().default(1),

    /** locale 投放 · null=全部 · ['zh-CN','th'] */
    targetLocales: text('target_locales').array(),

    /** 城市投放 · null=全部 · ['曼谷','清迈'] */
    targetCities: text('target_cities').array(),

    /** 时段投放(节日热词) · null=永久 */
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),

    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxKeyword: uniqueIndex('uidx_hot_keyword').on(t.keyword),
    idxEnabledSort: index('idx_hot_enabled_sort').on(t.enabled, t.sortOrder),
  }),
);

export type SearchHotKeyword = typeof searchHotKeywords.$inferSelect;
export type NewSearchHotKeyword = typeof searchHotKeywords.$inferInsert;

// ────────────────────────── 3. 类目网格运营物料 ──────────────────────────

export const searchCategories = pgTable(
  'search_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    /** 唯一 code · 'thai' / 'oil' / 'foot' */
    code: text('code').notNull(),

    /** emoji · '🌿' · null 时前端用默认占位 */
    emoji: text('emoji'),

    /** 展示文案 · '泰式' */
    label: text('label').notNull(),

    sortOrder: integer('sort_order').notNull().default(100),
    enabled: integer('enabled').notNull().default(1),

    /**
     * 点击后直跳 /search/results 时附带的过滤条件
     * 例: { skill: '泰式' } 或 { online: true }
     */
    filterCondition: jsonb('filter_condition'),

    targetLocales: text('target_locales').array(),
    targetCities: text('target_cities').array(),

    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxCode: uniqueIndex('uidx_search_category_code').on(t.code),
    idxEnabledSort: index('idx_search_category_enabled_sort').on(t.enabled, t.sortOrder),
  }),
);

export type SearchCategory = typeof searchCategories.$inferSelect;
export type NewSearchCategory = typeof searchCategories.$inferInsert;
