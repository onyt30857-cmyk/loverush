/**
 * 统一错误码体系（PRD §10.10）
 *
 * 4 位码 · 9 段分组：
 * 0000-0999 通用
 * 1000-1999 认证 / 注册
 * 2000-2999 用户 / 偏好
 * 3000-3999 订单 / 凭证
 * 4000-4999 私聊 / 翻译
 * 5000-5999 AI 分身 / 助理
 * 6000-6999 商业 / 积分
 * 7000-7999 风控 / 仲裁
 * 8000-8999 数据 / 凭证链
 * 9000-9999 系统 / 网络
 */

export const ErrorCode = {
  // 通用
  E0000_UNKNOWN: 'E0000',
  E0001_INVALID_PARAM: 'E0001',
  E0002_IDEMPOTENCY_CONFLICT: 'E0002',
  E0003_RESOURCE_NOT_FOUND: 'E0003',

  // 认证 / 注册
  E1001_OTP_INVALID: 'E1001',
  E1002_OTP_EXPIRED: 'E1002',
  E1010_OTP_RATE_LIMIT: 'E1010',
  E1020_TG_INITDATA_INVALID: 'E1020',
  E1030_INVITE_CODE_REQUIRED: 'E1030',
  E1031_INVITE_CODE_INVALID: 'E1031',
  E1040_KEY_RECOVERY_FAILED: 'E1040',

  // 用户 / 偏好
  E2010_BALANCE_INSUFFICIENT: 'E2010',
  E2020_USER_TYPE_LOCKED: 'E2020',

  // 订单
  E3050_ORDER_STATE_ILLEGAL: 'E3050',
  E3051_ORDER_NOT_PAID: 'E3051',

  // 翻译
  E4001_TRANSLATE_TIMEOUT: 'E4001',

  // AI
  E5040_AI_REDLINE_BLOCKED: 'E5040',
  E5050_AI_PROVIDER_DOWN: 'E5050',

  // 商业
  E6010_PAYMENT_FAILED: 'E6010',

  // 风控
  E7001_USER_BANNED: 'E7001',
  E7020_SOS_ABUSE: 'E7020',

  // 凭证链
  E8001_HASH_INVALID: 'E8001',

  // 系统
  E9999_INTERNAL_ERROR: 'E9999',
  E9000_RATE_LIMITED: 'E9000',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiError {
  code: ErrorCodeType;
  message: string;
  details?: Record<string, unknown>;
  request_id?: string;
  timestamp: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
  request_id?: string;
}
