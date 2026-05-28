/**
 * 私聊服务 · M05
 *
 * - openConversation：客户↔技师建会话（一对唯一）
 * - sendMessage：写消息 + 异步翻译为对方语言 + 平台中转入库
 * - listMessages：分页拉取消息（带翻译）
 * - markRead：标记已读
 */

import { and, eq, ne, isNull, desc } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  conversations,
  messages,
  messageTranslations,
  users,
  type Conversation,
  type Message,
  type MessageTranslation,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { isBlockedEither, type BlockContext } from './blockings';
import { translate, type TranslateContext } from './translate';
import { fireAndForget, logger } from './logger';

export interface ChatContext {
  db: Database;
}

export async function openConversation(
  ctx: ChatContext,
  args: { customerId: string; therapistUserId: string },
): Promise<Conversation> {
  if (await isBlockedEither({ db: ctx.db }, args.customerId, args.therapistUserId)) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'blocked');
  }

  const existing = await ctx.db.query.conversations.findFirst({
    where: and(
      eq(conversations.customerId, args.customerId),
      eq(conversations.therapistUserId, args.therapistUserId),
    ),
  });
  if (existing) return existing;

  const [row] = await ctx.db
    .insert(conversations)
    .values({ customerId: args.customerId, therapistUserId: args.therapistUserId })
    .returning();
  return row!;
}

export async function sendMessage(
  ctx: ChatContext,
  args: {
    conversationId: string;
    senderUserId: string;
    text: string;
    sourceLanguage?: string;
    type?: 'text' | 'image' | 'voice';
    mediaRef?: string;
    isAiAlter?: boolean;
    isEncrypted?: boolean;
  },
): Promise<Message> {
  const conv = await ctx.db.query.conversations.findFirst({
    where: eq(conversations.id, args.conversationId),
  });
  if (!conv) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'conversation not found');
  if (conv.status === 'blocked' || conv.status === 'archived') {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, `conversation ${conv.status}`);
  }
  if (![conv.customerId, conv.therapistUserId].includes(args.senderUserId)) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'not a participant');
  }
  if (await isBlockedEither({ db: ctx.db }, conv.customerId, conv.therapistUserId)) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'blocked');
  }

  const senderUser = await ctx.db.query.users.findFirst({ where: eq(users.id, args.senderUserId) });
  const srcLang = args.sourceLanguage ?? senderUser?.locale ?? 'zh';

  const [msg] = await ctx.db
    .insert(messages)
    .values({
      conversationId: conv.id,
      senderUserId: args.senderUserId,
      type: args.type ?? 'text',
      contentOriginal: args.text,
      contentLanguage: args.isEncrypted ? null : srcLang,
      mediaRef: args.mediaRef,
      isAiAlter: args.isAiAlter ? 1 : 0,
      isEncrypted: args.isEncrypted ? 1 : 0,
      isPlatformMediated: 1,
    })
    .returning();
  if (!msg) throw HttpError.internal('message insert failed');

  await ctx.db
    .update(conversations)
    .set({
      messageCount: conv.messageCount + 1,
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conv.id));

  // 异步翻译为对方语言（仅明文消息 · e2e 加密无法翻译）
  const recipientId = args.senderUserId === conv.customerId ? conv.therapistUserId : conv.customerId;
  if (!args.isEncrypted) {
    fireAndForget(
      translateMessageForRecipient(ctx, { messageId: msg.id, srcLang, recipientUserId: recipientId }),
      'chat.translate_failed',
      { messageId: msg.id, recipientUserId: recipientId, srcLang },
    );
  }

  // 客户发消息 → 触发 AI 分身回复（仅明文消息 · 加密消息技师本人解密后回复）
  if (args.senderUserId === conv.customerId && !args.isAiAlter && !args.isEncrypted) {
    void (async () => {
      try {
        const mod = await import('./ai_alter');
        await mod.maybeReplyAsAlter({ db: ctx.db }, {
          conversationId: conv.id,
          customerId: conv.customerId,
          therapistUserId: conv.therapistUserId,
          customerLocale: srcLang,
        });
      } catch (e) {
        logger.error('ai_alter_failed', {
          err: e instanceof Error ? e.message : String(e),
          conversationId: conv.id,
          therapistUserId: conv.therapistUserId,
        });
      }
    })();
  }

  return msg;
}

async function translateMessageForRecipient(
  ctx: ChatContext,
  args: { messageId: string; srcLang: string; recipientUserId: string },
) {
  const recipient = await ctx.db.query.users.findFirst({ where: eq(users.id, args.recipientUserId) });
  const tgtLang = recipient?.locale ?? 'zh';
  if (tgtLang === args.srcLang) return;

  const msg = await ctx.db.query.messages.findFirst({ where: eq(messages.id, args.messageId) });
  if (!msg || !msg.contentOriginal || msg.type !== 'text') return;

  const result = await translate({ db: ctx.db }, {
    text: msg.contentOriginal,
    srcLang: args.srcLang,
    tgtLang,
    userId: args.recipientUserId,
  });

  await ctx.db
    .insert(messageTranslations)
    .values({
      messageId: msg.id,
      targetLanguage: tgtLang,
      translatedText: result.text,
      provider: result.provider,
      cultureNotes: result.cultureNotes,
    })
    .onConflictDoNothing();
}

export interface MessageWithTranslation extends Message {
  translation?: MessageTranslation;
}

export async function listMessages(
  ctx: ChatContext,
  args: { conversationId: string; viewerUserId: string; limit?: number; beforeId?: string },
): Promise<MessageWithTranslation[]> {
  const conv = await ctx.db.query.conversations.findFirst({
    where: eq(conversations.id, args.conversationId),
  });
  if (!conv) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'conversation not found');
  if (![conv.customerId, conv.therapistUserId].includes(args.viewerUserId)) {
    throw HttpError.forbidden(ErrorCode.E0001_INVALID_PARAM, 'not a participant');
  }

  const viewer = await ctx.db.query.users.findFirst({ where: eq(users.id, args.viewerUserId) });
  const viewerLang = viewer?.locale ?? 'zh';

  const msgs = await ctx.db.query.messages.findMany({
    where: eq(messages.conversationId, args.conversationId),
    orderBy: [desc(messages.sentAt)],
    limit: args.limit ?? 50,
  });

  const ids = msgs.map((m) => m.id);
  const translations = ids.length
    ? await ctx.db.query.messageTranslations.findMany({
        where: and(eq(messageTranslations.targetLanguage, viewerLang)),
      })
    : [];
  const trByMsg = new Map(translations.filter((t) => ids.includes(t.messageId)).map((t) => [t.messageId, t]));

  return msgs.map((m) => ({ ...m, translation: trByMsg.get(m.id) })).reverse(); // 正序展示
}

export async function listMyConversations(
  ctx: ChatContext,
  userId: string,
): Promise<Conversation[]> {
  // 查同时为 customer 或 therapist 的会话
  return ctx.db.query.conversations.findMany({
    where: (c, { or, eq: eq2 }) => or(eq2(c.customerId, userId), eq2(c.therapistUserId, userId)),
    orderBy: [desc(conversations.lastMessageAt)],
  });
}

export async function markMessagesRead(
  ctx: ChatContext,
  args: { conversationId: string; viewerUserId: string },
): Promise<void> {
  await ctx.db
    .update(messages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(messages.conversationId, args.conversationId),
        ne(messages.senderUserId, args.viewerUserId), // 仅标记非自己发的
        isNull(messages.readAt),
      ),
    );
}
