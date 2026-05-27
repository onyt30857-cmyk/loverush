/**
 * PostgreSQL Enums · 全局共享
 * 对应 @loverush/types 中的常量
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const userTypeEnum = pgEnum('user_type', ['customer', 'therapist']);

export const accountStatusEnum = pgEnum('account_status', [
  'pending', // 待审核
  'active', // 正常
  'suspended', // 暂停（违规警告）
  'banned', // 永久封禁
]);

export const relationshipTierEnum = pgEnum('relationship_tier', ['L0', 'L1', 'L2', 'L3']);

export const behaviorModeEnum = pgEnum('behavior_mode', ['steady', 'explorer', 'mixed']);

export const coolingStatusEnum = pgEnum('cooling_status', ['active', 'cold', 'recovering']);

export const inviteCodeKindEnum = pgEnum('invite_code_kind', ['T', 'A', 'U', 'O', 'R']);

export const orderStatusEnum = pgEnum('order_status', [
  'DRAFT',
  'PENDING_CONFIRM',
  'LOCKED',
  'PAID',
  'IN_SERVICE',
  'COMPLETED',
  'REVIEWED',
  'CANCELLED',
  'DISPUTED',
  'REFUNDED',
  'CLOSED',
]);

export const orderChainEventEnum = pgEnum('order_chain_event', [
  'order_created',
  'price_locked',
  'payment_received',
  'service_started',
  'service_paused',
  'service_completed',
  'price_changed',
  'payment_settled',
  'review_submitted',
  'tip_given',
  'dispute_raised',
  'dispute_resolved',
  'refund_executed',
  'sos_triggered',
  'ai_alter_msg_sent',
  'media_sent',
  'media_destroyed',
]);

export const pointsTxnTypeEnum = pgEnum('points_txn_type', [
  'RECHARGE',
  'PAYWALL_UNLOCK',
  'TIP_GIVE',
  'TIP_RECEIVE',
  'CHAT_SPEND',
  'CHAT_EARN',
  'SHOP_PURCHASE',
  'SHOP_COMMISSION',
  'INVITE_REWARD',
  'WITHDRAW',
  'REFUND',
  'FROZEN',
  'UNFROZEN',
  'EXPIRED',
  'ADJUSTMENT',
  // M16 积分代理分销
  'AGENT_WHOLESALE', // 平台→代理 批发入账（代理 IN）
  'AGENT_SELL', // 代理→客户 售卖（代理 OUT）
  'AGENT_BUY', // 客户从代理购入（客户 IN）
]);

export const pointsDirectionEnum = pgEnum('points_direction', ['IN', 'OUT']);

// ──────────────── M16 积分代理分销 ────────────────

export const agentPaymentMethodTypeEnum = pgEnum('agent_payment_method_type', [
  'bank',
  'alipay',
  'wechat',
]);

export const agentWholesaleStatusEnum = pgEnum('agent_wholesale_status', [
  'pending', // 代理已下单，待平台确认 USDT 到账
  'confirmed', // 已确认，积分已入账代理
  'rejected', // 驳回
]);

export const pointPurchaseStatusEnum = pgEnum('point_purchase_status', [
  'created', // 客户已下单，待付款
  'customer_paid', // 客户标记已付（线下法币）
  'agent_confirmed', // 代理确认收款
  'points_sent', // 积分已转给客户（终态）
  'disputed', // 争议中
  'cancelled', // 取消
  'expired', // 超时未付
]);

export const auditStatusEnum = pgEnum('audit_status', ['pending', 'approved', 'rejected']);

export const mediaTypeEnum = pgEnum('media_type', ['sticker', 'gif', 'photo', 'video', 'audio']);

export const verificationStatusEnum = pgEnum('verification_status', [
  'pending',
  'in_review',
  'passed',
  'failed',
]);

export const localeEnum = pgEnum('locale', ['zh', 'en', 'th', 'vi', 'ms', 'id']);

export const genderEnum = pgEnum('gender', ['female', 'male', 'other']);
