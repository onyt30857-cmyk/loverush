/**
 * 风控事件与黑名单 · M11 模块
 *
 * - risk_events：所有风控触发记录（设备风险、价格偏差、异常行为）
 * - ip_blacklist：IP 黑名单（hash 形式存储 · 隐私保护）
 * - price_lock_audits：价格守门 30 单偏差检测快照
 *
 * 注：M11 §F11.3「反诱导小费 / NLP 加钟话术检测」已撤（决策 2026-05-21）
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { therapists } from './therapists';

/** 风控事件 */
export const riskEvents = pgTable(
  'risk_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // 主体
    subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
    subjectType: text('subject_type').notNull(), // user / therapist / order / device

    // 事件类型
    eventType: text('event_type').notNull(),
    // 类型示例：
    //   device_multi_account / ip_blacklist_hit
    //   price_lock_violation / price_deviation_high
    //   abnormal_behavior / repeat_dispute
    //   sos_triggered（v2 再启用）

    severity: integer('severity').default(50).notNull(), // 0-100
    payload: jsonb('payload').$type<Record<string, unknown>>().default({}),

    // 关联实体
    relatedOrderId: uuid('related_order_id'),

    // 处置
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    resolution: text('resolution'), // dismiss / warn / suspend / ban

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxSubject: index('idx_risk_subject').on(t.subjectUserId, t.createdAt),
    idxType: index('idx_risk_type').on(t.eventType),
    idxSeverity: index('idx_risk_severity').on(t.severity),
    idxUnresolved: index('idx_risk_unresolved').on(t.resolvedAt),
  }),
);

/** IP 黑名单（hash 存储 · 不存原始 IP） */
export const ipBlacklist = pgTable(
  'ip_blacklist',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ipHash: text('ip_hash').notNull().unique(),
    reason: text('reason'),
    severity: integer('severity').default(50).notNull(),
    addedByUserId: uuid('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxHash: index('idx_ip_blacklist_hash').on(t.ipHash),
    idxExpires: index('idx_ip_blacklist_expires').on(t.expiresAt),
  }),
);

/** 价格守门 · 30 单窗口偏差快照（M11 价格守门核心） */
export const priceLockAudits = pgTable(
  'price_lock_audits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    therapistId: uuid('therapist_id').notNull().references(() => therapists.id, { onDelete: 'cascade' }),

    // 窗口（最近 30 单的快照）
    windowStartAt: timestamp('window_start_at', { withTimezone: true }).notNull(),
    windowEndAt: timestamp('window_end_at', { withTimezone: true }).notNull(),
    sampleSize: integer('sample_size').notNull(),

    // 统计
    medianPricePoints: bigint('median_price_points', { mode: 'number' }).notNull(),
    avgPricePoints: bigint('avg_price_points', { mode: 'number' }).notNull(),
    maxDeviationPct: integer('max_deviation_pct').notNull(), // 0-100，单笔最大偏差

    // 触发处置
    triggered: integer('triggered').default(0).notNull(),
    actionTaken: text('action_taken'), // none / warn / cooling / suspend

    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxTherapist: index('idx_price_audit_therapist').on(t.therapistId, t.computedAt),
    idxTriggered: index('idx_price_audit_triggered').on(t.triggered),
  }),
);

export type RiskEvent = typeof riskEvents.$inferSelect;
export type NewRiskEvent = typeof riskEvents.$inferInsert;
export type IpBlacklistEntry = typeof ipBlacklist.$inferSelect;
export type NewIpBlacklistEntry = typeof ipBlacklist.$inferInsert;
export type PriceLockAudit = typeof priceLockAudits.$inferSelect;
export type NewPriceLockAudit = typeof priceLockAudits.$inferInsert;
