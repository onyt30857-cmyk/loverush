/**
 * 角色校验中间件 · D-103
 *
 * 用法：
 *   adminRoutes.use('*', requireAuth, requireRole(['admin']));
 *   adminAuditRoutes.use('*', requireAuth, requireRole(['admin', 'auditor']));
 *
 * 必须在 requireAuth 之后调用（依赖 c.get('userId')）。
 */

import { Context, MiddlewareHandler, Next } from 'hono';
import { ErrorCode } from '@loverush/types';
import { HttpError } from './errors';
import { getDb } from '../db';
import { hasAnyRole, type RoleName } from '../services/roles';

export function requireRole(roles: RoleName[]): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const userId = c.get('userId') as string | undefined;
    if (!userId) {
      throw HttpError.unauthorized(ErrorCode.E1001_OTP_INVALID, 'auth required');
    }
    const ok = await hasAnyRole({ db: getDb() }, userId, roles);
    if (!ok) {
      throw HttpError.forbidden(
        ErrorCode.E2020_USER_TYPE_LOCKED,
        `requires one of roles: ${roles.join(', ')}`,
      );
    }
    return next();
  };
}
