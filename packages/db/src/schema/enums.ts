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
  'AGENT_REDEEM_OUT', // 持有人→代理 回收转出（持有人 OUT · P1）
  'AGENT_REDEEM_IN', // 回收积分回代理库存（代理 IN · P1）
]);

export const pointsDirectionEnum = pgEnum('points_direction', ['IN', 'OUT']);

// ──────────────── M16 积分代理分销 ────────────────

export const agentPaymentMethodTypeEnum = pgEnum('agent_payment_method_type', [
  'bank',
  'alipay',
  'wechat',
  'usdt_trc20', // USDT-TRC20 加密货币（P0-1）
  'promptpay', // 泰国 PromptPay（P0-1）
  'other', // 其它（Wise/现金/Momo… 字段模板自填，P0-1）
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

// M16 P1 积分回收（持有人 → 代理 变现）
export const pointRedeemStatusEnum = pgEnum('point_redeem_status', [
  'created', // 持有人发起,积分已冻结,按代理公示回收率锁价
  'agent_accepted', // 代理接单(确认回收,准备付款)
  'agent_paid', // 代理已线下付款 + 传凭证
  'completed', // 持有人确认到账,积分释放给代理(终态)
  'disputed', // 争议中
  'cancelled', // 持有人取消 / 代理拒绝(解冻退回)
  'expired', // 超时未处理(解冻退回)
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
