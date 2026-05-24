/**
 * 内容审核工单 · M02 + M11 模块
 *
 * 所有需要人工审核的对象（媒体 / 文本 / 完整 profile / KYC）流入此队列。
 * 审核员从 admin 后台拉队列、审批通过/拒绝。
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { auditStatusEnum } from './enums';

export const contentAuditRecords = pgTable(
  'content_audit_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // 目标对象
    targetType: text('target_type').notNull(), // media / text / profile / kyc
    targetId: uuid('target_id'),                // 关联 media_assets.id 等
    targetUserId: uuid('target_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    // 提交内容快照（拒审后用户改了，这里仍是当时的版本）
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),

    // 审核状态
    status: auditStatusEnum('status').default('pending').notNull(),

    // 审核人 + 决策
    auditorUserId: uuid('auditor_user_id').references(() => users.id, { onDelete: 'set null' }),
    decision: text('decision'), // approve / reject
    rejectReason: text('reject_reason'),
    rejectCategory: text('reject_category'), // 涉黄 / 涉政 / 模糊不清 / 真实性存疑 / 其他

    // 优先级（重要技师 / 投诉触发 > 默认）
    priority: integer('priority').default(0).notNull(),

    // 时间
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    slaDeadlineAt: timestamp('sla_deadline_at', { withTimezone: true }),
  },
  (t) => ({
    idxStatus: index('idx_audit_status').on(t.status),
    idxTargetUser: index('idx_audit_target_user').on(t.targetUserId),
    idxAuditor: index('idx_audit_auditor').on(t.auditorUserId),
    idxQueue: index('idx_audit_queue').on(t.status, t.priority, t.submittedAt),
    idxSla: index('idx_audit_sla').on(t.slaDeadlineAt),
  }),
);

export type ContentAuditRecord = typeof contentAuditRecords.$inferSelect;
export type NewContentAuditRecord = typeof contentAuditRecords.$inferInsert;
