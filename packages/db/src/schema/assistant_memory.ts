/**
 * M03 客户 AI 助理 · 长期记忆 schema
 *
 * 4 张表 · 对应 PRD §4.1 + §4.3
 *
 * - customer_saved_memory      L1 facts + L2 stable_prefs（可见可删）
 * - customer_reference_memory  L3 rotating + L4 relations + L5 diff（隐式 RAG）
 * - customer_interest_clusters 多兴趣簇质心（KMeans 3-5 簇）
 * - customer_outreach_state    主动 push + 沉默召回频率与开关
 *
 * RLS: 启用见 migration 0006 · 由 app.user_id setting 强约束
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
  boolean,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/** L1 + L2:Saved Memory（客户可见可删 · 客户审计入口） */
export const customerSavedMemory = pgTable(
  'customer_saved_memory',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** L1 facts:city / gender / language / age_range / origin */
    facts: jsonb('facts').$type<{
      city?: string;
      gender?: string;
      language?: string;
      ageRange?: string;
      origin?: string;
      [k: string]: unknown;
    }>().default({}),

    /** L2 stable_prefs:{ dislikes, priorities, price_band, taboo_zones... } */
    stablePrefs: jsonb('stable_prefs').$type<{
      dislikes?: string[];
      priorities?: string[];
      priceBand?: 'low' | 'mid' | 'high' | string;
      [k: string]: unknown;
    }>().default({}),

    /** L2 敏感子集 · 仅端侧加密上传 token,云侧拿不到原文 */
    shameSafePrefs: jsonb('shame_safe_prefs').$type<Record<string, unknown>>().default({}),

    /** L2 永久禁忌:医学/心理边界 */
    tabooZones: text('taboo_zones').array().default([] as string[]),

    /** 客户上次导出时间 */
    exportedAt: timestamp('exported_at', { withTimezone: true }),

    /** 客户请求删除时设;30 天 grace 后真删 */
    deletionScheduledAt: timestamp('deletion_scheduled_at', { withTimezone: true }),

    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxDeletion: index('idx_csmem_deletion').on(t.deletionScheduledAt),
  }),
);

/** L3 + L4 + L5:Reference Memory（隐式 RAG 检索） */
export const customerReferenceMemory = pgTable(
  'customer_reference_memory',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** rotating | relation | diff */
    memoryType: text('memory_type').notNull(),

    /** 文本内容（已脱敏） */
    content: text('content').notNull(),

    /**
     * 向量 embedding · 暂用 jsonb 存(pgvector 启用前的过渡)
     * 升级路径：migration 把列改 vector(1536),代码切 sql 算 cosine
     */
    embedding: jsonb('embedding').$type<number[]>(),

    /** NER 抽到的实体 · 用于规则召回 */
    entities: text('entities').array().default([] as string[]),

    /** 1-10 · 影响 Top N 排序 */
    importance: integer('importance').default(5).notNull(),

    /** bi-temporal · 事实生效起点 */
    validFrom: timestamp('valid_from', { withTimezone: true }).defaultNow().notNull(),

    /** 失效时间;NULL = 当前有效 */
    validTo: timestamp('valid_to', { withTimezone: true }),

    /** 记录时间(写入审计) */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),

    /** 关联到 customer_interest_clusters.cluster_idx (1-5) */
    clusterId: integer('cluster_id'),

    /** cloud | edge · edge 表示原文留客户端,云侧仅 token */
    endpoint: text('endpoint').default('cloud').notNull(),

    /**
     * 关联实体 ref:therapist_id / order_id / review_id 等
     * 仅 relation/diff 类型有
     */
    refTherapistId: uuid('ref_therapist_id'),
    refOrderId: uuid('ref_order_id'),

    /** 软删标记(归档时使用) */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => ({
    idxUserType: index('idx_crmem_user_type').on(t.userId, t.memoryType, t.validTo),
    idxUserCluster: index('idx_crmem_user_cluster').on(t.userId, t.clusterId),
    idxRefTherapist: index('idx_crmem_ref_therapist').on(t.userId, t.refTherapistId),
    idxRecordedAt: index('idx_crmem_recorded_at').on(t.recordedAt),
  }),
);

/** 多兴趣簇质心（每客户 3-5 簇 · KMeans 离线 job 写入） */
export const customerInterestClusters = pgTable(
  'customer_interest_clusters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** 1-5 · 每客户内唯一 */
    clusterIdx: integer('cluster_idx').notNull(),

    /** 簇语义标签 · 如 "年轻外向 / 成熟稳重 / 性价比" */
    label: text('label'),

    /** 簇质心向量(暂用 jsonb) */
    centroid: jsonb('centroid').$type<number[]>(),

    /** 该簇命中的样本量(KMeans 输出) */
    sampleSize: integer('sample_size').default(0).notNull(),

    /** 该簇的关键实体(NER 聚合) */
    topEntities: text('top_entities').array().default([] as string[]),

    /** 该簇权重(影响推荐召回数量分配) */
    weight: integer('weight').default(100).notNull(),

    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqUserCluster: uniqueIndex('uq_cluster_user_idx').on(t.userId, t.clusterIdx),
  }),
);

/** 主动 push + 沉默召回的频率管理和客户主权开关 */
export const customerOutreachState = pgTable(
  'customer_outreach_state',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** 客户一键关闭主动 push · 关闭后永远不再发 */
    proactiveEnabled: boolean('proactive_enabled').default(true).notNull(),

    /** 沉默召回开关 · 关闭后永远不再发 */
    silentRecallEnabled: boolean('silent_recall_enabled').default(true).notNull(),

    /** 本周已 push 次数(每周一 0 点重置) */
    weeklyPushCount: integer('weekly_push_count').default(0).notNull(),
    weeklyPushResetAt: timestamp('weekly_push_reset_at', { withTimezone: true }),

    /** 本月已召回次数(每月 1 号 0 点重置) */
    monthlyRecallCount: integer('monthly_recall_count').default(0).notNull(),
    monthlyRecallResetAt: timestamp('monthly_recall_reset_at', { withTimezone: true }),

    /** 上次 push / 召回时间 · 用于冷却 */
    lastPushAt: timestamp('last_push_at', { withTimezone: true }),
    lastRecallAt: timestamp('last_recall_at', { withTimezone: true }),

    /** 推断的固定时段(过去 4 次预约一致的窗口) */
    regularTimeSlot: jsonb('regular_time_slot').$type<{
      weekday?: number; // 0-6
      hourStart?: number;
      hourEnd?: number;
    }>(),

    /** 客户最近一次下单时间 · 用于沉默判定 */
    lastOrderAt: timestamp('last_order_at', { withTimezone: true }),

    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxLastOrder: index('idx_outreach_last_order').on(t.lastOrderAt),
    idxProactive: index('idx_outreach_proactive').on(t.proactiveEnabled),
  }),
);

export type CustomerSavedMemory = typeof customerSavedMemory.$inferSelect;
export type NewCustomerSavedMemory = typeof customerSavedMemory.$inferInsert;
export type CustomerReferenceMemory = typeof customerReferenceMemory.$inferSelect;
export type NewCustomerReferenceMemory = typeof customerReferenceMemory.$inferInsert;
export type CustomerInterestCluster = typeof customerInterestClusters.$inferSelect;
export type NewCustomerInterestCluster = typeof customerInterestClusters.$inferInsert;
export type CustomerOutreachState = typeof customerOutreachState.$inferSelect;
export type NewCustomerOutreachState = typeof customerOutreachState.$inferInsert;
