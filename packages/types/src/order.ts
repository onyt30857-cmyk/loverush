/**
 * 订单状态机（PRD §4.8.4）
 * 11 状态 · 转换矩阵在后端 service 层实现
 */

export const OrderStatus = {
  DRAFT: 'DRAFT',
  PENDING_CONFIRM: 'PENDING_CONFIRM',
  LOCKED: 'LOCKED',
  PAID: 'PAID',
  IN_SERVICE: 'IN_SERVICE',
  COMPLETED: 'COMPLETED',
  REVIEWED: 'REVIEWED',
  CANCELLED: 'CANCELLED',
  DISPUTED: 'DISPUTED',
  REFUNDED: 'REFUNDED',
  CLOSED: 'CLOSED',
} as const;

export type OrderStatusValue = (typeof OrderStatus)[keyof typeof OrderStatus];

/**
 * 凭证链上链事件（PRD §4.8.5）
 * 17 类
 */
export const OrderChainEvent = {
  ORDER_CREATED: 'order_created',
  PRICE_LOCKED: 'price_locked',
  PAYMENT_RECEIVED: 'payment_received',
  SERVICE_STARTED: 'service_started',
  SERVICE_PAUSED: 'service_paused',
  SERVICE_COMPLETED: 'service_completed',
  PRICE_CHANGED: 'price_changed',
  PAYMENT_SETTLED: 'payment_settled',
  REVIEW_SUBMITTED: 'review_submitted',
  TIP_GIVEN: 'tip_given',
  DISPUTE_RAISED: 'dispute_raised',
  DISPUTE_RESOLVED: 'dispute_resolved',
  REFUND_EXECUTED: 'refund_executed',
  SOS_TRIGGERED: 'sos_triggered',
  AI_ALTER_MSG_SENT: 'ai_alter_msg_sent',
  MEDIA_SENT: 'media_sent',
  MEDIA_DESTROYED: 'media_destroyed',
} as const;

export type OrderChainEventValue = (typeof OrderChainEvent)[keyof typeof OrderChainEvent];
