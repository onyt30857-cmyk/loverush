/**
 * 后台操作审计 · Phase 24
 *
 * 谁(actor) 对谁(target) 做了什么(action)，前后状态都留下。
 *
 * 触发场景：
 *   - admin 暂停/封禁/恢复用户
 *   - finance 批准/拒绝提现
 *   - admin 授予/撤销角色
 *   - admin 修改 / override feature flag
 *   - cs 强制解决工单 / 调整订单状态
 *   - auditor 通过/拒绝媒体或 profile 审核
 *
 * 这张表 append-only，不允许 update / delete（DB 层加触发器更稳，但先靠应用层约束）。
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  inet,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // 谁
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role').notNull(), // admin / finance / cs / auditor / ops / system

    // 做了什么
    action: text('action').notNull(),         // user.suspend / withdraw.approve / role.grant ...
    targetType: text('target_type').notNull(), // user / order / withdrawal / role / flag / ticket
    targetId: text('target_id'),               // 可为 null（批量操作）

    // 状态变更（jsonb 存差异；before/after 不必字段对齐）
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),

    // 操作上下文
    reason: text('reason'),
    requestId: text('request_id'),
    ip: inet('ip'),
    userAgent: text('user_agent'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxActor: index('idx_audit_actor_created').on(t.actorUserId, t.createdAt),
    idxTarget: index('idx_audit_target').on(t.targetType, t.targetId, t.createdAt),
    idxAction: index('idx_audit_action_created').on(t.action, t.createdAt),
  }),
);

export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLog.$inferInsert;
