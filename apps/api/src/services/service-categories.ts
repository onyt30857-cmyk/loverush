/**
 * M02b/M04 Phase 1 · 服务类型字典 service
 *
 * Admin 维护 · 技师/客户读取
 */

import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { serviceCategories, type ServiceCategory } from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';

export interface CategoryContext {
  db: Database;
}

export async function listCategories(
  ctx: CategoryContext,
  args: { activeOnly?: boolean } = {},
): Promise<ServiceCategory[]> {
  const conditions = args.activeOnly !== false ? [eq(serviceCategories.isActive, 1)] : [];
  return ctx.db
    .select()
    .from(serviceCategories)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(serviceCategories.displayOrder));
}

export interface CreateCategoryArgs {
  code: string;
  nameZh: string;
  nameEn: string;
  description?: string;
  iconEmoji?: string;
  displayOrder?: number;
}

export async function createCategory(
  ctx: CategoryContext,
  args: CreateCategoryArgs,
): Promise<ServiceCategory> {
  if (!/^[a-z0-9_]{2,40}$/.test(args.code)) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'code must match [a-z0-9_]{2,40}');
  }
  const [row] = await ctx.db.insert(serviceCategories).values({
    code: args.code,
    nameZh: args.nameZh,
    nameEn: args.nameEn,
    description: args.description,
    iconEmoji: args.iconEmoji,
    displayOrder: args.displayOrder ?? 0,
    isActive: 1,
  }).returning();
  if (!row) throw HttpError.internal('category create failed');
  return row;
}

export async function updateCategory(
  ctx: CategoryContext,
  id: string,
  args: Partial<Omit<CreateCategoryArgs, 'code'>> & { isActive?: 0 | 1 },
): Promise<ServiceCategory> {
  const cur = await ctx.db.query.serviceCategories.findFirst({ where: eq(serviceCategories.id, id) });
  if (!cur) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'category not found');
  const [row] = await ctx.db
    .update(serviceCategories)
    .set({ ...args, updatedAt: new Date() })
    .where(eq(serviceCategories.id, id))
    .returning();
  if (!row) throw HttpError.internal('category update failed');
  return row;
}

/** 软删 · 不真删除 · 仅 isActive=0 · 不影响已发布的 shows */
export async function deleteCategory(ctx: CategoryContext, id: string): Promise<void> {
  await ctx.db
    .update(serviceCategories)
    .set({ isActive: 0, updatedAt: new Date() })
    .where(eq(serviceCategories.id, id));
}
