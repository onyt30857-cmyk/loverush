/**
 * 角色校验中间件 · D-103
 *
 * 用法：
 *   adminRoutes.use('*', requireAuth, requireRole(['admin']));
 *   adminAuditRoutes.use('*', requireAuth, requireRole(['admin', 'auditor']));
 *
 * 必须在 requireAuth 之后调用（依赖 c.get('userId')）。
 */

import type { Context, MiddlewareHandler, Next } from 'hono';
import { ErrorCode } from '@loverush/types';
import { HttpError } from './errors';
import { getDb } from '../db';
import { listRoles, type RoleName } from '../services/roles';

export function requireRole(roles: RoleName[]): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const userId = c.get('userId') as string | undefined;
    if (!userId) {
      throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'auth required');
    }
    const owned = await listRoles({ db: getDb() }, userId);
    const ok = owned.some((r) => (roles as string[]).includes(r));
    if (!ok) {
      throw HttpError.forbidden(
        ErrorCode.E2020_USER_TYPE_LOCKED,
        `requires one of roles: ${roles.join(', ')}`,
      );
    }
    // 把 roles 数组放到 context · 后续 handler 可读
    // 修复 admin-user-media / admin-customer-assistant / admin-assistant-sessions
    // 的 c.get('userRoles') 永远 undefined 导致权限分级失效 bug
    c.set('userRoles' as never, owned);
    return next();
  };
}
