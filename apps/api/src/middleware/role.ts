/**
 * 角色校验中间件 · D-103
 *
 * 用法：
 *   adminRoutes.use('*', requireAuth, requireRole(['admin']));
 *   adminAuditRoutes.use('*', requireAuth, requireRole(['admin', 'auditor']));
 *
 * 必须在 requireAuth 之后调用（依赖 c.get('userId')）。
 *
 * P4 扩展（自定义角色收口）：
 *   放行条件从"拥有 roles 之一"扩展为
 *   "拥有 roles 之一 OR 用户权限集包含该请求路径对应的权限 key"。
 *   - 权限集优先复用 permissionGateway 写入 context 的缓存（零额外 DB 查询）。
 *   - 路径未映射到任何权限时，不走权限分支，仍按角色名严格校验（不放松）。
 *   - admin 角色权限集恒为全集，恒通过权限分支（与原角色名分支等价）。
 *   - 不破坏 c.set('userRoles', owned)（下游按 userRoles 输出差异内容的路由依赖此值）。
 */

import type { Context, MiddlewareHandler, Next } from 'hono';
import { ErrorCode } from '@loverush/types';
import { HttpError } from './errors';
import { getDb } from '../db';
import { listRoles, type RoleName } from '../services/roles';
import { resolveUserPermissions } from '../services/permissions';
import { findPermissionByPath } from '../services/permissionCatalog';

/** permissionGateway 写入 context 的请求级权限缓存 key（与网关保持一致） */
const PERMS_CACHE_KEY = '__permGatewayPerms__' as never;

export function requireRole(roles: RoleName[]): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const userId = c.get('userId') as string | undefined;
    if (!userId) {
      throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'auth required');
    }
    const owned = await listRoles({ db: getDb() }, userId);

    // ── 原有角色名分支（735 调用点已有行为，不改语义） ──
    const okByRole = owned.some((r) => (roles as string[]).includes(r));
    if (okByRole) {
      c.set('userRoles' as never, owned);
      return next();
    }

    // ── 新增：权限 key 分支（自定义角色收口） ──
    // 查该请求路径对应的权限 key；未映射则不走此分支（保持严格）
    const perm = findPermissionByPath(c.req.path);
    if (perm) {
      // 优先复用网关已算好的权限集（零额外 DB 查询）；没有则现算
      let perms: Set<string> | undefined = c.get(PERMS_CACHE_KEY);
      if (!perms) {
        perms = await resolveUserPermissions({ db: getDb() }, userId);
      }
      if (perms.has(perm.key)) {
        // 把 roles 数组放到 context · 后续 handler 可读（保持原语义）
        c.set('userRoles' as never, owned);
        return next();
      }
    }

    throw HttpError.forbidden(
      ErrorCode.E2020_USER_TYPE_LOCKED,
      `requires one of roles: ${roles.join(', ')}`,
    );
  };
}
