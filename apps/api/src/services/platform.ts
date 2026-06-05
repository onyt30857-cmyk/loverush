/**
 * 平台收款账户 service · M16 批发采购用
 *
 * admin 配置平台收款账户（USDT-TRC20 地址等），代理批发时按 active 账户转账。
 */
import { eq, asc, desc } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { platformReceivingAccounts, type PlatformReceivingAccount } from '@loverush/db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

export interface PlatformContext {
  db: Database;
}

/** 代理可见：启用的收款账户 */
export async function listActivePlatformAccounts(ctx: PlatformContext): Promise<PlatformReceivingAccount[]> {
  return ctx.db.query.platformReceivingAccounts.findMany({
    where: eq(platformReceivingAccounts.isActive, true),
    orderBy: [asc(platformReceivingAccounts.displayOrder)],
  });
}

/** admin：全部收款账户 */
export async function listAllPlatformAccounts(ctx: PlatformContext): Promise<PlatformReceivingAccount[]> {
  return ctx.db.query.platformReceivingAccounts.findMany({
    orderBy: [desc(platformReceivingAccounts.createdAt)],
  });
}

export async function upsertPlatformAccount(
  ctx: PlatformContext,
  args: {
    id?: string;
    methodType: string;
    label: string;
    fields: Record<string, string>;
    isActive?: boolean;
    displayOrder?: number;
    note?: string;
  },
): Promise<PlatformReceivingAccount> {
  if (args.id) {
    const [row] = await ctx.db
      .update(platformReceivingAccounts)
      .set({
        methodType: args.methodType,
        label: args.label,
        fields: args.fields,
        isActive: args.isActive ?? true,
        displayOrder: args.displayOrder ?? 0,
        note: args.note,
        updatedAt: new Date(),
      })
      .where(eq(platformReceivingAccounts.id, args.id))
      .returning();
    if (!row) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'account not found');
    return row;
  }
  const [row] = await ctx.db
    .insert(platformReceivingAccounts)
    .values({
      methodType: args.methodType,
      label: args.label,
      fields: args.fields,
      isActive: args.isActive ?? true,
      displayOrder: args.displayOrder ?? 0,
      note: args.note,
    })
    .returning();
  return row!;
}

export async function deletePlatformAccount(ctx: PlatformContext, id: string): Promise<void> {
  await ctx.db.delete(platformReceivingAccounts).where(eq(platformReceivingAccounts.id, id));
}
