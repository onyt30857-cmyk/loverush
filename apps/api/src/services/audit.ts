/**
 * 后台操作审计服务 · Phase 24
 *
 * 用法：在敏感 admin 操作完成后调用
 *
 *   await recordAudit(c, {
 *     action: 'withdraw.approve',
 *     targetType: 'withdrawal',
 *     targetId: w.id,
 *     before: { status: 'pending', amount: w.amountPoints },
 *     after: { status: 'paid' },
 *     reason: body.note,
 *   });
 *
 * 设计：
 * - 双写：admin_audit_log 表 + 结构化日志（logger.info('audit', ...)）
 * - actorUserId / actorRole / requestId / ip / user_agent 从 Hono Context 自动注入
 * - 不抛错：审计失败也不能阻塞业务（仅 logger.error 记一笔）
 */

import type { Context } from 'hono';
import { Database, adminAuditLog } from '@loverush/db';
import { logger } from './logger';

export interface AuditContext {
  db: Database;
}

/**
 * 进程级 counter · 审计写库失败次数
 *
 * 单实例进程内累计；多实例时 Prometheus scrape 自动 sum by job。
 * metrics 端点读取此值暴露为 loverush_audit_insert_failed_total。
 */
let auditInsertFailedCount = 0;
export function getAuditInsertFailedCount(): number {
  return auditInsertFailedCount;
}
export function _resetAuditInsertFailedCount(): void {
  auditInsertFailedCount = 0; // 仅供测试用
}

export interface RecordAuditArgs {
  action: string;        // user.suspend / withdraw.approve / role.grant ...
  targetType: string;    // user / order / withdrawal / role / flag / ticket
  targetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string;
  /** 强制覆盖 actorRole（默认从 c.get('actorRole') 或 'admin' 兜底） */
  actorRole?: string;
}

function extractIp(c: Context): string | null {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    null
  );
}

export async function recordAudit(
  ctx: AuditContext,
  c: Context,
  args: RecordAuditArgs,
): Promise<void> {
  const actorUserId = (c.get('userId') as string | undefined) ?? null;
  const actorRole = args.actorRole ?? (c.get('actorRole') as string | undefined) ?? 'admin';
  const requestId = (c.get('requestId') as string | undefined) ?? null;
  const ip = extractIp(c);
  const userAgent = c.req.header('user-agent') ?? null;

  // 1. 结构化日志先行（即使 DB 写失败，日志仍留痕）
  logger.info('audit', {
    actorUserId,
    actorRole,
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId ?? null,
    reason: args.reason ?? null,
    requestId,
    ip,
    before: args.before ?? null,
    after: args.after ?? null,
  });

  // 2. 入库（fire-and-forget · 失败不阻塞响应，但要 log 出来）
  try {
    await ctx.db.insert(adminAuditLog).values({
      actorUserId,
      actorRole,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId ?? null,
      before: args.before ?? null,
      after: args.after ?? null,
      reason: args.reason,
      requestId,
      ip,
      userAgent,
    });
  } catch (err) {
    auditInsertFailedCount++;
    logger.error('audit insert failed', {
      err,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
    });
  }
}
