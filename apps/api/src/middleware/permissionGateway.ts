/**
 * 中心化权限网关 · P3
 *
 * 职责：对 /admin/* 路径做统一的权限前置拦截。
 * 必须挂在 requireAuth 之后（依赖 c.get('userId')）。
 *
 * 安全铁律（任何修改都不得破坏）：
 *   1. admin 角色恒放行 — resolveUserPermissions 对 admin 返回全部权限，含则 next()
 *   2. 未映射路径默认放行 — findPermissionByPath 返回 null → next() + logger.warn
 *   3. 现有 requireRole 全部保留 — 网关是叠加关口，不替换底层防线
 *   4. 自身信息端点白名单 — 任何登录用户都需访问（导航权限初始化所需）
 *
 * 请求级 memo：resolveUserPermissions 结果写入 c.var，同一请求若多次经过网关（
 * Hono sub-app 层叠时）只查一次 DB。
 */

import type { Context, MiddlewareHandler, Next } from 'hono';
import { ErrorCode } from '@loverush/types';
import { HttpError } from './errors';
import { getDb } from '../db';
import { logger } from '../services/logger';
import { resolveUserPermissions } from '../services/permissions';
import { findPermissionByPath } from '../services/permissionCatalog';

/** context 变量 key，用于请求级 memo */
const PERMS_CACHE_KEY = '__permGatewayPerms__' as never;

/**
 * 白名单：任何已认证的后台用户都可访问（不受权限控制）。
 * 这些端点是导航/权限初始化所必需，由底层 requireAuth 兜底。
 *
 * - /admin/my-permissions  — 当前用户权限列表（导航初始化用）
 * - /admin/permissions/... — 权限 catalog（matrix UI 读取）
 */
const ADMIN_OPEN_PREFIXES: string[] = [
  '/admin/my-permissions',
  '/admin/permissions/',
];

/**
 * permissionGateway()
 *
 * 只拦截 /admin/* 路径。其他路径直接 next()，零副作用。
 *
 * 挂载方式（index.ts）：
 *   在所有 admin 路由挂载之前，单独挂一次：
 *   app.use('/admin/*', permissionGateway());
 *   注意：requireAuth 必须在其之前运行，通常由各 admin route 的
 *   use('*', requireAuth, requireRole(...)) 在 sub-app 层保证。
 *   若 index.ts 统一挂了 requireAuth，则网关可直接取 userId。
 */
export function permissionGateway(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const path = c.req.path;

    // 非 /admin/* 路径：直接放行（网关只管后台）
    if (!path.startsWith('/admin/') && path !== '/admin') {
      return next();
    }

    // 白名单：导航/权限初始化端点，任何已认证用户可访问
    if (ADMIN_OPEN_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return next();
    }

    // 取 userId（requireAuth 已注入）
    const userId = c.get('userId') as string | undefined;
    if (!userId) {
      // 没有 userId 说明 requireAuth 没跑（不应发生）— 放行给底层 requireAuth 去拒
      return next();
    }

    // 请求级 memo：同一请求内只解析一次权限
    let perms: Set<string> | undefined = c.get(PERMS_CACHE_KEY);
    if (!perms) {
      perms = await resolveUserPermissions({ db: getDb() }, userId);
      c.set(PERMS_CACHE_KEY, perms);
    }

    // 查该路径对应的所需权限
    const required = findPermissionByPath(path);

    if (!required) {
      // 未映射路径 → 放行 + warn（渐进补映射，绝不默认拦截）
      logger.warn('[perm-gateway] unmapped admin path', { path, userId });
      return next();
    }

    // 检查权限（admin 角色 perms 含全集，必然通过 — 恒放行铁律由此保证）
    if (perms.has(required.key)) {
      return next();
    }

    // 无权限 → 403
    throw HttpError.forbidden(
      ErrorCode.E2020_USER_TYPE_LOCKED,
      `permission denied: requires ${required.key} (${required.label})`,
    );
  };
}
