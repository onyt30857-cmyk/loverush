/**
 * 积分流水类型（PRD §5.6）
 * 16 种 type · 基准汇率：约 1 美元 = 100 积分
 */

export const PointsTxnType = {
  RECHARGE: 'RECHARGE', // 充值
  PAYWALL_UNLOCK: 'PAYWALL_UNLOCK', // 付费墙解锁
  TIP_GIVE: 'TIP_GIVE', // 给小费
  TIP_RECEIVE: 'TIP_RECEIVE', // 收小费
  CHAT_SPEND: 'CHAT_SPEND', // 陪聊支付
  CHAT_EARN: 'CHAT_EARN', // 陪聊收益
  SHOP_PURCHASE: 'SHOP_PURCHASE', // 橱窗购买
  SHOP_COMMISSION: 'SHOP_COMMISSION', // 橱窗分成
  INVITE_REWARD: 'INVITE_REWARD', // 邀请奖励
  WITHDRAW: 'WITHDRAW', // 提现
  REFUND: 'REFUND', // 退款
  FROZEN: 'FROZEN', // 冻结
  UNFROZEN: 'UNFROZEN', // 解冻
  EXPIRED: 'EXPIRED', // 过期清零
  ADJUSTMENT: 'ADJUSTMENT', // 平台调整
} as const;

export type PointsTxnTypeValue = (typeof PointsTxnType)[keyof typeof PointsTxnType];

export const PointsDirection = {
  IN: 'IN',
  OUT: 'OUT',
} as const;

export type PointsDirectionValue = (typeof PointsDirection)[keyof typeof PointsDirection];

// 汇率配置（平台后台可调）
export const POINTS_TO_USD_RATE = 100; // 1 USD = 100 points
