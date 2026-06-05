/**
 * Prompt Registry · 提示词模板版本库(分层治理)
 *
 * 每个 key(如 `m03.system.zh` / `m06.global.output`)有多个 version。
 * 同 key 仅一条 status='active'(应用运行时读它);改 prompt = 插入新 version(draft),
 * 发布时把旧 active 切 archived、新的切 active → 天然审计 + 一键回滚(把历史 version 重设 active)。
 *
 * layer:
 *   A = 风控层(红线/护栏/铁律) · code_only,后台只读不可改,真值仍在代码常量
 *   B = 调优层(语气/话术/few-shot/问候) · 后台可改
 *   C = 个体层(单技师 persona) · 走各自表,这里一般不用
 *
 * 设计依据:[[reference_loverush_prompt_governance]] 分层治理。
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const promptTemplates = pgTable(
  'prompt_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** 逻辑标识 · 装配层用它查 active 版本 · 如 m03.system.zh / m06.global.output */
    key: text('key').notNull(),
    /** 该 key 下递增版本号(1,2,3...) */
    version: integer('version').notNull(),
    /** 人类可读名 · 如 "M03 人设·中文" */
    label: text('label'),
    /** prompt 全文 */
    content: text('content').notNull(),
    /** draft(草稿) / active(当前生效,每 key 仅一条) / archived(历史) */
    status: text('status').notNull().default('draft'),
    /** A 风控(code_only 只读) / B 调优(可改) / C 个体 */
    layer: text('layer').notNull().default('B'),
    /** 本次改动说明 */
    changeNote: text('change_note'),
    /** 灰度百分比 0-100(P2 用,先留默认 100) */
    rolloutPct: integer('rollout_pct').default(100).notNull(),
    /** 操作人 */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    keyVersionUq: uniqueIndex('uq_prompt_templates_key_version').on(t.key, t.version),
    keyStatusIdx: index('idx_prompt_templates_key_status').on(t.key, t.status),
  }),
);

export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type NewPromptTemplate = typeof promptTemplates.$inferInsert;
