/**
 * 隐私模式 · M15（H5 适配版）
 *
 * H5 项目不支持原生 App 的能力：
 * - ❌ 应用名 / 图标动态切换（撤 · H5 PWA install 后图标固定）
 * - ❌ 原生 FLAG_SECURE 截屏阻断（撤 · 走 CSS + JS 三层兜底）
 *
 * H5 可做：
 * - ✅ PIN 锁屏（前端 + 服务端校验）
 * - ✅ 自动锁回（前端 idle timer + 服务端会话短 TTL）
 * - ✅ 通知模糊化（推送内容脱敏）
 * - ✅ 计算器伪装外壳页（前端独立路由）
 * - ✅ 截屏水印 + 取证（写 user_id + ts 水印到敏感图层）
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const privacySettings = pgTable(
  'privacy_settings',
  {
    userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),

    // 隐私模式总开关
    privacyModeEnabled: integer('privacy_mode_enabled').default(0).notNull(),

    // PIN 设置（仅存 hash · 服务端 bcrypt-like）
    pinHash: text('pin_hash'),
    pinSetAt: timestamp('pin_set_at', { withTimezone: true }),
    failedAttempts: integer('failed_attempts').default(0).notNull(),
    lockedUntilAt: timestamp('locked_until_at', { withTimezone: true }),

    // 计算器伪装
    decoyEnabled: integer('decoy_enabled').default(0).notNull(),
    decoyType: text('decoy_type').default('calculator').notNull(), // calculator / notes / weather

    // 自动锁回（秒，0 = 关闭）
    autoLockSeconds: integer('auto_lock_seconds').default(300).notNull(), // 5 分钟

    // 通知模糊化
    obfuscateNotifications: integer('obfuscate_notifications').default(1).notNull(),

    // 紧急销毁（PIN 错误 N 次后清本地 cache · 不删服务端数据）
    panicWipeOnFailedAttempts: integer('panic_wipe_on_failed_attempts').default(0).notNull(),
    panicWipeThreshold: integer('panic_wipe_threshold').default(10).notNull(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

/** PIN 验证审计日志（防爆破） */
export const pinAttempts = pgTable(
  'pin_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    outcome: text('outcome').notNull(), // success / failure / locked
    ipHash: text('ip_hash'),
    deviceFingerprintHash: text('device_fingerprint_hash'),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxUser: index('idx_pin_attempts_user').on(t.userId, t.createdAt),
  }),
);

export type PrivacySetting = typeof privacySettings.$inferSelect;
export type NewPrivacySetting = typeof privacySettings.$inferInsert;
export type PinAttempt = typeof pinAttempts.$inferSelect;
