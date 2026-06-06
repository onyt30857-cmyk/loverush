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
import { eq, desc } from 'drizzle-orm';
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

/** 读某客户最近 N 条跨 AI 事件(消费侧第一个读取方) */
export async function getRecentCustomerEvents(
  ctx: AiEventContext,
  userId: string,
  limit = 5,
): Promise<Array<{ kind: string; source: string; refTherapistId: string | null }>> {
  const rows = await ctx.db.query.customerAiEvent.findMany({
    where: eq(customerAiEvent.userId, userId),
    orderBy: [desc(customerAiEvent.createdAt)],
    limit,
  });
  return rows.map((r) => ({ kind: r.kind, source: r.source, refTherapistId: r.refTherapistId }));
}

/**
 * M03→M06 客户来意:把客户在 M03 侧的已知信息(画像 + 最近事件)组装成给分身的"来意"文本。
 * **只取对分身聊天有用且不露馅的部分**:聊天调性偏好 / 城市 / 下单意向。
 * **绝不取"选人偏好"(年龄/罩杯/身材)**——那是客户挑技师的口味,对固定分身无意义,且分身"知道"会很诡异。
 * 无数据返空串(不注入)。失败自吞错(绝不阻断分身回复)。
 */
export async function loadCustomerIntent(
  ctx: AiEventContext,
  customerId: string,
  _therapistId?: string,
): Promise<string> {
  try {
    const saved = await ctx.db.query.customerSavedMemory.findFirst({
      where: eq(customerSavedMemory.userId, customerId),
    });
    const facts = (saved?.facts ?? {}) as Record<string, unknown>;
    const parts: string[] = [];

    const styles = facts.service_style;
    if (Array.isArray(styles) && styles.length) {
      parts.push(`喜欢${(styles as string[]).slice(0, 2).join('、')}的聊天调性`);
    }
    const city = facts.primary_focus;
    if (Array.isArray(city) && city.length && typeof city[0] === 'string') {
      parts.push(`在${city[0]}`);
    }

    let kinds = new Set<string>();
    try {
      const events = await getRecentCustomerEvents(ctx, customerId, 5);
      kinds = new Set(events.map((e) => e.kind));
    } catch {
      /* 事件读失败不影响画像部分 */
    }
    if (kinds.has('booking_intent')) parts.push('最近有过想约的意思');

    if (!parts.length) return '';
    return `这位客户:${parts.join('，')}。顺着他的调性自然聊就好——但绝不直接说出你"知道"这些(真人是聊出来的、不是查资料的，说破了会让他觉得诡异)。`;
  } catch {
    return '';
  }
}
