/**
 * RBAC 角色目录 + 角色权限映射 · 0055
 *
 * - roles            角色目录（系统角色 is_system=true + 自定义角色）
 * - role_permissions 角色→权限 key 多对多（菜单项级 permission_key）
 *
 * user_roles 表（用户→角色分配）保持现有结构不变。
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/** 角色目录 */
export const roles = pgTable(
  'roles',
  {
    id:          uuid('id').defaultRandom().primaryKey(),
    key:         text('key').notNull(),
    nameZh:      text('name_zh').notNull(),
    description: text('description'),
    isSystem:    boolean('is_system').notNull().default(false),
    createdBy:   uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt:   timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxKey: uniqueIndex('uidx_roles_key').on(t.key),
  }),
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;

/** 角色权限映射（role_key × permission_key，permission_key 来自代码 catalog） */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    id:            uuid('id').defaultRandom().primaryKey(),
    roleKey:       text('role_key').notNull(),
    permissionKey: text('permission_key').notNull(),
    createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxRolePerm: uniqueIndex('uidx_role_permissions_rk_pk').on(t.roleKey, t.permissionKey),
    idxRoleKey:   index('idx_role_permissions_role_key').on(t.roleKey),
  }),
);

export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;
