/**
 * 媒体资产表 · M02 模块
 *
 * 所有上传的图片 / 视频 / 语音都在这里：
 * - 头像 / 自我介绍语音 / 短视频 / 相册 / 真人核验录屏
 * - liveness 永久加密保留（决策 2026-05-21，不再 7 天销毁）
 * - 公开 / 付费 / 仅平台 三档可见性
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { auditStatusEnum, mediaTypeEnum } from './enums';

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    type: mediaTypeEnum('type').notNull(),

    // 存储路径（R2）
    r2Key: text('r2_key').notNull().unique(),
    publicUrl: text('public_url'),         // 公开 CDN url（已加水印）
    privateUrl: text('private_url'),        // 内部 signed url（液态短期）

    // 加密标记（用于 liveness 录屏永久加密）
    isEncrypted: integer('is_encrypted').default(0).notNull(),
    encryptionKeyRef: text('encryption_key_ref'),

    // 媒体属性
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    durationMs: integer('duration_ms'),
    widthPx: integer('width_px'),
    heightPx: integer('height_px'),
    thumbnailUrl: text('thumbnail_url'),

    // 用途标签（liveness / gallery / avatar / voice_intro / short_video / chat_attachment）
    purpose: text('purpose').notNull(),

    // 可见性
    visibility: text('visibility').default('public').notNull(), // public / paid_unlock / platform_only
    unlockPricePoints: integer('unlock_price_points'),

    // 审核
    auditStatus: auditStatusEnum('audit_status').default('pending').notNull(),
    auditedAt: timestamp('audited_at', { withTimezone: true }),

    // 水印
    watermarkApplied: integer('watermark_applied').default(0).notNull(),
    watermarkMetadata: jsonb('watermark_metadata').$type<Record<string, unknown>>(),

    // 软删除
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxOwner: index('idx_media_owner').on(t.ownerUserId),
    idxType: index('idx_media_type').on(t.type),
    idxPurpose: index('idx_media_purpose').on(t.purpose),
    idxAudit: index('idx_media_audit').on(t.auditStatus),
    idxDeleted: index('idx_media_deleted').on(t.deletedAt),
  }),
);

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type NewMediaAsset = typeof mediaAssets.$inferInsert;
