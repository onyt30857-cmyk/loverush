/**
 * 邀请码 + 端到端加密密钥 · 对应 PRD §4.0.7
 *
 * - invite_codes：5 种邀请码（T/A/U/O/R）
 * - invite_code_usage：使用流水
 * - encryption_keys：用户公私钥对（端到端加密素材，私钥 BIP-39 助记词派生密钥加密）
 */

import { pgTable, uuid, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { inviteCodeKindEnum, userTypeEnum } from './enums';

/** 邀请码 */
export const inviteCodes = pgTable(
  'invite_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull().unique(),
    kind: inviteCodeKindEnum('kind').notNull(),

    // 适用对象
    targetUserType: userTypeEnum('target_user_type'), // null = 任意

    // 来源
    issuerUserId: uuid('issuer_user_id').references(() => users.id, { onDelete: 'set null' }),
    issuerNote: text('issuer_note'),

    // 用量
    maxUses: integer('max_uses').default(1).notNull(),
    usedCount: integer('used_count').default(0).notNull(),

    // 奖励
    rewardPayloadJson: jsonb('reward_payload').$type<Record<string, unknown>>(),

    // 生命周期
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxCode: index('idx_invite_codes_code').on(t.code),
    idxIssuer: index('idx_invite_codes_issuer').on(t.issuerUserId),
    idxKind: index('idx_invite_codes_kind').on(t.kind),
  }),
);

/** 邀请码使用流水 */
export const inviteCodeUsage = pgTable(
  'invite_code_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    inviteCodeId: uuid('invite_code_id').notNull().references(() => inviteCodes.id, { onDelete: 'cascade' }),
    usedByUserId: uuid('used_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    ipHash: text('ip_hash'),
    deviceFingerprintHash: text('device_fingerprint_hash'),

    usedAt: timestamp('used_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxInviteCode: index('idx_invite_usage_code').on(t.inviteCodeId),
    idxUser: index('idx_invite_usage_user').on(t.usedByUserId),
  }),
);

/** 端到端加密密钥（私钥 由助记词派生密钥加密后存储） */
export const encryptionKeys = pgTable(
  'encryption_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    algorithm: text('algorithm').notNull(), // e.g. "X25519" / "Ed25519"
    publicKey: text('public_key').notNull(),
    encryptedPrivateKey: text('encrypted_private_key').notNull(),
    keySalt: text('key_salt').notNull(), // BIP-39 派生时的 salt

    keyVersion: integer('key_version').default(1).notNull(),
    isActive: integer('is_active').default(1).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
  },
  (t) => ({
    idxUser: index('idx_enc_keys_user').on(t.userId),
    idxActive: index('idx_enc_keys_active').on(t.userId, t.isActive),
  }),
);

export type InviteCode = typeof inviteCodes.$inferSelect;
export type NewInviteCode = typeof inviteCodes.$inferInsert;
export type InviteCodeUsage = typeof inviteCodeUsage.$inferSelect;
export type EncryptionKey = typeof encryptionKeys.$inferSelect;
export type NewEncryptionKey = typeof encryptionKeys.$inferInsert;
