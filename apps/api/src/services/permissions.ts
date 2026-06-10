/**
 * 权限解析服务
 *
 * resolveUserPermissions(ctx, userId): Promise<Set<string>>
 *   - 查用户活跃角色
 *   - 合并各角色的 role_permissions 得到权限 key 并集
 *   - admin 角色 → 直接返回 ALL_PERMISSION_KEYS（超管恒全权，防自锁）
 */

import { and, eq, isNull, inArray } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { userRoles, rolePermissions } from '@loverush/db';
import { ALL_PERMISSION_KEYS } from './permissionCatalog';

export interface PermissionsContext {
  db: Database;
}

/**
 * 解析用户拥有的权限 key 集合。
 * 同一用户可持有多个角色，权限取并集。
 * admin 角色直接短路返回全部权限（超管恒全权）。
 */
export async function resolveUserPermissions(
  ctx: PermissionsContext,
  userId: string,
): Promise<Set<string>> {
  // 1. 查活跃角色
  const rows = await ctx.db.query.userRoles.findMany({
    where: and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt)),
  });
  const activeRoles = rows.map((r) => r.role);

  // 2. admin 超管 → 全部权限
  if (activeRoles.includes('admin')) {
    return new Set(ALL_PERMISSION_KEYS);
  }

  if (activeRoles.length === 0) {
    return new Set();
  }

  // 3. 查 role_permissions 并集
  const permRows = await ctx.db
    .select({ permissionKey: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleKey, activeRoles));

  return new Set(permRows.map((r) => r.permissionKey));
}
