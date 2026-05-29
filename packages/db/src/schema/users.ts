/**
 * 用户核心表（双端共用）· 对应 PRD §4.0.7 / §4.0.8
 *
 * - users：身份主表（BIP-39 匿名注册，无明文手机号）
 * - sessions：多设备会话管理（JWT hash + 设备 fingerprint）
 * - device_fingerprints：设备指纹（H5 端浏览器 fingerprint）
 *
 * 注：H5 项目，设备指纹基于浏览器 UA + Canvas + 字体（非 native deviceId）
 */

import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  userTypeEnum,
  accountStatusEnum,
  localeEnum,
  genderEnum,
} from './enums';

/** 用户主表（双端共用，按 user_type 区分） */
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userType: userTypeEnum('user_type').notNull(),
    status: accountStatusEnum('status').default('pending').notNull(),

    // BIP-39 匿名身份（不存原始手机号 / 邮箱）
    bip39PubkeyHash: text('bip39_pubkey_hash').notNull().unique(),
    recoveryHash: text('recovery_hash'), // 助记词派生的恢复哈希

    // 公开信息（最少化）
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    locale: localeEnum('locale').default('zh').notNull(),
    gender: genderEnum('gender'),

    // 元数据
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    // 时间戳
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    bannedAt: timestamp('banned_at', { withTimezone: true }),
    /**
     * 账户激活时间(无效账户治理)
     * - register 不再 set,只有用户产生真实业务活动时才 set:
     *   首次 chat / 首次 conversation / 首次 order(任一)
     * - admin 默认列表过滤 NULL(只显已激活)
     * - cron / 手动可清理 NULL 且 24h+ 老账户
     * - backfill SQL 见 migration 0009
     */
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (t) => ({
    idxUserType: index('idx_users_user_type').on(t.userType),
    idxStatus: index('idx_users_status').on(t.status),
    idxCreatedAt: index('idx_users_created_at').on(t.createdAt),
    idxActivatedAt: index('idx_users_activated_at').on(t.activatedAt),
  }),
);

/** 多设备会话表（JWT hash + 设备绑定 · PRD §4.0.8） */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    // 会话凭证
    tokenHash: text('token_hash').notNull().unique(), // JWT hash（仅存 hash）
    refreshTokenHash: text('refresh_token_hash').unique(),

    // 设备信息（H5：浏览器指纹）
    deviceFingerprintId: uuid('device_fingerprint_id'),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'), // IP hash（隐私保护）

    // 生命周期
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (t) => ({
    idxUserId: index('idx_sessions_user_id').on(t.userId),
    idxExpiresAt: index('idx_sessions_expires_at').on(t.expiresAt),
    idxActive: index('idx_sessions_active').on(t.userId, t.revokedAt),
  }),
);

/** 设备指纹表（H5 浏览器 fingerprint，用于风控 / 异地登录提醒） */
export const deviceFingerprints = pgTable(
  'device_fingerprints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),

    fingerprintHash: text('fingerprint_hash').notNull(),
    canvasHash: text('canvas_hash'),
    fontHash: text('font_hash'),
    screenInfo: jsonb('screen_info').$type<{ width: number; height: number; dpr: number }>(),
    timezone: text('timezone'),
    languages: text('languages').array(),

    // 信誉评分
    trustScore: integer('trust_score').default(50).notNull(),

    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxUserId: index('idx_device_fp_user_id').on(t.userId),
    idxFpHash: uniqueIndex('uidx_device_fp_hash').on(t.userId, t.fingerprintHash),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type DeviceFingerprint = typeof deviceFingerprints.$inferSelect;
export type NewDeviceFingerprint = typeof deviceFingerprints.$inferInsert;
