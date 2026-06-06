/**
 * 跨 AI 统一事件流 · customer_ai_event（append-only 单一事实源）
 *
 * 背景：M03 助理 / M06 分身各写各的画像表（维度分治，正确）。但"客户做过什么"是同一串
 * 事实，被两个 AI 在不同维度消费。需要一张 append-only 事件流作为单一事实源，支撑：
 *   ① 跨 AI 风控聚合（同客户在 M03+M06 都触发脱平台/被推销）
 *   ② 合规一键删除（用户行权删除：按 userId 一键清干净所有 AI 痕迹）
 *   ③ 跨 AI 上下文（M06 读 M03 的事件流，只依赖稳定事件契约，不耦合画像 schema）
 *
 * 设计原则：**画像分治（各表）+ 事件统一（本表）**。本表只 append、绝不 update；
 * 各画像表是它的物化视图。这是上线前必锁的 schema 级地基（上线后补 = 数据回填地狱）。
 *
 * 关联：[[reference_loverush_memory_architecture]]
 */
import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const customerAiEvent = pgTable(
  'customer_ai_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** 事件归属客户（users.id）· 合规删除 + 跨 AI 聚合的统一主键口径 */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 来源 AI：'m03'(客户助理) / 'm06'(技师分身) · 用 text 非 pgEnum(避免 enum 迁移漂移) */
    source: text('source').notNull(),
    /** 事件类型：price_inquiry / sales_push / redline:<flag> / booking_intent / erasure_signal ... */
    kind: text('kind').notNull(),
    /** 事件载荷(脱敏后)· 自由结构,消费方按 kind 解释 */
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
    /** M06 事件关联的技师(therapists.id);M03 事件为空 · 不加 FK(技师删除后事件保留做审计) */
    refTherapistId: uuid('ref_therapist_id'),
    /** 关联会话(可选) */
    conversationId: uuid('conversation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // 时序查某客户全部事件(跨 AI 上下文 + 合规删除扫描)
    userCreatedIdx: index('idx_customer_ai_event_user_created').on(t.userId, t.createdAt.desc()),
    // 聚合某客户某类事件(风控:这客户触发了几次脱平台)
    userKindIdx: index('idx_customer_ai_event_user_kind').on(t.userId, t.kind),
    // 全局风控聚合(某类事件在 m03/m06 的分布)
    sourceKindIdx: index('idx_customer_ai_event_source_kind').on(t.source, t.kind),
  }),
);

export type CustomerAiEvent = typeof customerAiEvent.$inferSelect;
export type NewCustomerAiEvent = typeof customerAiEvent.$inferInsert;
