/**
 * 技师扩展信息表 · 对应 PRD §4.1 / M02 模块
 *
 * users 表是双端共用主表；技师附加业务字段、KYC、冷却状态、5 维信息、
 * 三维评分、社交解锁字段走这里。
 *
 * 公开性约定：
 * - 公开字段：所有客户可见
 * - 付费解锁：客户消耗积分后可见（social_contacts / service_address_full）
 * - 仅平台：用于匹配 / 风控 / 评分，绝不外露给客户（5 维身体数据 / liveness）
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  smallint,
  numeric,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { coolingStatusEnum, verificationStatusEnum } from './enums';

export const therapists = pgTable(
  'therapists',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),

    // ──────── 公开档案 ────────
    bio: text('bio'),
    bioTranslations: jsonb('bio_translations').$type<Record<string, string>>(),
    tags: text('tags').array(),
    nationality: text('nationality'),
    languages: text('languages').array(),

    // ──────── 媒体（URL 形式，文件实体在 media_assets 表） ────────
    avatarUrl: text('avatar_url'),
    voiceIntroUrl: text('voice_intro_url'),
    shortVideoUrl: text('short_video_url'),
    livenessVideoUrl: text('liveness_video_url'), // 仅平台
    galleryJson: jsonb('gallery').$type<
      Array<{ url: string; isPaid: boolean; thumbnailUrl?: string; pricePoints?: number }>
    >().default([]),

    // ──────── 服务区域 ────────
    // 旧 text 字段保留 · 双写过渡 · 90 天后停写
    serviceCountry: text('service_country'),
    serviceCity: text('service_city'),
    serviceArea: text('service_area'),
    // M02 Phase 5 新增 · 字典 uuid · 撮合/搜索/排序都用这两个
    serviceCityId: uuid('service_city_id'),
    serviceAreaId: uuid('service_area_id'),
    serviceAddressFullEncrypted: text('service_address_full_encrypted'), // 付费解锁

    // ──────── 5 维身体信息（仅平台） ────────
    heightCm: integer('height_cm'),
    weightKg: integer('weight_kg'),
    bustCm: integer('bust_cm'),
    hipCm: integer('hip_cm'),
    bodyFatPct: numeric('body_fat_pct', { precision: 4, scale: 1 }), // e.g. 22.5
    education: text('education'),

    // ──────── KYC / 真人核验（永久加密保留 · 决策 2026-05-21） ────────
    verificationStatus: verificationStatusEnum('verification_status').default('pending').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    realnessCheckLastAt: timestamp('realness_check_last_at', { withTimezone: true }),
    realnessCheckProvider: text('realness_check_provider'),

    // ──────── 社交联系（付费解锁） ────────
    socialContactsEncrypted: text('social_contacts_encrypted'),
    socialUnlockPricePoints: integer('social_unlock_price_points').default(100),

    // ──────── 服务能力 ────────
    skillsJson: jsonb('skills').$type<
      Array<{ skill: string; level: number; certUrl?: string }>
    >().default([]),

    // ──────── 喜爱字段（公开） ────────
    preferencesJson: jsonb('preferences').$type<{
      preferredCustomerTypes?: string[];
      rejectedCustomerTypes?: string[];
      acceptableBehaviors?: string[];
      unacceptableBehaviors?: string[];
    }>().default({}),

    // ──────── 价格（积分） ────────
    basePriceJson: jsonb('base_price').$type<
      Array<{ duration: number; pricePoints: number }>
    >().default([]),

    // ──────── 排班 / 在线状态 ────────
    onlineStatus: text('online_status').default('offline').notNull(),
    lastOnlineAt: timestamp('last_online_at', { withTimezone: true }),

    // ──────── 冷却 ────────
    coolingStatus: coolingStatusEnum('cooling_status').default('active').notNull(),
    coolingUntilAt: timestamp('cooling_until_at', { withTimezone: true }),

    // ──────── 三维评分（0-1000，10 分制 ×100，避免浮点） ────────
    scoreAppearance: integer('score_appearance').default(0).notNull(),
    scoreBody: integer('score_body').default(0).notNull(),
    scoreService: integer('score_service').default(0).notNull(),

    // ──────── 统计 ────────
    completedOrders: integer('completed_orders').default(0).notNull(),
    rating: integer('rating').default(0).notNull(),
    ratingCount: integer('rating_count').default(0).notNull(),
    repeatCustomerCount: integer('repeat_customer_count').default(0).notNull(),

    // ──────── 完整度 ────────
    profileCompleteness: integer('profile_completeness').default(0).notNull(), // 0-100

    // ──────── AI 分身配置（技师端） ────────
    aiAlterEnabled: integer('ai_alter_enabled').default(0).notNull(),
    aiAlterPersonality: jsonb('ai_alter_personality').$type<Record<string, unknown>>(),

    // ──────── M06 Phase 2 · AI 健康度 & 紧急干预 ────────
    /** 最近一日 ai_health_scores.overallScore · cache 字段给列表排序快查 */
    aiHealthLatestScore: integer('ai_health_latest_score'),
    /** admin 紧急关闭 AI 时记原因 · null=没关 · aiAlterEnabled=0 时与此搭配 */
    aiKillSwitchReason: text('ai_kill_switch_reason'),

    // ──────── M07 排班配置 ────────
    /** 时段粒度(分钟)· 默认 30 · 客户端选时段按此对齐 */
    slotMinutes: smallint('slot_minutes').default(30).notNull(),
    /** 两单缓冲时间(分钟)· 默认 15 · 上门需考虑交通 + 整理 */
    bufferMinutes: smallint('buffer_minutes').default(15).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxUser: index('idx_therapists_user').on(t.userId),
    idxCity: index('idx_therapists_city').on(t.serviceCity),
    idxVerification: index('idx_therapists_verification').on(t.verificationStatus),
    idxOnline: index('idx_therapists_online').on(t.onlineStatus),
    idxRating: index('idx_therapists_rating').on(t.rating),
    idxScore: index('idx_therapists_score').on(t.scoreAppearance, t.scoreService),
  }),
);

export type Therapist = typeof therapists.$inferSelect;
export type NewTherapist = typeof therapists.$inferInsert;
