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
]);

export const pointsDirectionEnum = pgEnum('points_direction', ['IN', 'OUT']);

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
