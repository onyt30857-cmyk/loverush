/**
 * 用户相关共享类型
 * 对应 M01 注册认证（PRD §4.0）
 */

import { z } from 'zod';

export const UserType = {
  CUSTOMER: 'customer',
  THERAPIST: 'therapist',
} as const;

export type UserTypeValue = (typeof UserType)[keyof typeof UserType];

export const RelationshipTier = {
  L0: 'L0', // 新客 · 0 次服务
  L1: 'L1', // 浅客 · 1-2 次
  L2: 'L2', // 熟客 · 3-9 次
  L3: 'L3', // VIP · 10+ 次
} as const;

export type RelationshipTierValue = (typeof RelationshipTier)[keyof typeof RelationshipTier];

export const BehaviorMode = {
  STEADY: 'steady', // 稳定型
  EXPLORER: 'explorer', // 尝鲜型
  MIXED: 'mixed', // 混合型
} as const;

export type BehaviorModeValue = (typeof BehaviorMode)[keyof typeof BehaviorMode];

// Zod schema for registration
export const RegisterSchema = z.object({
  user_type: z.enum(['customer', 'therapist']),
  invite_code: z.string().min(4).max(32),
  // 三选一登录方式
  phone: z.string().optional(),
  otp: z.string().length(6).optional(),
  telegram_init_data: z.string().optional(),
  mnemonic: z.string().optional(), // BIP-39 24 词（仅恢复用）
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

export interface UserPublicInfo {
  user_id: string;
  user_type: UserTypeValue;
  alias: string;
  created_at: string;
}
