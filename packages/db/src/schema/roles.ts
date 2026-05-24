/**
 * 后台用户角色 · Phase 9.1（D-103）
 *
 * 一个 user 可以同时持有多个角色：
 * - admin   平台超管（所有 admin 端点）
 * - auditor 内容/媒体/profile 审核员
 * - finance 财务/提现审批
 * - cs      客服（工单 + 仲裁）
 * - ops     运营（feature flag / 看板 / 通知运营）
 *
 * 升降级走 grant / revoke，留时间审计。
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // admin / auditor / finance / cs / ops
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
  },
  (t) => ({
    uidxActive: uniqueIndex('uidx_user_role_active').on(t.userId, t.role, t.revokedAt),
    idxUser: index('idx_user_role_user').on(t.userId, t.revokedAt),
    idxRole: index('idx_user_role_role').on(t.role),
  }),
);

export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;
