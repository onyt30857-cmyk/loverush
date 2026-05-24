/**
 * 一键封锁 · M03 F03.27
 *
 * 任意一方封锁后：
 * - M04 推荐排除
 * - M05 私聊禁止
 * - 双向不可见
 */

import { and, eq } from 'drizzle-orm';
import { Database, blockList, type BlockEntry } from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';

export interface BlockContext {
  db: Database;
}

export async function block(
  ctx: BlockContext,
  args: { blockerUserId: string; blockedUserId: string; reason?: string },
): Promise<BlockEntry> {
  if (args.blockerUserId === args.blockedUserId) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'cannot block self');
  }
  const [row] = await ctx.db
    .insert(blockList)
    .values({
      blockerUserId: args.blockerUserId,
      blockedUserId: args.blockedUserId,
      reason: args.reason,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // 已存在
  const existing = await ctx.db.query.blockList.findFirst({
    where: and(
      eq(blockList.blockerUserId, args.blockerUserId),
      eq(blockList.blockedUserId, args.blockedUserId),
    ),
  });
  return existing!;
}

export async function unblock(
  ctx: BlockContext,
  args: { blockerUserId: string; blockedUserId: string },
): Promise<void> {
  await ctx.db
    .delete(blockList)
    .where(
      and(
        eq(blockList.blockerUserId, args.blockerUserId),
        eq(blockList.blockedUserId, args.blockedUserId),
      ),
    );
}

export async function isBlockedEither(
  ctx: BlockContext,
  a: string,
  b: string,
): Promise<boolean> {
  const rows = await ctx.db.query.blockList.findMany({
    where: and(eq(blockList.blockerUserId, a), eq(blockList.blockedUserId, b)),
    limit: 1,
  });
  if (rows.length) return true;
  const reverse = await ctx.db.query.blockList.findMany({
    where: and(eq(blockList.blockerUserId, b), eq(blockList.blockedUserId, a)),
    limit: 1,
  });
  return reverse.length > 0;
}

export async function listBlocked(
  ctx: BlockContext,
  blockerUserId: string,
): Promise<BlockEntry[]> {
  return ctx.db.query.blockList.findMany({
    where: eq(blockList.blockerUserId, blockerUserId),
  });
}
