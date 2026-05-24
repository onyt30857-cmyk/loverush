/**
 * 私聊 · M05 跨语言私聊
 *
 * - conversations：客户↔技师的会话
 * - messages：消息体（明文 / 加密两态）
 * - message_translations：每条消息的语种翻译（缓存到列）
 * - translation_cache：全局翻译缓存（按 sha256(text+src+tgt)）
 * - glossary_entries：自定义术语表（按用户对维护）
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/** 会话主体（pair = customer + therapist 唯一） */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    // 状态
    status: text('status').default('active').notNull(), // active / muted / archived / blocked

    // 使用统计
    messageCount: integer('message_count').default(0).notNull(),
    paidExtraQuota: integer('paid_extra_quota').default(0).notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),

    // 锁
    blockedBy: text('blocked_by'), // customer / therapist / admin
    blockedAt: timestamp('blocked_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxPair: uniqueIndex('uidx_conv_pair').on(t.customerId, t.therapistUserId),
    idxCustomer: index('idx_conv_customer').on(t.customerId),
    idxTherapist: index('idx_conv_therapist').on(t.therapistUserId),
    idxLastMsg: index('idx_conv_last_msg').on(t.lastMessageAt),
  }),
);

/** 消息体 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    senderUserId: uuid('sender_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    // 内容
    type: text('type').default('text').notNull(), // text / image / voice / system / sticker
    contentOriginal: text('content_original'),  // 发送方原始文本（端到端加密时为密文）
    contentLanguage: text('content_language'),  // zh / en / th / vi / ms / id
    mediaRef: uuid('media_ref'),                // 关联 media_assets.id（图片/语音）

    // 加密（端到端 · M05 §端到端加密）
    isEncrypted: integer('is_encrypted').default(0).notNull(),
    encryptionMeta: jsonb('encryption_meta').$type<Record<string, unknown>>(),

    // 审核（异步事后）
    moderationStatus: text('moderation_status').default('not_reviewed').notNull(),

    // 业务标识
    isAiAlter: integer('is_ai_alter').default(0).notNull(), // 此条由 AI 分身代发（服务端日志可见，客户端不显示标识 · v5 政策）
    isPlatformMediated: integer('is_platform_mediated').default(0).notNull(), // 平台中转

    // 时间
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    idxConvSent: index('idx_msg_conv_sent').on(t.conversationId, t.sentAt),
    idxSender: index('idx_msg_sender').on(t.senderUserId),
    idxModeration: index('idx_msg_moderation').on(t.moderationStatus),
  }),
);

/** 每条消息的翻译 */
export const messageTranslations = pgTable(
  'message_translations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
    targetLanguage: text('target_language').notNull(),
    translatedText: text('translated_text').notNull(),

    // 翻译来源
    provider: text('provider').notNull(), // deepl / claude / gemini / cache
    cultureNotes: jsonb('culture_notes').$type<Array<{ phrase: string; note: string }>>().default([]),
    confidence: integer('confidence').default(80).notNull(),

    // 用户人工修正
    isCorrected: integer('is_corrected').default(0).notNull(),
    correctedText: text('corrected_text'),
    correctedByUserId: uuid('corrected_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxMsgLang: uniqueIndex('uidx_translation_msg_lang').on(t.messageId, t.targetLanguage),
    idxLang: index('idx_translation_lang').on(t.targetLanguage),
  }),
);

/** 全局翻译缓存（节省成本） */
export const translationCache = pgTable(
  'translation_cache',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // hash(srcLang + tgtLang + text)，避免重复翻译相同句子
    cacheKey: text('cache_key').notNull().unique(),

    srcLanguage: text('src_language').notNull(),
    tgtLanguage: text('tgt_language').notNull(),
    srcText: text('src_text').notNull(),
    tgtText: text('tgt_text').notNull(),

    provider: text('provider').notNull(),
    cultureNotes: jsonb('culture_notes').$type<Array<{ phrase: string; note: string }>>().default([]),

    hitCount: integer('hit_count').default(1).notNull(),
    lastHitAt: timestamp('last_hit_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxKey: index('idx_trans_cache_key').on(t.cacheKey),
    idxLangPair: index('idx_trans_cache_pair').on(t.srcLanguage, t.tgtLanguage),
  }),
);

/** 自定义术语表（按 conversation 维护，避免技师专有名词被通用翻译错译） */
export const glossaryEntries = pgTable(
  'glossary_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scope: text('scope').default('conversation').notNull(), // conversation / user / global
    scopeId: uuid('scope_id'),                              // conversation_id / user_id / null

    srcLanguage: text('src_language').notNull(),
    tgtLanguage: text('tgt_language').notNull(),
    srcTerm: text('src_term').notNull(),
    tgtTerm: text('tgt_term').notNull(),
    note: text('note'),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxScope: index('idx_glossary_scope').on(t.scope, t.scopeId),
    idxTerm: index('idx_glossary_term').on(t.srcTerm),
  }),
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageTranslation = typeof messageTranslations.$inferSelect;
export type TranslationCache = typeof translationCache.$inferSelect;
export type GlossaryEntry = typeof glossaryEntries.$inferSelect;
