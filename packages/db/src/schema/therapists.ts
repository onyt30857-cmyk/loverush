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
    // M18 声音复刻 · ElevenLabs 克隆出的 voice_id(从 voiceIntroUrl 样本懒克隆)
    elevenVoiceId: text('eleven_voice_id'),
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
    serviceAddressFullEncrypted: text('service_address_full_encrypted'), // 付费解锁 / 到店复用作门店完整地址
    // 服务方式：outcall 上门到客户那 / incall 客户到店 / both 两者皆可（默认上门=历史假设；到店复用上面加密地址作店铺地址）
    serviceMode: text('service_mode').$type<'outcall' | 'incall' | 'both'>().default('outcall').notNull(),
    // 到店服务 · 找店指引图/视频(有序;mediaId 关联 media_assets,审核通过才下发)
    shopGuideMedia: jsonb('shop_guide_media')
      .$type<Array<{ mediaId: string; kind: 'image' | 'video'; caption?: string }>>()
      .default([]),
    // 到店服务 · 到店须知(技师手填,如"按门铃说预约的",≤200 字)
    shopArrivalNote: text('shop_arrival_note'),

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

    // ──────── M04 · 匹配语义画像（LLM 一次性生成 + 技师可编辑） ────────
    // "这个技师适合什么样的客户" · 给 LLM 语义匹配当供给侧画像 · 非身高体重这类硬属性
    matchPersona: jsonb('match_persona').$type<{
      suitableFor?: string[];    // 适合什么样的客户:想被照顾 / 第一次紧张 ...
      toneTags?: string[];       // 调性:温柔 / 耐心 / 成熟姐姐感
      emotionalValue?: string[]; // 擅长的情绪价值:倾听 / 解压陪伴
      notFor?: string[];         // 不适合:想要高强度社交的客户 ...
      source?: 'llm_v1' | 'therapist_edited';
      updatedAt?: string;
    }>(),

    // ──────── 价格 ────────
    // 0027 法币模式:每档可选带 currencyCode + priceFiat · pricePoints 仍兜底保留
    // 老积分订单兼容(决策⑥) · 客户端优先显 fiat
    basePriceJson: jsonb('base_price').$type<
      Array<{
        duration: number;
        pricePoints: number;
        currencyCode?: string;
        priceFiat?: number;
      }>
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
