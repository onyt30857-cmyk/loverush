/**
 * 订单服务 · M07 凭证链与服务记录
 *
 * 11 状态机：
 *   DRAFT → PENDING_CONFIRM → LOCKED → PAID → IN_SERVICE → COMPLETED → REVIEWED
 *   异常路径：CANCELLED / DISPUTED → REFUNDED / CLOSED
 *
 * 每次状态转移自动 append chain event（哈希链）+ 状态切换。
 */

import { eq, sql, inArray, desc, and, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type {
  Database} from '@loverush/db';
import {
  orders,
  shows,
  therapists,
  users,
  cities,
  areas,
  type Order,
  type Therapist,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { appendChainEvent, computePriceLockHash } from './chain';
import { markActivatedAsync } from './activation';
import { convertPointsToFiat, formatFiat } from './fx';
import { getTherapistByUserId, deriveDefaultCurrency } from './therapists';
import { shopInfoVisible, buildShopInfo, type ShopInfo } from './shopInfo';
import {
  customerLocationVisibleToTherapist,
  buildCustomerLocation,
  resolveTherapistAreaCenter,
  OUTCALL_SERVICE_MODES,
  type CustomerLocation,
  type CustomerAddressMediaItem,
} from './customerLocation';
import { distanceKm } from './geo-distance';
import { mediaAssets } from '@loverush/db';

/**
 * 上门服务范围阈值(km)· 客户坐标 vs 技师区域中心超过此距离则拦下单。
 * 导出便于日后调整 / 测试。
 */
export const OUTCALL_MAX_DISTANCE_KM = 30;

// ──────────────── 合法状态转移 ────────────────

type OrderStatus = Order['status'];

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['PENDING_CONFIRM', 'CANCELLED'],
  PENDING_CONFIRM: ['LOCKED', 'CANCELLED'],
  LOCKED: ['PAID', 'CANCELLED'],
  PAID: ['IN_SERVICE', 'CANCELLED', 'DISPUTED'],
  IN_SERVICE: ['COMPLETED', 'DISPUTED'],
  COMPLETED: ['REVIEWED', 'DISPUTED'],
  REVIEWED: ['DISPUTED', 'CLOSED'],
  DISPUTED: ['REFUNDED', 'COMPLETED', 'CLOSED'],
  CANCELLED: ['CLOSED'],
  REFUNDED: ['CLOSED'],
  CLOSED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

function assertCanTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransition(from, to)) {
    throw HttpError.conflict(
      ErrorCode.E3050_ORDER_STATE_ILLEGAL,
      `illegal transition ${from} -> ${to}`,
    );
  }
}

// ──────────────── 业务接口 ────────────────

export interface ServiceSnapshot {
  skills: string[];
  durationMin: number;
  pricePoints: number;
  itemsBreakdown?: Array<{ name: string; pricePoints: number }>;
}

export interface CreateOrderParams {
  customerId: string;
  therapistId: string;
  serviceSnapshot: ServiceSnapshot;
  scheduledAt?: Date;
  /** M02b/M04 Phase 1 · 节目订单 · 提供后 atomic claim 1 名额 */
  sourceShowId?: string;
  /** 本单服务方式 · 仅 both 技师下单时由客户选(incall/outcall 技师自动定) */
  serviceMode?: 'incall' | 'outcall';
  // ──────── 上门服务 · 客户上门地址(本单=上门时必填)────────
  customerAddress?: string;
  customerAddressNote?: string;
  customerAddressMedia?: CustomerAddressMediaItem[];
  customerLat?: string;
  customerLng?: string;
  customerAreaName?: string;
}

export interface OrderContext {
  db: Database;
}

function generateOrderNo(): string {
  const d = new Date();
  const yyyymmdd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `LR${yyyymmdd}${nanoid(8).toUpperCase()}`;
}

/** 心动金默认冻结比例 · 1000 bps = 10%(法币 show 可用 depositRatioBps 覆盖) */
const DEFAULT_DEPOSIT_RATIO_BPS = 1000;

export interface OrderPricing {
  currencyCode: string | null;
  totalFiat: number | null;
  /** 心动金计费基数(积分) */
  totalPoints: number;
  /** 下单应冻结的心动金(积分) */
  depositPoints: number;
}

/**
 * 统一定价 + 心动金计算(下单 createOrder / 报价 quoteOrder 共用)。
 * - 法币模式(sourceShowId 且 show 配了法币价):total 从 show 法币换算成积分。
 * - 其余(纯积分订单):基数 = serviceSnapshot.pricePoints。
 * 关键:**任何订单都算出 depositPoints** —— 这是"所有订单都要冻结心动金"闭环的唯一口径,
 *       不再像旧逻辑那样只有法币 show 订单才有 deposit。
 */
export async function computeOrderPricing(
  ctx: OrderContext,
  args: { serviceSnapshot: ServiceSnapshot; sourceShowId?: string },
): Promise<OrderPricing> {
  // 法币模式 · 拿 show 的 currency_code 判断
  if (args.sourceShowId) {
    const showRow = await ctx.db.query.shows.findFirst({ where: eq(shows.id, args.sourceShowId) });
    if (showRow?.currencyCode && showRow.priceFiat) {
      const baseFiat = parseFloat(showRow.priceFiat);
      const addOnsV2Fiat = (showRow.addOnsV2 ?? []).reduce(
        (sum, a) => sum + (a.isDefault ? a.priceFiat : 0),
        0,
      );
      const totalFiat = baseFiat + addOnsV2Fiat;
      const { convertFiatToPoints } = await import('./fx');
      const totalPoints = await convertFiatToPoints({ db: ctx.db }, totalFiat, showRow.currencyCode);
      const ratio = showRow.depositRatioBps ?? DEFAULT_DEPOSIT_RATIO_BPS;
      const depositPoints = Math.ceil((totalPoints * ratio) / 10000);
      return { currencyCode: showRow.currencyCode, totalFiat, totalPoints, depositPoints };
    }
  }
  // 纯积分模式 · 基数 = 服务快照积分价
  const totalPoints = Math.max(0, args.serviceSnapshot.pricePoints ?? 0);
  const depositPoints = Math.ceil((totalPoints * DEFAULT_DEPOSIT_RATIO_BPS) / 10000);
  return { currencyCode: null, totalFiat: null, totalPoints, depositPoints };
}

/**
 * 下单报价(不建单 · 无副作用)· 给前端"下单前预检余额是否够冻结心动金"用。
 * 复用 computeOrderPricing,保证报价与真实下单口径完全一致。
 */
export async function quoteOrder(
  ctx: OrderContext,
  args: { therapistId: string; serviceSnapshot: ServiceSnapshot; sourceShowId?: string },
): Promise<OrderPricing> {
  const therapist = await ctx.db.query.therapists.findFirst({ where: eq(therapists.id, args.therapistId) });
  if (!therapist) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');
  }
  return computeOrderPricing(ctx, { serviceSnapshot: args.serviceSnapshot, sourceShowId: args.sourceShowId });
}

export async function createOrder(ctx: OrderContext, p: CreateOrderParams): Promise<Order> {
  const therapist = await ctx.db.query.therapists.findFirst({
    where: eq(therapists.id, p.therapistId),
  });
  if (!therapist) {
    throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');
  }

  // 防暂停/封禁技师收新订单 · admin 操作的最后一道防线
  // 已下单的不动 · 仅拦截新建
  const therapistUser = await ctx.db.query.users.findFirst({
    where: eq(users.id, therapist.userId),
  });
  if (!therapistUser || therapistUser.status !== 'active') {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, '该技师已下架 · 暂时无法预约');
  }

  // M07 · 排班冲突检测(scheduledAt 必填时才校验 · 兼容暂未设定时间的草稿)
  if (p.scheduledAt) {
    const { checkBookingConflict } = await import('./availability');
    const check = await checkBookingConflict(ctx.db, {
      therapistUserId: therapist.userId,
      scheduledAt: p.scheduledAt,
      durationMin: p.serviceSnapshot.durationMin ?? 60,
    });
    if (!check.ok) {
      const msg = {
        booked: '该时段已被预约 · 请选其它时段',
        closed: '该时段技师不工作 · 请选其它时段',
        time_off: '该时段技师休假 · 请选其它时段',
        past: '不能预约过去的时间',
      }[check.reason];
      throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, msg);
    }
  }

  // ──────── 本单服务方式(到店 / 上门)────────
  // incall/outcall 技师固定;both 技师由客户下单时选(p.serviceMode),缺省 outcall(历史默认=上门)。
  // 门控/采集/校验一律以【本单模式】为准,而非技师模式——否则 both 技师每单会双向交换地址且强逼填址。
  const orderServiceMode: 'incall' | 'outcall' =
    therapist.serviceMode === 'incall'
      ? 'incall'
      : therapist.serviceMode === 'outcall'
        ? 'outcall'
        : p.serviceMode === 'incall'
          ? 'incall'
          : 'outcall';

  // ──────── 上门服务 · 客户上门地址校验 + 清洗(仅本单=上门)────────
  // 到店单忽略客户地址(客户来店,不需要)。
  const isOutcall = orderServiceMode === 'outcall';
  let cleanCustomerMedia: CustomerAddressMediaItem[] = [];
  if (isOutcall) {
    if (!p.customerAddress || p.customerAddress.trim().length === 0) {
      throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, '上门服务需填写上门地址');
    }
    // 媒体归属校验:仅保留属于本客户(ownerUserId===customerId)的 mediaId,非法剔除
    if (Array.isArray(p.customerAddressMedia) && p.customerAddressMedia.length > 0) {
      const ids = p.customerAddressMedia.map((m) => m.mediaId);
      const rows = await ctx.db
        .select({ id: mediaAssets.id, ownerUserId: mediaAssets.ownerUserId })
        .from(mediaAssets)
        .where(inArray(mediaAssets.id, ids));
      const ownByCustomer = new Set(rows.filter((r) => r.ownerUserId === p.customerId).map((r) => r.id));
      cleanCustomerMedia = p.customerAddressMedia.filter((m) => ownByCustomer.has(m.mediaId));
    }
    // 距离校验:坐标齐全 且 技师有区域中心坐标 → 超阈值拦下单(坐标缺失则跳过,不拦)
    if (p.customerLat && p.customerLng) {
      const center = await resolveTherapistAreaCenter(ctx.db, {
        serviceAreaId: therapist.serviceAreaId,
        serviceCityId: therapist.serviceCityId,
      });
      if (center.lat && center.lng) {
        const d = distanceKm(center.lat, center.lng, p.customerLat, p.customerLng);
        if (d != null && d > OUTCALL_MAX_DISTANCE_KM) {
          throw HttpError.badRequest(
            ErrorCode.E0001_INVALID_PARAM,
            '超出技师上门范围,换个地址或选其他技师',
          );
        }
      }
    }
  }

  // ──────── 统一定价 + 心动金计算(所有订单都算 depositPoints) ────────
  const pricing = await computeOrderPricing(ctx, {
    serviceSnapshot: p.serviceSnapshot,
    sourceShowId: p.sourceShowId,
  });

  // M02b/M04 Phase 1 · 节目订单 · 创建 order 前 atomic 扣 1 名额
  // 失败抛 409 已售罄 · 在 order 创建之前 · 不会有副作用
  if (p.sourceShowId) {
    const { claimShowSlot } = await import('./shows');
    await claimShowSlot({ db: ctx.db }, p.sourceShowId);
  }

  const [order] = await ctx.db
    .insert(orders)
    .values({
      orderNo: generateOrderNo(),
      customerId: p.customerId,
      therapistId: therapist.id,
      therapistUserId: therapist.userId,
      status: 'DRAFT',
      serviceSnapshot: p.serviceSnapshot,
      pricePoints: p.serviceSnapshot.pricePoints,
      scheduledAt: p.scheduledAt,
      sourceShowId: p.sourceShowId,
      // 0027 法币模式字段(null = 老积分模式)
      currencyCode: pricing.currencyCode,
      totalFiat: pricing.totalFiat != null ? String(pricing.totalFiat) : null,
      // 心动金:DRAFT 阶段只存"应冻结额"(展示用),提交(submit)时才真正 hold。
      // depositStatus 保持 null → 未冻结;submitOrder 调 holdDeposit 后置 HOLDING。
      depositPoints: pricing.depositPoints > 0 ? pricing.depositPoints : null,
      depositStatus: null,
      // 本单服务方式(到店/上门)· 门控/投递一律以此为准
      serviceMode: orderServiceMode,
      // 上门服务 · 客户上门地址(仅本单=上门写入;到店忽略)
      ...(isOutcall
        ? {
            customerAddress: p.customerAddress ?? null,
            customerAddressNote: p.customerAddressNote ?? null,
            customerAddressMedia: cleanCustomerMedia,
            customerLat: p.customerLat ?? null,
            customerLng: p.customerLng ?? null,
            customerAreaName: p.customerAreaName ?? null,
          }
        : {}),
    })
    .returning();

  if (!order) throw HttpError.internal('order create failed');

  await appendChainEvent(ctx.db, {
    orderId: order.id,
    event: 'order_created',
    payload: {
      orderNo: order.orderNo,
      customerId: p.customerId,
      therapistId: therapist.id,
      pricePoints: p.serviceSnapshot.pricePoints,
      serviceSnapshot: p.serviceSnapshot,
    },
    actorUserId: p.customerId,
    actorRole: 'customer',
  });

  // 无效账户治理 · 首次下单视为激活(双方都标,幂等)
  markActivatedAsync(ctx.db, p.customerId);
  markActivatedAsync(ctx.db, therapist.userId);

  return order;
}

async function transition(
  ctx: OrderContext,
  orderId: string,
  to: OrderStatus,
  chain: {
    event: Parameters<typeof appendChainEvent>[1]['event'];
    payload: Record<string, unknown>;
    actorUserId?: string;
    actorRole?: 'customer' | 'therapist' | 'system' | 'admin';
  },
  patch?: Partial<Order>,
): Promise<Order> {
  const current = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!current) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');

  assertCanTransition(current.status, to);

  const updates: Partial<Order> = { status: to, updatedAt: new Date(), ...patch };

  const [updated] = await ctx.db
    .update(orders)
    .set(updates as Record<string, unknown>)
    .where(eq(orders.id, orderId))
    .returning();

  if (!updated) throw HttpError.internal('order update failed');

  await appendChainEvent(ctx.db, { orderId, ...chain });
  return updated;
}

/**
 * 客户提交订单 → 待技师确认。
 * 闭环关键:**提交即冻结心动金**(客户在此刻做出承诺)。
 *  - 余额不足时 holdDeposit 内 debit 抛 E2010_BALANCE_INSUFFICIENT,提交失败、订单留 DRAFT,
 *    充值后可重新提交(前端已做余额预检,正常不会走到这)。
 *  - 先冻结、后流转:冻结失败则状态不变,绝不出现"已待确认却没冻钱"的洞。
 */
export async function submitOrder(ctx: OrderContext, orderId: string, customerId: string) {
  const current = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!current) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');
  if (current.customerId !== customerId) {
    throw HttpError.forbidden(ErrorCode.E3050_ORDER_STATE_ILLEGAL, 'not your order');
  }

  // 冻结心动金(幂等:已 HOLDING 不重复冻;depositPoints 为空/0 的免保证金单跳过)
  if (current.depositPoints && current.depositPoints > 0 && current.depositStatus !== 'HOLDING') {
    const { holdDeposit } = await import('./deposits');
    await holdDeposit({ db: ctx.db }, {
      orderId: current.id,
      customerId: current.customerId,
      therapistUserId: current.therapistUserId,
      depositPoints: current.depositPoints,
    });
  }

  const order = await transition(
    ctx,
    orderId,
    'PENDING_CONFIRM',
    { event: 'order_created', payload: { submittedBy: customerId }, actorUserId: customerId, actorRole: 'customer' },
    { pendingConfirmAt: new Date() }, // 超时自动取消的计时基准
  );
  // 下单成功(锁定预约+冻结心动金) → 分身发一条情绪价值反馈到对话。
  // fire-and-forget:绝不阻断/失败订单(反馈挂了订单照样成),reactToOrderPlaced 自身也不抛。
  void (async () => {
    try {
      const { reactToOrderPlaced } = await import('./ai_alter');
      await reactToOrderPlaced({ db: ctx.db }, { therapistUserId: current.therapistUserId, customerId });
    } catch (err) {
      console.warn('[submitOrder] order-placed reaction failed:', (err as Error)?.message);
    }
  })();
  return order;
}

/**
 * 系统超时取消:待技师确认超过时限未确认 → 自动取消 + 退还冻结心动金 + 通知双方。
 * 幂等:订单已不在 PENDING_CONFIRM(已确认/已被取消)则跳过。复用 cancelOrder(已解冻资金)。
 */
export async function expirePendingConfirmOrder(ctx: OrderContext, orderId: string): Promise<boolean> {
  const current = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!current || current.status !== 'PENDING_CONFIRM') return false; // 幂等:状态已变(技师刚确认/并发取消)
  await cancelOrder(ctx, orderId, current.customerId, 'pending_confirm_timeout', 'system');
  try {
    const { enqueue } = await import('./notifications');
    await enqueue({ db: ctx.db }, {
      recipientUserId: current.customerId,
      category: 'order_status',
      level: 'important',
      title: '订单已自动取消',
      body: '技师未在 2 小时内确认，订单已自动取消，冻结的心动金已全额退回。',
      refType: 'order',
      refId: orderId,
    });
    await enqueue({ db: ctx.db }, {
      recipientUserId: current.therapistUserId,
      category: 'order_status',
      level: 'important',
      title: '订单超时已取消',
      body: '有一笔订单因 2 小时内未确认被系统自动取消。及时接单可避免流失客户。',
      refType: 'order',
      refId: orderId,
    });
  } catch { /* 通知失败不影响取消 */ }
  return true;
}

/** 技师确认 + 锁价 */
export async function confirmAndLock(ctx: OrderContext, orderId: string, therapistUserId: string): Promise<Order> {
  const current = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!current) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');
  if (current.therapistUserId !== therapistUserId) {
    throw HttpError.forbidden(ErrorCode.E3050_ORDER_STATE_ILLEGAL, 'not your order');
  }

  const lockedAt = new Date();
  const priceLockHash = await computePriceLockHash({
    orderId: current.id,
    pricePoints: current.pricePoints,
    serviceSnapshot: current.serviceSnapshot,
    lockedAt,
  });

  const locked = await transition(
    ctx,
    orderId,
    'LOCKED',
    {
      event: 'price_locked',
      payload: {
        pricePoints: current.pricePoints,
        serviceSnapshot: current.serviceSnapshot,
        lockedAt: lockedAt.toISOString(),
        priceLockHash,
      },
      actorUserId: therapistUserId,
      actorRole: 'therapist',
    },
    { priceLockedAt: lockedAt, priceLockHash },
  );

  // 到店服务 · 确认锁单后自动投递门店信息(私聊卡 + 推送)
  // 非事务内 · try/catch 全包 · 失败只记日志,绝不影响 confirmAndLock 返回。
  await deliverShopInfoOnLock(ctx, locked).catch((err) => {
    console.warn('[orders] deliverShopInfoOnLock failed (不阻断确认):', err instanceof Error ? err.message : err);
  });

  // 上门服务 · 确认锁单后把客户上门地址投递给技师(私聊卡 + 推送)
  // 非事务内 · try/catch 全包 · 失败只记日志,绝不影响 confirmAndLock 返回。
  await deliverCustomerLocationOnLock(ctx, locked).catch((err) => {
    console.warn('[orders] deliverCustomerLocationOnLock failed (不阻断确认):', err instanceof Error ? err.message : err);
  });

  return locked;
}

/**
 * 上门服务 · confirmAndLock 成功后把客户上门地址投递给技师:
 *   1) openConversation(customer, therapist) + sendMessage(type='customer_location') 以技师身份(isAiAlter=0,发给会话)
 *   2) enqueueNotification(category 'order_status') 给【技师】· deepLink 技师订单详情
 * 仅当技师 serviceMode∈{outcall,both} 且订单有 customerAddress 时执行;media 只含 approved。
 * 全程不抛(由调用方 .catch 兜底,这里也自包 try/catch 双保险)。
 */
async function deliverCustomerLocationOnLock(ctx: OrderContext, order: Order): Promise<void> {
  try {
    const therapistRow = await getTherapistByUserId({ db: ctx.db }, order.therapistUserId);
    if (!therapistRow) return;
    if (!customerLocationVisibleToTherapist(order.status, order.serviceMode ?? therapistRow.serviceMode)) return;
    if (!order.customerAddress) return; // 客户未填上门地址 → 不投递

    const loc = await buildCustomerLocation(ctx.db, {
      address: order.customerAddress,
      note: order.customerAddressNote,
      areaName: order.customerAreaName,
      lat: order.customerLat,
      lng: order.customerLng,
      media: order.customerAddressMedia,
      full: true,
    });

    const { openConversation, sendMessage } = await import('./chat');
    const conv = await openConversation(
      { db: ctx.db },
      { customerId: order.customerId, therapistUserId: order.therapistUserId },
    );
    await sendMessage(
      { db: ctx.db },
      {
        conversationId: conv.id,
        senderUserId: order.therapistUserId,
        text: JSON.stringify({
          orderNo: order.orderNo,
          address: loc.address,
          note: loc.note,
          areaName: loc.areaName,
          media: loc.media,
          lat: loc.lat,
          lng: loc.lng,
        }),
        type: 'customer_location',
        isAiAlter: false,
      },
    );

    const { enqueue } = await import('./notifications');
    const { t: tr } = await import('@loverush/i18n');
    const tUser = await ctx.db.query.users.findFirst({ where: eq(users.id, order.therapistUserId), columns: { locale: true } });
    const notifLoc = (tUser?.locale ?? 'zh') as Parameters<typeof tr>[1];
    await enqueue(
      { db: ctx.db },
      {
        recipientUserId: order.therapistUserId,
        category: 'order_status',
        level: 'important',
        title: tr('addr.notifCustTitle', notifLoc),
        body: tr('addr.notifCustBody', notifLoc),
        refType: 'order',
        refId: order.id,
        deepLink: `/t/orders/${order.id}`,
      },
    );
  } catch (err) {
    console.warn('[orders] deliverCustomerLocationOnLock inner failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * 到店服务 · confirmAndLock 成功后投递门店信息:
 *   1) openConversation(customer, therapist) + sendMessage(type='shop_info') 以技师身份(isAiAlter=0)
 *   2) enqueueNotification(category 'order_status') deepLink 到订单详情
 * 仅当技师 serviceMode∈{incall,both} 且有门店地址时执行;guideMedia 只含 approved。
 * 全程不抛(由调用方 .catch 兜底,这里也自包 try/catch 双保险)。
 */
async function deliverShopInfoOnLock(ctx: OrderContext, order: Order): Promise<void> {
  try {
    const therapistRow = await getTherapistByUserId({ db: ctx.db }, order.therapistUserId);
    if (!therapistRow) return;
    if (!shopInfoVisible(order.status, order.serviceMode ?? therapistRow.serviceMode)) return;
    const address = therapistRow.serviceAddressFullEncrypted;
    if (!address) return; // 技师未填门店地址 → 不投递(订单详情区块会兜底提示)

    const info = await buildShopInfo(ctx.db, {
      address,
      arrivalNote: therapistRow.shopArrivalNote,
      shopGuideMedia: therapistRow.shopGuideMedia,
    });

    // 快照门店信息到订单 metadata:确认那刻定格。技师日后改店址不影响已确认订单
    // (订单详情 + 私聊卡读同一份快照,绝不出现"卡片旧址 vs 详情新址"漂移)。
    await ctx.db
      .update(orders)
      .set({ metadata: { ...((order.metadata as Record<string, unknown>) ?? {}), shopSnapshot: info } })
      .where(eq(orders.id, order.id));

    const { openConversation, sendMessage } = await import('./chat');
    const conv = await openConversation(
      { db: ctx.db },
      { customerId: order.customerId, therapistUserId: order.therapistUserId },
    );
    await sendMessage(
      { db: ctx.db },
      {
        conversationId: conv.id,
        senderUserId: order.therapistUserId,
        text: JSON.stringify({
          orderNo: order.orderNo,
          address: info.address,
          arrivalNote: info.arrivalNote,
          guideMedia: info.guideMedia,
        }),
        type: 'shop_info',
        isAiAlter: false,
      },
    );

    const { enqueue } = await import('./notifications');
    const { t: tr } = await import('@loverush/i18n');
    const cUser = await ctx.db.query.users.findFirst({ where: eq(users.id, order.customerId), columns: { locale: true } });
    const notifLoc = (cUser?.locale ?? 'zh') as Parameters<typeof tr>[1];
    await enqueue(
      { db: ctx.db },
      {
        recipientUserId: order.customerId,
        category: 'order_status',
        level: 'important',
        title: tr('addr.notifShopTitle', notifLoc),
        body: tr('addr.notifShopBody', notifLoc),
        refType: 'order',
        refId: order.id,
        deepLink: `/order/${order.id}`,
      },
    );
  } catch (err) {
    console.warn('[orders] deliverShopInfoOnLock inner failed:', err instanceof Error ? err.message : err);
  }
}

/** 客户支付完成 */
export async function markPaid(
  ctx: OrderContext,
  orderId: string,
  paymentTxnId: string,
  customerId: string,
): Promise<Order> {
  return transition(
    ctx,
    orderId,
    'PAID',
    {
      event: 'payment_received',
      payload: { paymentTxnId, paidAt: new Date().toISOString() },
      actorUserId: customerId,
      actorRole: 'customer',
    },
    { paidAt: new Date(), paymentTxnId },
  );
}

/** 技师开始服务 */
export async function startService(ctx: OrderContext, orderId: string, therapistUserId: string): Promise<Order> {
  return transition(
    ctx,
    orderId,
    'IN_SERVICE',
    {
      event: 'service_started',
      payload: { startedAt: new Date().toISOString() },
      actorUserId: therapistUserId,
      actorRole: 'therapist',
    },
    { startedAt: new Date() },
  );
}

/** 技师标记完成 */
export async function completeService(ctx: OrderContext, orderId: string, therapistUserId: string): Promise<Order> {
  const completedAt = new Date();
  const result = await transition(
    ctx,
    orderId,
    'COMPLETED',
    {
      event: 'service_completed',
      payload: { completedAt: completedAt.toISOString() },
      actorUserId: therapistUserId,
      actorRole: 'therapist',
    },
    { completedAt },
  );
  // 0027 · 法币模式订单完成 → 自动 release 心动金给客户
  // 老积分订单 deposit_points 为 null · releaseDeposit 内 noop
  if (result.depositStatus === 'HOLDING' && result.depositPoints) {
    const { releaseDeposit } = await import('./deposits');
    await releaseDeposit({ db: ctx.db }, orderId, 'auto_complete');
  }
  return result;
}

// ──────────────── 0027 法币 + 心动金 · 4 个新 endpoint ────────────────

/**
 * 技师确认已线下收款 · 把订单从 LOCKED → PAID(用 offline_paid_at 替代 paid_at)
 * 新模式订单不走 markPaid 那条线(没有 paymentTxnId)
 */
export async function confirmOfflinePaid(
  ctx: OrderContext,
  orderId: string,
  therapistUserId: string,
): Promise<Order> {
  const current = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!current) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');
  if (current.therapistUserId !== therapistUserId) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'not your order');
  }
  if (!current.currencyCode) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'only fiat-mode orders');
  }
  const now = new Date();
  return transition(
    ctx,
    orderId,
    'PAID',
    {
      event: 'payment_received',
      payload: { offlinePaidAt: now.toISOString(), via: 'offline_cash' },
      actorUserId: therapistUserId,
      actorRole: 'therapist',
    },
    { offlinePaidAt: now },
  );
}

/**
 * 技师标记客户没到场 · 触发心动金 50/50 分账给技师+平台
 * 只允许 scheduledAt + 30min 后调(防早扣留)
 */
export async function customerNoShow(
  ctx: OrderContext,
  orderId: string,
  therapistUserId: string,
): Promise<Order> {
  const current = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!current) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');
  if (current.therapistUserId !== therapistUserId) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'not your order');
  }
  if (!current.scheduledAt) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'order has no scheduled time');
  }
  if (Date.now() < current.scheduledAt.getTime() + 30 * 60 * 1000) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, '需到约定时间 30 分钟后才能标记');
  }

  const { forfeitDeposit } = await import('./deposits');
  await forfeitDeposit({ db: ctx.db }, orderId);

  return transition(
    ctx,
    orderId,
    'CANCELLED',
    {
      event: 'refund_executed',
      payload: { reason: 'customer_no_show', forfeitTo: 'therapist_50_platform_50' },
      actorUserId: therapistUserId,
      actorRole: 'therapist',
    },
    { metadata: { ...((current.metadata as Record<string, unknown>) ?? {}), customerNoShow: true } },
  );
}

/**
 * 客户标记技师没到场 · 全退心动金 + 技师降信用分
 * 不需要时间约束(客户随时可标 · 但 admin 仲裁可以纠正)
 */
export async function therapistNoShow(
  ctx: OrderContext,
  orderId: string,
  customerId: string,
): Promise<Order> {
  const current = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!current) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');
  if (current.customerId !== customerId) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'not your order');
  }

  const { refundDeposit } = await import('./deposits');
  await refundDeposit({ db: ctx.db }, orderId, 'therapist_no_show');

  return transition(
    ctx,
    orderId,
    'CANCELLED',
    {
      event: 'refund_executed',
      payload: { reason: 'therapist_no_show', refundedTo: 'customer_full' },
      actorUserId: customerId,
      actorRole: 'customer',
    },
    { metadata: { ...((current.metadata as Record<string, unknown>) ?? {}), therapistNoShow: true } },
  );
}

/** 客户评价 → 进入 REVIEWED */
export async function reviewOrder(
  ctx: OrderContext,
  orderId: string,
  customerId: string,
  payload: { rating: number; review?: string },
): Promise<Order> {
  if (payload.rating < 1 || payload.rating > 5) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'rating must be 1-5');
  }
  return transition(
    ctx,
    orderId,
    'REVIEWED',
    {
      event: 'review_submitted',
      payload: { rating: payload.rating, review: payload.review ?? null },
      actorUserId: customerId,
      actorRole: 'customer',
    },
    {
      reviewedAt: new Date(),
      customerRating: payload.rating,
      customerReview: payload.review,
    },
  );
}

/** 取消订单（任意可取消阶段） */
export async function cancelOrder(
  ctx: OrderContext,
  orderId: string,
  actorUserId: string,
  reason: string,
  actorRole: 'customer' | 'therapist' | 'admin' | 'system' = 'customer',
): Promise<Order> {
  const current = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!current) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'order not found');

  // 资金安全 + 跳单惩罚:取消前处理冻结心动金。
  //  - 确认前(DRAFT/待确认)取消、技师/admin/system 取消、或确认后 5 分钟宽限内取消 → 全额退客户(无过错)。
  //  - 客户在技师确认后(LOCKED/PAID,地址已泄露)取消 且 超 5 分钟宽限 → 扣 50% 违约金(全归平台),退 50%。
  //    判定用 actorUserId 实际对比订单(不信传入 role);宽限期从 priceLockedAt 起算。
  if (current.depositStatus === 'HOLDING') {
    const GRACE_MS = 5 * 60 * 1000;
    const isCustomerCancel = actorUserId === current.customerId && actorRole !== 'admin' && actorRole !== 'system';
    const afterConfirm = current.status === 'LOCKED' || current.status === 'PAID';
    const withinGrace =
      current.priceLockedAt != null && Date.now() - new Date(current.priceLockedAt).getTime() < GRACE_MS;
    const penalize = isCustomerCancel && afterConfirm && !withinGrace;

    const deposits = await import('./deposits');
    if (penalize) {
      await deposits.forfeitDepositOnCancel({ db: ctx.db }, orderId, { customerRefundBps: 5000 });
    } else {
      await deposits.releaseDeposit({ db: ctx.db }, orderId, 'order_cancelled');
    }
  }

  return transition(
    ctx,
    orderId,
    'CANCELLED',
    {
      event: 'order_created',
      payload: { cancelReason: reason, cancelledBy: actorRole },
      actorUserId,
      actorRole,
    },
  );
}

/** 提起争议 */
export async function raiseDispute(
  ctx: OrderContext,
  orderId: string,
  actorUserId: string,
  reason: string,
  actorRole: 'customer' | 'therapist' = 'customer',
): Promise<Order> {
  return transition(
    ctx,
    orderId,
    'DISPUTED',
    {
      event: 'dispute_raised',
      payload: { reason, raisedBy: actorRole },
      actorUserId,
      actorRole,
    },
    { disputeOpenedAt: new Date(), disputeReason: reason },
  );
}

/** 仲裁退款 */
export async function resolveDispute(
  ctx: OrderContext,
  orderId: string,
  adminUserId: string,
  outcome: { resolution: 'refund' | 'reject'; refundPoints?: number; note?: string },
): Promise<Order> {
  if (outcome.resolution === 'refund') {
    const refundPoints = outcome.refundPoints ?? 0;
    const o = await transition(
      ctx,
      orderId,
      'REFUNDED',
      {
        event: 'dispute_resolved',
        payload: { resolution: 'refund', refundPoints, note: outcome.note },
        actorUserId: adminUserId,
        actorRole: 'admin',
      },
      { refundedAt: new Date(), refundPoints },
    );
    return o;
  }
  return transition(
    ctx,
    orderId,
    'COMPLETED',
    {
      event: 'dispute_resolved',
      payload: { resolution: 'reject', note: outcome.note },
      actorUserId: adminUserId,
      actorRole: 'admin',
    },
  );
}

/** 增加技师完成单数（外部统计调用） */
export interface ListOrdersParams {
  userId: string;
  role: 'customer' | 'therapist';
  status?: OrderStatus | OrderStatus[];
  limit?: number;
  offset?: number;
}

/** 列表项 = 订单原始行 + 老订单法币即时估算 + 对手方(技师)头像/昵称,给列表卡片展示用 */
export interface OrderListItem extends Order {
  fiatEstimated: boolean;
  therapistName: string | null;
  therapistAvatarUrl: string | null;
}

export async function listOrders(ctx: OrderContext, p: ListOrdersParams): Promise<OrderListItem[]> {
  const limit = Math.min(Math.max(p.limit ?? 30, 1), 100);
  const offset = Math.max(p.offset ?? 0, 0);

  const conditions = [
    p.role === 'customer'
      ? eq(orders.customerId, p.userId)
      : eq(orders.therapistUserId, p.userId),
  ];

  if (p.status) {
    const statuses = Array.isArray(p.status) ? p.status : [p.status];
    if (statuses.length === 1) {
      conditions.push(eq(orders.status, statuses[0]!));
    } else if (statuses.length > 1) {
      conditions.push(sql`${orders.status} = ANY(${statuses})`);
    }
  }

  const rows = await ctx.db.query.orders.findMany({
    where: (_t, { and }) => (conditions.length > 1 ? and(...conditions) : conditions[0]),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit,
    offset,
  });

  // 批量查技师(老订单法币估算 + 头像共用)+ 用户(昵称),避免 N+1
  const therapistUserIds = [...new Set(rows.map((r) => r.therapistUserId))];
  const [therapistList, userRows] = therapistUserIds.length > 0
    ? await Promise.all([
        ctx.db.query.therapists.findMany({ where: inArray(therapists.userId, therapistUserIds) }),
        ctx.db.query.users.findMany({ where: inArray(users.id, therapistUserIds) }),
      ])
    : [[], []];
  const therapistMap = new Map<string, Therapist>(therapistList.map((t) => [t.userId, t]));
  const nameMap = new Map(userRows.map((u) => [u.id, u.displayName]));

  return Promise.all(
    rows.map(async (r) => {
      const t = therapistMap.get(r.therapistUserId) ?? null;
      const fiat = await estimateOrderFiat(ctx, r, t);
      return {
        ...r,
        ...fiat,
        therapistName: nameMap.get(r.therapistUserId) ?? null,
        therapistAvatarUrl: t?.avatarUrl ?? null,
      };
    }),
  );
}

export async function bumpTherapistStats(ctx: OrderContext, therapistId: string) {
  await ctx.db
    .update(therapists)
    .set({ completedOrders: sql`${therapists.completedOrders} + 1` })
    .where(eq(therapists.id, therapistId));
}

// ──────────────── admin 列表/详情(运营总监看订单大盘) ────────────────

export interface AdminOrderRow {
  id: string;
  orderNo: string;
  customerId: string;
  customerName: string | null;
  therapistUserId: string;
  therapistName: string | null;
  status: OrderStatus;
  pricePoints: number;
  durationMin: number;
  disputeOpenedAt: Date | null;
  disputeReason: string | null;
  refundPoints: number | null;
  createdAt: Date;
  // 0027 法币模型 · 老积分订单这些为 null
  currencyCode: string | null;
  totalFiat: string | null;
  depositPoints: number | null;
  depositStatus: string | null;
  offlinePaidAt: Date | null;
  // 地区(技师服务地) · uuid 字典优先 · 旧 text 兜底 · 缺则 null
  therapistCountryCode: string | null;
  therapistCityName: string | null;
  therapistAreaName: string | null;
  // 评价分(orders 表自带)
  customerRating: number | null;
  // 派生支付状态:线下已收 / 线上已付 / 未收
  paymentState: 'offline_paid' | 'online_paid' | 'unpaid';
  // 金额人话标签:法币单 '฿1,500.00' · 估算标 '≈' · 无汇率老单 'x 积分'
  amountLabel: string;
  isLegacyPoints: boolean; // 纯积分老单(无法估算法币)
  fiatEstimated: boolean; // 法币是按汇率即时估算(非真实下单价)
}

/** 地名取值 · 优先 zh · 兜底 en · 再 fallback(旧 text 字段) */
function pickRegionName(
  translations: Record<string, string> | null | undefined,
  fallback: string | null,
): string | null {
  if (!translations) return fallback;
  return translations.zh ?? translations.en ?? fallback;
}

/** admin 订单 list/summary 共用的筛选条件 */
export interface AdminOrderFilters {
  status?: OrderStatus;
  search?: string; // 订单号 / 客户名 / 技师名 模糊
  customerId?: string;
  therapistUserId?: string;
  currencyCode?: string;
  paidState?: 'paid' | 'unpaid';
  country?: string; // ISO alpha-2
  cityId?: string; // cities.id
  createdFrom?: string; // ISO
  createdTo?: string; // ISO
}

/** 按地区(国家/城市)找匹配技师 userIds · 字典 id 优先 · 旧 text 兜底 */
async function findTherapistUserIdsByRegion(
  ctx: OrderContext,
  country?: string,
  cityId?: string,
): Promise<string[]> {
  const rows = (await ctx.db.execute(sql`
    SELECT t.user_id
    FROM therapists t
    LEFT JOIN cities c ON t.service_city_id = c.id
    WHERE 1=1
      ${country ? sql`AND (c.country_code = ${country} OR t.service_country = ${country})` : sql``}
      ${cityId ? sql`AND t.service_city_id = ${cityId}` : sql``}
  `)) as unknown as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

/** list/summary 共用筛选条件(地区筛选需先异步查技师 userIds) */
async function buildAdminOrderConditions(ctx: OrderContext, p: AdminOrderFilters) {
  const conditions = [];
  if (p.status) conditions.push(eq(orders.status, p.status));
  if (p.search) {
    // 搜索:订单号 ILIKE,或 客户/技师昵称 ILIKE(先查匹配名字的 userId 再 IN)
    const term = '%' + p.search + '%';
    const matched = await ctx.db.query.users.findMany({
      where: sql`${users.displayName} ILIKE ${term}`,
      columns: { id: true },
    });
    const ids = matched.map((u) => u.id);
    const ors = [sql`${orders.orderNo} ILIKE ${term}`];
    if (ids.length > 0) {
      ors.push(inArray(orders.customerId, ids));
      ors.push(inArray(orders.therapistUserId, ids));
    }
    conditions.push(or(...ors)!);
  }
  if (p.customerId) conditions.push(eq(orders.customerId, p.customerId));
  if (p.therapistUserId) conditions.push(eq(orders.therapistUserId, p.therapistUserId));
  if (p.currencyCode) conditions.push(eq(orders.currencyCode, p.currencyCode));
  if (p.createdFrom) conditions.push(sql`${orders.createdAt} >= ${p.createdFrom}`);
  if (p.createdTo) conditions.push(sql`${orders.createdAt} <= ${p.createdTo}`);
  if (p.paidState === 'paid') {
    conditions.push(sql`(${orders.paidAt} IS NOT NULL OR ${orders.offlinePaidAt} IS NOT NULL)`);
  }
  if (p.paidState === 'unpaid') {
    conditions.push(sql`(${orders.paidAt} IS NULL AND ${orders.offlinePaidAt} IS NULL)`);
  }
  if (p.country || p.cityId) {
    const tids = await findTherapistUserIdsByRegion(ctx, p.country, p.cityId);
    // 无匹配技师 → 恒假,返回空集(避免 inArray([]) 报错)
    conditions.push(tids.length > 0 ? inArray(orders.therapistUserId, tids) : sql`1=0`);
  }
  return conditions;
}

export async function adminListOrders(
  ctx: OrderContext,
  p: AdminOrderFilters & { limit?: number; offset?: number },
): Promise<AdminOrderRow[]> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  const offset = Math.max(p.offset ?? 0, 0);

  const conditions = await buildAdminOrderConditions(ctx, p);

  const rows = await ctx.db.query.orders.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(orders.createdAt)],
    limit,
    offset,
  });

  // 批量联查:用户昵称 + 技师(地区/默认币种) + 城市/区域字典(避免 N+1)
  const therapistUserIds = Array.from(new Set(rows.map((r) => r.therapistUserId)));
  const userIds = Array.from(new Set([...rows.map((r) => r.customerId), ...therapistUserIds]));
  const [userList, therapistList] = await Promise.all([
    userIds.length > 0 ? ctx.db.query.users.findMany({ where: inArray(users.id, userIds) }) : Promise.resolve([]),
    therapistUserIds.length > 0
      ? ctx.db.query.therapists.findMany({ where: inArray(therapists.userId, therapistUserIds) })
      : Promise.resolve([]),
  ]);
  const nameMap = new Map(userList.map((u) => [u.id, u.displayName]));
  const therapistMap = new Map<string, Therapist>(therapistList.map((t) => [t.userId, t]));

  const cityIds = Array.from(new Set(therapistList.map((t) => t.serviceCityId).filter((x): x is string => !!x)));
  const areaIds = Array.from(new Set(therapistList.map((t) => t.serviceAreaId).filter((x): x is string => !!x)));
  const [cityList, areaList] = await Promise.all([
    cityIds.length > 0 ? ctx.db.query.cities.findMany({ where: inArray(cities.id, cityIds) }) : Promise.resolve([]),
    areaIds.length > 0 ? ctx.db.query.areas.findMany({ where: inArray(areas.id, areaIds) }) : Promise.resolve([]),
  ]);
  const cityMap = new Map(cityList.map((c) => [c.id, c]));
  const areaMap = new Map(areaList.map((a) => [a.id, a]));

  return Promise.all(
    rows.map(async (r) => {
      const t = therapistMap.get(r.therapistUserId) ?? null;
      // 复用客户端口径:老积分单按技师默认币种 + 汇率即时估算法币(不写库,标 fiatEstimated)
      const fiat = await estimateOrderFiat(ctx, r, t);
      const amountLabel =
        fiat.totalFiat != null && fiat.currencyCode != null
          ? (fiat.fiatEstimated ? '≈' : '') + (await formatFiat(ctx, parseFloat(fiat.totalFiat), fiat.currencyCode))
          : `${r.pricePoints.toLocaleString()} 积分`;
      const city = t?.serviceCityId ? cityMap.get(t.serviceCityId) : null;
      const area = t?.serviceAreaId ? areaMap.get(t.serviceAreaId) : null;
      return {
        id: r.id,
        orderNo: r.orderNo,
        customerId: r.customerId,
        customerName: nameMap.get(r.customerId) ?? null,
        therapistUserId: r.therapistUserId,
        therapistName: nameMap.get(r.therapistUserId) ?? null,
        status: r.status,
        pricePoints: r.pricePoints,
        durationMin: r.serviceSnapshot?.durationMin ?? 0,
        disputeOpenedAt: r.disputeOpenedAt,
        disputeReason: r.disputeReason,
        refundPoints: r.refundPoints,
        createdAt: r.createdAt,
        currencyCode: fiat.currencyCode,
        totalFiat: fiat.totalFiat,
        depositPoints: r.depositPoints,
        depositStatus: r.depositStatus,
        offlinePaidAt: r.offlinePaidAt,
        therapistCountryCode: city?.countryCode ?? t?.serviceCountry ?? null,
        therapistCityName: city
          ? pickRegionName(city.translations, t?.serviceCity ?? null)
          : t?.serviceCity ?? null,
        therapistAreaName: area
          ? pickRegionName(area.translations, t?.serviceArea ?? null)
          : t?.serviceArea ?? null,
        customerRating: r.customerRating,
        paymentState: r.offlinePaidAt
          ? ('offline_paid' as const)
          : r.paidAt
            ? ('online_paid' as const)
            : ('unpaid' as const),
        amountLabel,
        isLegacyPoints: fiat.currencyCode == null,
        fiatEstimated: fiat.fiatEstimated,
      };
    }),
  );
}

/** 订单运营指标(跟随筛选即时统计) */
export interface AdminOrdersSummary {
  total: number;
  byStatus: Record<string, number>;
  completed: number;
  completionRate: number; // %
  cancelled: number;
  disputed: number;
  disputeRate: number; // %
  gmvByCurrency: Array<{ code: string; sum: number; label: string; count: number }>;
  legacyPointsGmv: number; // 老积分单 GMV(积分)
  depositHeldPoints: number; // 心动金冻结中(积分)
  reviewedCount: number;
  avgRating: number | null;
}

export async function getAdminOrdersSummary(
  ctx: OrderContext,
  p: AdminOrderFilters,
): Promise<AdminOrdersSummary> {
  const conditions = await buildAdminOrderConditions(ctx, p);
  const rows = await ctx.db.query.orders.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    columns: {
      status: true,
      currencyCode: true,
      totalFiat: true,
      pricePoints: true,
      depositPoints: true,
      depositStatus: true,
      customerRating: true,
    },
  });

  const byStatus: Record<string, number> = {};
  let depositHeld = 0;
  let legacyPointsGmv = 0;
  let ratingSum = 0;
  let reviewedCount = 0;
  const gmvMap = new Map<string, { sum: number; count: number }>();
  // 计入 GMV 的状态(已成交口径)
  const PAID_STATES = new Set(['PAID', 'IN_SERVICE', 'COMPLETED', 'REVIEWED', 'REFUNDED']);

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.depositStatus === 'HOLDING' && r.depositPoints) depositHeld += r.depositPoints;
    if (r.customerRating != null) {
      ratingSum += r.customerRating;
      reviewedCount += 1;
    }
    if (PAID_STATES.has(r.status)) {
      if (r.currencyCode && r.totalFiat) {
        const cur = gmvMap.get(r.currencyCode) ?? { sum: 0, count: 0 };
        cur.sum += parseFloat(r.totalFiat);
        cur.count += 1;
        gmvMap.set(r.currencyCode, cur);
      } else {
        legacyPointsGmv += r.pricePoints;
      }
    }
  }

  const total = rows.length;
  const completed = (byStatus.COMPLETED ?? 0) + (byStatus.REVIEWED ?? 0);
  const cancelled = byStatus.CANCELLED ?? 0;
  const disputed = byStatus.DISPUTED ?? 0;
  const gmvByCurrency = await Promise.all(
    [...gmvMap.entries()].map(async ([code, v]) => ({
      code,
      sum: Math.round(v.sum * 100) / 100,
      count: v.count,
      label: await formatFiat(ctx, v.sum, code),
    })),
  );

  return {
    total,
    byStatus,
    completed,
    completionRate: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
    cancelled,
    disputed,
    disputeRate: total > 0 ? Math.round((disputed / total) * 1000) / 10 : 0,
    gmvByCurrency,
    legacyPointsGmv,
    depositHeldPoints: depositHeld,
    reviewedCount,
    avgRating: reviewedCount > 0 ? Math.round((ratingSum / reviewedCount) * 10) / 10 : null,
  };
}

/** 异常订单(卡住的非终态单)· 运营监控用。各 status 自己的"卡住"阈值 + DISPUTED 全列 + 心动金 HOLDING 超期。 */
export interface OrderAlertRow {
  id: string;
  orderNo: string;
  status: string;
  depositStatus: string | null;
  customerName: string | null;
  therapistName: string | null;
  alertType: string;
  hoursStuck: number;
  createdAt: Date;
}

export async function adminListOrderAlerts(ctx: OrderContext): Promise<OrderAlertRow[]> {
  const rows = (await ctx.db.execute(sql`
    SELECT o.id, o.order_no, o.status, o.deposit_status, o.created_at,
           EXTRACT(EPOCH FROM (now() - o.updated_at)) / 3600 AS hours_stuck,
           o.customer_id, o.therapist_user_id,
           CASE
             WHEN o.status = 'DISPUTED' THEN 'dispute_pending'
             WHEN o.status = 'PENDING_CONFIRM' THEN 'pending_confirm'
             WHEN o.status = 'LOCKED' THEN 'locked_unpaid'
             WHEN o.status = 'PAID' THEN 'paid_no_start'
             ELSE 'deposit_overdue'
           END AS alert_type
    FROM orders o
    WHERE (o.status = 'DISPUTED')
       OR (o.status = 'PENDING_CONFIRM' AND o.updated_at < now() - INTERVAL '1 hour')
       OR (o.status = 'LOCKED' AND o.updated_at < now() - INTERVAL '6 hours')
       OR (o.status = 'PAID' AND o.updated_at < now() - INTERVAL '12 hours')
       OR (o.deposit_status = 'HOLDING' AND o.scheduled_at < now() - INTERVAL '48 hours'
           AND o.status NOT IN ('CANCELLED','REFUNDED','CLOSED','COMPLETED','REVIEWED'))
    ORDER BY o.updated_at ASC
    LIMIT 100
  `)) as unknown as Array<{
    id: string; order_no: string; status: string; deposit_status: string | null;
    created_at: string; hours_stuck: number; customer_id: string; therapist_user_id: string; alert_type: string;
  }>;

  const userIds = Array.from(new Set([...rows.map((r) => r.customer_id), ...rows.map((r) => r.therapist_user_id)]));
  const userList = userIds.length > 0
    ? await ctx.db.query.users.findMany({ where: inArray(users.id, userIds) })
    : [];
  const nameMap = new Map(userList.map((u) => [u.id, u.displayName]));

  return rows.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    status: r.status,
    depositStatus: r.deposit_status,
    customerName: nameMap.get(r.customer_id) ?? null,
    therapistName: nameMap.get(r.therapist_user_id) ?? null,
    alertType: r.alert_type,
    hoursStuck: Math.round(Number(r.hours_stuck) * 10) / 10,
    createdAt: new Date(r.created_at),
  }));
}

export interface OrderDetailDto extends Order {
  therapist: { id: string; avatarUrl: string | null; displayName: string | null } | null;
  fiatEstimated: boolean;
  /** 到店服务 · 仅在门控满足(LOCKED+ 且技师到店类)时出现;绝不在门控外下发地址 */
  shopInfo?: ShopInfo;
  /**
   * 上门服务 · 客户上门地址(仅 outcall/both 订单出现)。
   * 客户看自己单 → full=true;技师看本单 → full 取决于门控(确认后才见完整门牌)。
   * viewer 既非客户也非技师 → 不注入。
   */
  customerLocation?: CustomerLocation;
}

/**
 * 老订单(totalFiat==null)按技师默认币种 + 当前汇率「即时估算」法币(不写库)。
 * ⚠ 只补展示用金额,绝不碰 deposit。详情(getOrderDetail)与列表(listOrders)共用,
 *   保证两处金额展示口径一致。
 */
async function estimateOrderFiat(
  ctx: OrderContext,
  order: Pick<Order, 'currencyCode' | 'totalFiat' | 'pricePoints'>,
  therapistRow: Therapist | null,
): Promise<{ currencyCode: string | null; totalFiat: string | null; fiatEstimated: boolean }> {
  let currencyCode = order.currencyCode;
  let totalFiat = order.totalFiat;
  let fiatEstimated = false;
  if (totalFiat == null && therapistRow) {
    const code = deriveDefaultCurrency(therapistRow);
    if (code) {
      try {
        const fiat = await convertPointsToFiat({ db: ctx.db }, order.pricePoints, code);
        currencyCode = code;
        totalFiat = String(fiat);
        fiatEstimated = true;
      } catch {
        /* 无汇率字典 → 保持 null,前端兜底显积分 */
      }
    }
  }
  return { currencyCode, totalFiat, fiatEstimated };
}

/**
 * 客户端订单详情 · 在原始订单行上补两件事:
 *  1) 技师资料(id 给 /therapist/{id} 跳转 · avatarUrl/displayName 给展示)
 *  2) 老积分订单(totalFiat==null)按技师默认币种 + 当前汇率「即时估算」法币(不写库,标 fiatEstimated)
 * ⚠ 红线:绝不补 depositPoints/depositStatus —— 老订单从未冻结过积分,
 *   伪造 HOLDING 会让退款/裁决逻辑操作不存在的冻结款 = 财务事故。
 */
export async function getOrderDetail(
  ctx: OrderContext,
  orderId: string,
  viewerUserId?: string,
): Promise<OrderDetailDto | null> {
  const order = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return null;

  const therapistRow = await getTherapistByUserId({ db: ctx.db }, order.therapistUserId);
  const therapistUser = await ctx.db.query.users.findFirst({ where: eq(users.id, order.therapistUserId) });
  const therapist = therapistRow
    ? { id: therapistRow.id, avatarUrl: therapistRow.avatarUrl, displayName: therapistUser?.displayName ?? null }
    : null;

  const fiat = await estimateOrderFiat(ctx, order, therapistRow);

  const dto: OrderDetailDto = { ...order, ...fiat, therapist };

  // 本单服务方式:优先订单存的(新单 incall/outcall 严格);老单无则回退技师模式(兼容)
  const orderMode = order.serviceMode ?? therapistRow?.serviceMode ?? null;

  // 到店服务 · 门控满足(LOCKED+ 且本单到店)时注入门店信息(地址 + 已过审指引 + 须知)
  if (therapistRow && shopInfoVisible(order.status, orderMode)) {
    try {
      // 优先用确认那刻的快照(metadata.shopSnapshot)→ 与私聊卡一致、技师改址不漂移;
      // 老订单/无快照(确认前预览)→ 回退技师实时档案。
      const snap = (order.metadata as Record<string, unknown> | null)?.shopSnapshot as ShopInfo | undefined;
      dto.shopInfo = snap
        ? snap
        : await buildShopInfo(ctx.db, {
            address: therapistRow.serviceAddressFullEncrypted,
            arrivalNote: therapistRow.shopArrivalNote,
            shopGuideMedia: therapistRow.shopGuideMedia,
          });
    } catch (err) {
      console.warn('[orders] inject shopInfo failed (降级不阻断):', err instanceof Error ? err.message : err);
    }
  }

  // 上门服务 · viewer-aware 注入客户上门地址(仅 outcall/both 订单)
  //   - viewer 是本单客户 → full=true(看自己填的完整地址)
  //   - viewer 是本单技师 → full = 门控(确认/锁单后才见完整门牌,确认前只区域+距离)
  //   - 都不是 → 不注入
  if (
    therapistRow &&
    viewerUserId &&
    (OUTCALL_SERVICE_MODES as readonly string[]).includes(orderMode ?? '')
  ) {
    const isCustomer = order.customerId === viewerUserId;
    const isTherapist = order.therapistUserId === viewerUserId;
    if (isCustomer || isTherapist) {
      try {
        const full = isCustomer
          ? true
          : customerLocationVisibleToTherapist(order.status, orderMode);
        const center = await resolveTherapistAreaCenter(ctx.db, {
          serviceAreaId: therapistRow.serviceAreaId,
          serviceCityId: therapistRow.serviceCityId,
        });
        dto.customerLocation = await buildCustomerLocation(ctx.db, {
          address: order.customerAddress,
          note: order.customerAddressNote,
          areaName: order.customerAreaName,
          lat: order.customerLat,
          lng: order.customerLng,
          media: order.customerAddressMedia,
          full,
          therapistAreaLat: center.lat,
          therapistAreaLng: center.lng,
        });
      } catch (err) {
        console.warn('[orders] inject customerLocation failed (降级不阻断):', err instanceof Error ? err.message : err);
      }
    }
  }

  return dto;
}

export interface AdminOrderDetail extends AdminOrderRow {
  serviceSkills: string[];
  customerReview: string | null;
  paymentTxnId: string | null;
  // 完整时间线
  priceLockedAt: Date | null;
  paidAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  reviewedAt: Date | null;
  refundedAt: Date | null;
}

export async function adminGetOrder(ctx: OrderContext, orderId: string): Promise<AdminOrderDetail | null> {
  const r = await ctx.db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!r) return null;
  const userList = await ctx.db.query.users.findMany({ where: inArray(users.id, [r.customerId, r.therapistUserId]) });
  const nameMap = new Map(userList.map((u) => [u.id, u.displayName]));

  const t = await getTherapistByUserId({ db: ctx.db }, r.therapistUserId);
  const city = t?.serviceCityId ? await ctx.db.query.cities.findFirst({ where: eq(cities.id, t.serviceCityId) }) : null;
  const area = t?.serviceAreaId ? await ctx.db.query.areas.findFirst({ where: eq(areas.id, t.serviceAreaId) }) : null;
  const fiat = await estimateOrderFiat(ctx, r, t);
  const amountLabel =
    fiat.totalFiat != null && fiat.currencyCode != null
      ? (fiat.fiatEstimated ? '≈' : '') + (await formatFiat(ctx, parseFloat(fiat.totalFiat), fiat.currencyCode))
      : `${r.pricePoints.toLocaleString()} 积分`;

  return {
    id: r.id,
    orderNo: r.orderNo,
    customerId: r.customerId,
    customerName: nameMap.get(r.customerId) ?? null,
    therapistUserId: r.therapistUserId,
    therapistName: nameMap.get(r.therapistUserId) ?? null,
    status: r.status,
    pricePoints: r.pricePoints,
    durationMin: r.serviceSnapshot?.durationMin ?? 0,
    disputeOpenedAt: r.disputeOpenedAt,
    disputeReason: r.disputeReason,
    refundPoints: r.refundPoints,
    createdAt: r.createdAt,
    currencyCode: fiat.currencyCode,
    totalFiat: fiat.totalFiat,
    depositPoints: r.depositPoints,
    depositStatus: r.depositStatus,
    offlinePaidAt: r.offlinePaidAt,
    therapistCountryCode: city?.countryCode ?? t?.serviceCountry ?? null,
    therapistCityName: city
      ? pickRegionName(city.translations, t?.serviceCity ?? null)
      : t?.serviceCity ?? null,
    therapistAreaName: area
      ? pickRegionName(area.translations, t?.serviceArea ?? null)
      : t?.serviceArea ?? null,
    customerRating: r.customerRating,
    paymentState: r.offlinePaidAt
      ? ('offline_paid' as const)
      : r.paidAt
        ? ('online_paid' as const)
        : ('unpaid' as const),
    amountLabel,
    isLegacyPoints: fiat.currencyCode == null,
    fiatEstimated: fiat.fiatEstimated,
    serviceSkills: r.serviceSnapshot?.skills ?? [],
    customerReview: r.customerReview,
    paymentTxnId: r.paymentTxnId,
    priceLockedAt: r.priceLockedAt,
    paidAt: r.paidAt,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    reviewedAt: r.reviewedAt,
    refundedAt: r.refundedAt,
  };
}
