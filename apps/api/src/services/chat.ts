/**
 * 私聊服务 · M05
 *
 * - openConversation：客户↔技师建会话（一对唯一）
 * - sendMessage：写消息 + 异步翻译为对方语言 + 平台中转入库
 * - listMessages：分页拉取消息（带翻译）
 * - markRead：标记已读
 */

import { and, count, eq, gt, ne, isNull, desc, sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import {
  conversations,
  conversationReadState,
  messages,
  messageTranslations,
  users,
  therapists,
  type Conversation,
  type Message,
  type MessageTranslation,
} from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { isBlockedEither, type BlockContext } from './blockings';
import { translate, type TranslateContext } from './translate';
import { fireAndForget, logger } from './logger';
import { markActivatedAsync } from './activation';
import { checkAndAct as redlineCheck } from './redline';
import { enqueue as enqueueNotification } from './notifications';
import { publishToUser as sseaPublishToUser } from './sse-hub';

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

  // 无效账户治理 · 双方都标 activated_at(首次开会话视为激活,幂等)
  markActivatedAsync(ctx.db, args.customerId);
  markActivatedAsync(ctx.db, args.therapistUserId);

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

  // M05 Phase 1 · 明文消息红线检查(加密消息跳过 · 信任客户端)
  let finalText = args.text;
  let redlineAction: 'pass' | 'rewrite' | 'block' = 'pass';
  let redlineFlags: string[] = [];
  if (!args.isEncrypted && args.type !== 'image' && args.type !== 'voice') {
    try {
      const rl = await redlineCheck({ db: ctx.db }, {
        text: args.text,
        therapistUserId: args.senderUserId,
      });
      redlineAction = rl.action;
      redlineFlags = rl.flags;
      if (rl.action === 'block') {
        throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, '消息含违规内容 · 请修改后发送');
      }
      if (rl.action === 'rewrite' && rl.rewritten) {
        finalText = rl.rewritten;
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // redline 失败(超时/LLM 报错)按 pass 走 · 不阻塞主链
      logger.error('chat.redline_check_failed', {
        err: err instanceof Error ? err.message : String(err),
        senderUserId: args.senderUserId,
      });
    }
  }

  const [msg] = await ctx.db
    .insert(messages)
    .values({
      conversationId: conv.id,
      senderUserId: args.senderUserId,
      type: args.type ?? 'text',
      contentOriginal: finalText,
      contentLanguage: args.isEncrypted ? null : srcLang,
      mediaRef: args.mediaRef,
      isAiAlter: args.isAiAlter ? 1 : 0,
      isEncrypted: args.isEncrypted ? 1 : 0,
      isPlatformMediated: 1,
      redlineAction: args.isEncrypted ? null : redlineAction,
      redlineFlags: redlineFlags.length ? redlineFlags : null,
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

  // M05 Phase 1 · 触发接收方通知(home Bell 红点 + web push)
  // 非 AI 分身回复 + 非 system 类才发(避免技师 AI 自回复打扰自己)
  if (!args.isAiAlter) {
    const notifyBody = args.isEncrypted ? '🔐 加密消息' : finalText.slice(0, 80);
    fireAndForget(
      enqueueNotification({ db: ctx.db }, {
        recipientUserId: recipientId,
        category: 'chat_msg',
        level: 'important',
        title: senderUser?.displayName ? `${senderUser.displayName} 发来消息` : '新消息',
        body: notifyBody,
        deepLink: `/conversations/${conv.id}`,
        refType: 'message',
        refId: msg.id,
      }),
      'chat.notify_failed',
      { messageId: msg.id, recipientUserId: recipientId },
    );
  }

  // M05 Phase 2 · SSE 实时推送(在线用户)
  const msgPayload = {
    conversationId: conv.id,
    message: {
      id: msg.id,
      conversationId: conv.id,
      senderUserId: msg.senderUserId,
      type: msg.type,
      contentOriginal: msg.contentOriginal,
      contentLanguage: msg.contentLanguage,
      isEncrypted: msg.isEncrypted,
      isAiAlter: msg.isAiAlter,
      sentAt: msg.sentAt,
      redlineAction: msg.redlineAction,
    },
  };
  // 推给两端在线连接(包括 sender · 多设备同步)
  sseaPublishToUser(conv.customerId, 'chat_message', msgPayload);
  sseaPublishToUser(conv.therapistUserId, 'chat_message', msgPayload);
  // 接收方未读数变化 · 触发 home Bell + 列表 mutate
  sseaPublishToUser(recipientId, 'unread_change', { conversationId: conv.id });

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
  /** 发送方昵称(对话页 IM 气泡用 · 微信/WhatsApp 同款) */
  senderDisplayName?: string | null;
  /** 发送方头像 URL(对话页 IM 气泡用) */
  senderAvatarUrl?: string | null;
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

  // ── 一次性拉所有 sender 的 display_name + avatar_url(对齐微信 IM 体验)
  // 对话里 sender 一般就 2 个(客户+技师),但批量查更安全
  // 技师的真实头像在 therapists.avatar_url(M11 媒体管理写入), users.avatar_url 可能 null
  // 用 LEFT JOIN + COALESCE 优先用 therapists.avatar_url
  const senderIds = Array.from(new Set(msgs.map((m) => m.senderUserId)));
  const senderRows = senderIds.length > 0
    ? await ctx.db
        .select({
          id: users.id,
          displayName: users.displayName,
          userAvatar: users.avatarUrl,
          therapistAvatar: therapists.avatarUrl,
        })
        .from(users)
        .leftJoin(therapists, eq(therapists.userId, users.id))
        .where(sql`${users.id} IN (${sql.join(senderIds.map((id) => sql`${id}::uuid`), sql`, `)})`)
    : [];
  const senderById = new Map(senderRows.map((r) => [r.id, r]));

  return msgs.map((m) => {
    const sender = senderById.get(m.senderUserId);
    return {
      ...m,
      translation: trByMsg.get(m.id),
      senderDisplayName: sender?.displayName ?? null,
      senderAvatarUrl: sender?.therapistAvatar ?? sender?.userAvatar ?? null,
    };
  }).reverse(); // 正序展示
}

// M05 Phase 1 · 列表返每条 + unreadCount + lastMessagePreview
export interface ConversationListItem extends Conversation {
  unreadCount: number;
  lastMessagePreview: { senderUserId: string; body: string; sentAt: Date; isEncrypted: boolean } | null;
  /** 对方 user_id · 列表显示头像/昵称用 */
  counterpartyUserId: string;
  /** 对方昵称(对齐微信/WhatsApp 列表项) */
  counterpartyDisplayName: string | null;
  /** 对方头像 URL */
  counterpartyAvatarUrl: string | null;
  /**
   * 对方 therapist.id(仅客户视角填 · 技师视角是 null)
   * 客户端点 chat header 头像可直接跳 /therapist/[therapistId] 详情
   */
  counterpartyTherapistId: string | null;
}

export async function listMyConversations(
  ctx: ChatContext,
  userId: string,
): Promise<ConversationListItem[]> {
  const convs = await ctx.db.query.conversations.findMany({
    where: (c, { or, eq: eq2 }) => or(eq2(c.customerId, userId), eq2(c.therapistUserId, userId)),
    orderBy: [desc(conversations.lastMessageAt)],
  });
  if (convs.length === 0) return [];

  const convIds = convs.map((c) => c.id);

  // 一次性拉所有 conv 的 read state(自己的)
  const reads = await ctx.db
    .select()
    .from(conversationReadState)
    .where(and(
      eq(conversationReadState.userId, userId),
      sql`${conversationReadState.conversationId} IN (${sql.join(convIds.map((id) => sql`${id}::uuid`), sql`, `)})`,
    ));
  const readByConv = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));

  // 一次性查每个 conv 的 unread count(对方发的 + sentAt > lastReadAt)
  // 简化:逐 conv 查 · 用户会话 <100 ok
  const unreadByConv = new Map<string, number>();
  const previewByConv = new Map<string, ConversationListItem['lastMessagePreview']>();
  await Promise.all(
    convs.map(async (c) => {
      const lastReadAt = readByConv.get(c.id) ?? new Date(0);
      const cntRows = await ctx.db
        .select({ n: count() })
        .from(messages)
        .where(and(
          eq(messages.conversationId, c.id),
          gt(messages.sentAt, lastReadAt),
          ne(messages.senderUserId, userId),
        ));
      unreadByConv.set(c.id, cntRows[0]?.n ?? 0);

      // 最后一条消息预览
      const [last] = await ctx.db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, c.id))
        .orderBy(desc(messages.sentAt))
        .limit(1);
      previewByConv.set(
        c.id,
        last
          ? {
              senderUserId: last.senderUserId,
              body: last.isEncrypted === 1 ? '🔐' : (last.contentOriginal ?? '').slice(0, 60),
              sentAt: last.sentAt,
              isEncrypted: last.isEncrypted === 1,
            }
          : null,
      );
    }),
  );

  // ── 一次性拉所有对方 user 的 display_name + avatar_url
  // 同 listMessages: 技师对方优先取 therapists.avatar_url(M11 媒体管理 + seed 都写到这里)
  const counterpartyIds = Array.from(new Set(
    convs.map((c) => (c.customerId === userId ? c.therapistUserId : c.customerId)),
  ));
  const counterpartyRows = counterpartyIds.length > 0
    ? await ctx.db
        .select({
          id: users.id,
          displayName: users.displayName,
          userAvatar: users.avatarUrl,
          therapistId: therapists.id,
          therapistAvatar: therapists.avatarUrl,
        })
        .from(users)
        .leftJoin(therapists, eq(therapists.userId, users.id))
        .where(sql`${users.id} IN (${sql.join(counterpartyIds.map((id) => sql`${id}::uuid`), sql`, `)})`)
    : [];
  const counterpartyById = new Map(counterpartyRows.map((r) => [r.id, r]));

  return convs.map((c) => {
    const counterpartyUserId = c.customerId === userId ? c.therapistUserId : c.customerId;
    const cp = counterpartyById.get(counterpartyUserId);
    // 客户视角:对方一定是技师 · 填 therapist.id 供前端跳详情
    // 技师视角:对方是客户 · therapistId 字段填 null
    const isCustomerViewer = c.customerId === userId;
    return {
      ...c,
      unreadCount: unreadByConv.get(c.id) ?? 0,
      lastMessagePreview: previewByConv.get(c.id) ?? null,
      counterpartyUserId,
      counterpartyDisplayName: cp?.displayName ?? null,
      counterpartyAvatarUrl: cp?.therapistAvatar ?? cp?.userAvatar ?? null,
      counterpartyTherapistId: isCustomerViewer ? (cp?.therapistId ?? null) : null,
    };
  });
}

/** 单 conv 未读数 · 给前端 mutate 用 */
export async function getUnreadCount(
  ctx: ChatContext,
  args: { userId: string; conversationId: string },
): Promise<number> {
  const state = await ctx.db.query.conversationReadState.findFirst({
    where: and(
      eq(conversationReadState.conversationId, args.conversationId),
      eq(conversationReadState.userId, args.userId),
    ),
  });
  const lastReadAt = state?.lastReadAt ?? new Date(0);
  const cntRows = await ctx.db
    .select({ n: count() })
    .from(messages)
    .where(and(
      eq(messages.conversationId, args.conversationId),
      gt(messages.sentAt, lastReadAt),
      ne(messages.senderUserId, args.userId),
    ));
  return cntRows[0]?.n ?? 0;
}

export async function markMessagesRead(
  ctx: ChatContext,
  args: { conversationId: string; viewerUserId: string },
): Promise<void> {
  // 1. 找当前最新一条消息 id(以这条为 lastReadMessageId)
  const [latest] = await ctx.db
    .select({ id: messages.id, sentAt: messages.sentAt })
    .from(messages)
    .where(eq(messages.conversationId, args.conversationId))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  const now = new Date();

  // 2. upsert conversation_read_state(per-user)
  await ctx.db
    .insert(conversationReadState)
    .values({
      conversationId: args.conversationId,
      userId: args.viewerUserId,
      lastReadMessageId: latest?.id ?? null,
      lastReadAt: now,
    })
    .onConflictDoUpdate({
      target: [conversationReadState.conversationId, conversationReadState.userId],
      set: {
        lastReadMessageId: latest?.id ?? null,
        lastReadAt: now,
        updatedAt: now,
      },
    });

  // 3. 旧 messages.readAt 双写过渡(兼容旧前端代码) · Phase 2 删
  await ctx.db
    .update(messages)
    .set({ readAt: now })
    .where(
      and(
        eq(messages.conversationId, args.conversationId),
        ne(messages.senderUserId, args.viewerUserId),
        isNull(messages.readAt),
      ),
    );
}
