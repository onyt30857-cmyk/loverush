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
import { eq } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { orders, therapists, users } from '@loverush/db';
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
