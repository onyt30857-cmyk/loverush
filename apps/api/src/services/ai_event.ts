/**
 * 跨 AI 统一事件流服务 · emit + 合规删除
 *
 * emitAiEvent：M03/M06 在关键节点 append 一条事件到单一事实源 customer_ai_event。
 *   fire-and-forget 友好(内部吞错),绝不阻断主对话流程。
 * eraseCustomerAiData：用户行权删除(GDPR/PDPA 刚需)——按 userId 一键清干净该客户
 *   所有 AI 记忆痕迹。事件统一底座让"删干净"变成确定性操作,而非到处找散落的 jsonb。
 *
 * 关联蓝图：P0-b 统一事件流 · [[reference_loverush_memory_architecture]]
 */
import { eq } from 'drizzle-orm';
import {
  type Database,
  customerAiEvent,
  customerSavedMemory,
  customerRelationshipProfile,
  assistantChatLog,
} from '@loverush/db';

export interface AiEventContext {
  db: Database;
}

export type AiEventSource = 'm03' | 'm06';

/**
 * append 一条跨 AI 事件 · 单一事实源。调用方用 void/fireAndForget 包裹即可(本函数自吞错)。
 * kind 约定:price_inquiry / sales_push / redline:<flag> / booking_intent / erasure_signal ...
 */
export async function emitAiEvent(
  ctx: AiEventContext,
  e: {
    userId: string;
    source: AiEventSource;
    kind: string;
    payload?: Record<string, unknown>;
    refTherapistId?: string | null;
    conversationId?: string | null;
  },
): Promise<void> {
  try {
    await ctx.db.insert(customerAiEvent).values({
      userId: e.userId,
      source: e.source,
      kind: e.kind,
      payload: e.payload ?? {},
      refTherapistId: e.refTherapistId ?? null,
      conversationId: e.conversationId ?? null,
    });
  } catch (err) {
    // 事件埋点绝不能影响主流程(它是观测/合规用,不是业务关键路径)
    console.warn('[ai_event] emit failed:', (err as Error)?.message);
  }
}

/**
 * 合规一键删除：按 userId 清干净该客户的全部 AI 记忆痕迹(行权删除)。
 * 覆盖:事件流 + M03 画像 + M06 关系档(作为客户的) + M03 对话日志。
 * 返回各表删除行数,便于审计"确实删干净了"。
 */
export async function eraseCustomerAiData(
  ctx: AiEventContext,
  userId: string,
): Promise<{ deleted: Record<string, number> }> {
  const deleted: Record<string, number> = {};

  const ev = await ctx.db
    .delete(customerAiEvent)
    .where(eq(customerAiEvent.userId, userId))
    .returning({ id: customerAiEvent.id });
  deleted.customer_ai_event = ev.length;

  const saved = await ctx.db
    .delete(customerSavedMemory)
    .where(eq(customerSavedMemory.userId, userId))
    .returning({ userId: customerSavedMemory.userId });
  deleted.customer_saved_memory = saved.length;

  // M06 关系档:该用户作为"客户"那一侧的全部关系(对所有技师)
  const rel = await ctx.db
    .delete(customerRelationshipProfile)
    .where(eq(customerRelationshipProfile.customerId, userId))
    .returning({ id: customerRelationshipProfile.id });
  deleted.customer_relationship_profile = rel.length;

  const log = await ctx.db
    .delete(assistantChatLog)
    .where(eq(assistantChatLog.userId, userId))
    .returning({ id: assistantChatLog.id });
  deleted.assistant_chat_log = log.length;

  return { deleted };
}
