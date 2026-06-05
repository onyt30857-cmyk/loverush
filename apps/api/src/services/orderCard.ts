/**
 * 对话内订单卡 · OrderCard(下单成功后推进对话的事实卡)
 *
 * 下单成功(锁定预约+冻结心动金)→ 往客户和技师的对话推一张订单卡:
 * 服务+时长 / 上门或到店+地点 / 预约时间(前端绝对+相对+期待型倒计时) / 技师 / 状态 / 诚意金。
 * 这是【系统事实卡】(非分身情绪消息),无 LLM、不走红线/翻译,始终发(不受 aiAlterEnabled 门控)。
 * content 是 JSON,前端按 type='order_card' 渲染。fire-and-forget · 自身不抛(订单已成不能因卡挂掉)。
 *
 * 时区:scheduledAt 是 UTC 容器墙上时间(T19:00:00Z 即技师/客户眼中 19:00),前端用 getUTC* 取墙上分量
 * 当本地时间算绝对显示+倒计时(O2O 客户与技师同城,客户本地=技师墙钟,精确)。后端只透传 ISO。
 */
import { eq, and, desc } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { orders, therapists, users, messages } from '@loverush/db';
import { sendMessage, openConversation } from './chat';

export interface OrderCardContext {
  db: Database;
}

export interface OrderCardPayload {
  orderId: string;
  status: string;
  serviceName: string;
  durationMin: number;
  scheduledAt: string | null; // ISO(UTC 墙上时间)
  serviceMode: 'incall' | 'outcall';
  therapistId: string | null;
  therapistName: string;
  therapistAvatar: string | null;
  areaName: string | null; // 上门=客户区域 / 到店=门店区域
  depositPoints: number;
}

/** 组装订单卡 content(纯函数,便于测试) */
export function buildOrderCardPayload(
  o: typeof orders.$inferSelect,
  t: typeof therapists.$inferSelect | undefined,
  therapistDisplayName: string,
): OrderCardPayload {
  // serviceMode:订单存的优先(both 技师下单时已定),老单 null → 回退技师 serviceMode(both 默认 outcall)
  const serviceMode: 'incall' | 'outcall' =
    o.serviceMode ?? (t?.serviceMode === 'incall' ? 'incall' : 'outcall');
  const areaName =
    serviceMode === 'incall' ? (t?.serviceArea ?? t?.serviceCity ?? null) : (o.customerAreaName ?? null);
  return {
    orderId: o.id,
    status: o.status,
    serviceName: o.serviceSnapshot?.skills?.[0]?.trim() || '按摩',
    durationMin: o.serviceSnapshot?.durationMin ?? 60,
    scheduledAt: o.scheduledAt ? o.scheduledAt.toISOString() : null,
    serviceMode,
    therapistId: t?.id ?? null,
    therapistName: therapistDisplayName,
    therapistAvatar: t?.avatarUrl ?? null,
    areaName,
    depositPoints: o.depositPoints ?? 0,
  };
}

export async function sendOrderCard(ctx: OrderCardContext, orderId: string): Promise<{ sent: boolean }> {
  try {
    const o = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (!o) return { sent: false };
    const t = await ctx.db.query.therapists.findFirst({ where: eq(therapists.userId, o.therapistUserId) });
    const u = await ctx.db.query.users.findFirst({ where: eq(users.id, o.therapistUserId) });
    const therapistName = u?.displayName?.trim() || t?.bio?.slice(0, 16).trim() || '技师';

    const payload = buildOrderCardPayload(o, t, therapistName);

    const conv = await openConversation(ctx, { customerId: o.customerId, therapistUserId: o.therapistUserId });
    await sendMessage(ctx, {
      conversationId: conv.id,
      senderUserId: o.therapistUserId,
      text: JSON.stringify(payload),
      type: 'order_card',
    });
    return { sent: true };
  } catch (err) {
    console.warn('[sendOrderCard] failed:', (err as Error)?.message);
    return { sent: false };
  }
}

/**
 * 订单状态流转后 → 原地更新对话里那张订单卡的 content(同会话 type=order_card 且 content.orderId 匹配的最新一条)。
 * 前端 30s 兜底轮询 refetch 全量 → 拿到新 content 自动重渲染(状态徽章/stepper/CTA 随之变)。
 * 没找到卡(老单/未发卡)→ noop。fire-and-forget · 不抛。
 */
export async function updateOrderCard(ctx: OrderCardContext, orderId: string): Promise<{ updated: boolean }> {
  try {
    const o = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (!o) return { updated: false };
    const t = await ctx.db.query.therapists.findFirst({ where: eq(therapists.userId, o.therapistUserId) });
    const u = await ctx.db.query.users.findFirst({ where: eq(users.id, o.therapistUserId) });
    const therapistName = u?.displayName?.trim() || t?.bio?.slice(0, 16).trim() || '技师';
    const payload = buildOrderCardPayload(o, t, therapistName);

    const conv = await openConversation(ctx, { customerId: o.customerId, therapistUserId: o.therapistUserId });
    const rows = await ctx.db
      .select({ id: messages.id, content: messages.contentOriginal })
      .from(messages)
      .where(and(eq(messages.conversationId, conv.id), eq(messages.type, 'order_card')))
      .orderBy(desc(messages.sentAt));
    const target = rows.find((r) => {
      try {
        return (JSON.parse(r.content ?? '{}') as { orderId?: string }).orderId === orderId;
      } catch {
        return false;
      }
    });
    if (!target) return { updated: false };
    await ctx.db.update(messages).set({ contentOriginal: JSON.stringify(payload) }).where(eq(messages.id, target.id));
    return { updated: true };
  } catch (err) {
    console.warn('[updateOrderCard] failed:', (err as Error)?.message);
    return { updated: false };
  }
}

// 服务完成 → 推一条暖心评价提示(纯情绪价值零推销 · 客户点订单卡的「给技师评价」进评价)
const REVIEW_PROMPTS = [
  '今天辛苦你跑这一趟啦~ 这次还满意吗?给我个评价好不好,我会更努力的😊',
  '陪你的这段时间很开心~ 方便的话给我个小评价呀,等你下次再来找我哦😌',
  '服务结束啦,和我在一起开心吗?给个评价好不好,我会记在心上的~',
];

/**
 * 服务完成后 → 以技师身份往对话推一条暖心评价提示(模板,不依赖 LLM,始终发)。
 * fire-and-forget · 不抛。实际评价入口在订单卡「给技师评价」CTA(→ /order/[id]?review=1)。
 */
export async function sendReviewPrompt(ctx: OrderCardContext, orderId: string): Promise<{ sent: boolean }> {
  try {
    const o = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    if (!o) return { sent: false };
    const text = REVIEW_PROMPTS[Math.floor(Math.random() * REVIEW_PROMPTS.length)]!;
    const conv = await openConversation(ctx, { customerId: o.customerId, therapistUserId: o.therapistUserId });
    await sendMessage(ctx, {
      conversationId: conv.id,
      senderUserId: o.therapistUserId,
      text,
      isAiAlter: true,
    });
    return { sent: true };
  } catch (err) {
    console.warn('[sendReviewPrompt] failed:', (err as Error)?.message);
    return { sent: false };
  }
}
