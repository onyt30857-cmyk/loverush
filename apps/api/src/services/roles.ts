/**
 * 角色服务 · Phase 9.1（D-103）
 */

import { and, eq, isNull, inArray } from 'drizzle-orm';
import { Database, userRoles, type UserRole } from '@loverush/db';

export type RoleName = 'admin' | 'auditor' | 'finance' | 'cs' | 'ops';

export interface RoleContext {
  db: Database;
}

export async function listRoles(ctx: RoleContext, userId: string): Promise<RoleName[]> {
  const rows = await ctx.db.query.userRoles.findMany({
    where: and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt)),
  });
  return rows.map((r) => r.role as RoleName);
}

export async function hasRole(ctx: RoleContext, userId: string, role: RoleName): Promise<boolean> {
  const roles = await listRoles(ctx, userId);
  return roles.includes(role);
}

export async function hasAnyRole(ctx: RoleContext, userId: string, roles: RoleName[]): Promise<boolean> {
  const owned = await listRoles(ctx, userId);
  return roles.some((r) => owned.includes(r));
}

export async function grant(
  ctx: RoleContext,
  args: { userId: string; role: RoleName; grantedByUserId?: string },
): Promise<UserRole> {
  const [row] = await ctx.db
    .insert(userRoles)
    .values({
      userId: args.userId,
      role: args.role,
      grantedByUserId: args.grantedByUserId,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const existing = await ctx.db.query.userRoles.findFirst({
    where: and(
      eq(userRoles.userId, args.userId),
      eq(userRoles.role, args.role),
      isNull(userRoles.revokedAt),
    ),
  });
  return existing!;
}

export async function revoke(
  ctx: RoleContext,
  args: { userId: string; role: RoleName; reason?: string },
): Promise<void> {
  await ctx.db
    .update(userRoles)
    .set({ revokedAt: new Date(), revokeReason: args.reason })
    .where(
      and(
        eq(userRoles.userId, args.userId),
        eq(userRoles.role, args.role),
        isNull(userRoles.revokedAt),
      ),
    );
}

export async function listUsersByRole(ctx: RoleContext, role: RoleName): Promise<string[]> {
  const rows = await ctx.db.query.userRoles.findMany({
    where: and(eq(userRoles.role, role), isNull(userRoles.revokedAt)),
  });
  return [...new Set(rows.map((r) => r.userId))];
}
