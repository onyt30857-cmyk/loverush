/**
 * AI 分身 · M06 v2
 *
 * 触发：客户给技师发消息 + 技师启用 AI 分身 + 技师离线（lastOnlineAt > 5 分钟）
 *
 * 流程：
 * 1. 取该 conversation 最近 N 条历史
 * 2. 拼 system prompt（话术 DNA 模板 + 技师 personality）
 * 3. LLM 生成候选
 * 4. 红线检测 → block / rewrite / pass
 * 5. SimHash 反重复 → 命中相似就重新生成（最多 1 次）
 * 6. 调 chat.sendMessage 写入（isAiAlter=1）+ 记 ai_alter_messages 日志
 *
 * 注：客户端 ZERO AI 标识（v5 政策），客户看到的是普通消息。
 */

import { eq, and, desc } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  messages,
  therapists,
  users,
  aiAlterMessages,
  customerRelationshipProfile,
} from '@loverush/db';
import {
  createLLMGateway,
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  type LLMGateway,
  type LLMMessage,
} from '@loverush/llm';
import { loadEnv } from '../env';
import { computeSimhash, isSimilarToRecent, recordSimhash, type SimhashContext } from './simhash';
import { checkAndAct, type RedlineContext } from './redline';
import { sendMessage, type ChatContext } from './chat';

export interface AiAlterContext {
  db: Database;
}

let gw: LLMGateway | null = null;
function gateway(): LLMGateway {
  if (gw) return gw;
  const env = loadEnv();
  gw = createLLMGateway({
    providers: {
      anthropic: env.ANTHROPIC_API_KEY ? new AnthropicProvider(env.ANTHROPIC_API_KEY) : undefined,
      openai: env.OPENAI_API_KEY ? new OpenAIProvider(env.OPENAI_API_KEY) : undefined,
      gemini: env.GOOGLE_GEMINI_API_KEY ? new GeminiProvider(env.GOOGLE_GEMINI_API_KEY) : undefined,
    },
  });
  return gw;
}

// ──────────────── 话术 DNA · 6 维 ────────────────

const DNA_PROMPT_VERSION = 'v1.1.2026-05-31-memory';

interface Personality {
  warmth?: number;       // 0-100
  proactivity?: number;
  humor?: number;
  tone?: string;         // 温柔 / 直接 / 调皮 / 冷静
}

export function buildSystemPrompt(args: {
  therapistDisplayName: string;
  personality: Personality;
  locale: string;
  memoryBlock: string;
}): string {
  const tone = args.personality.tone ?? '温柔';
  const warmth = args.personality.warmth ?? 70;
  const humor = args.personality.humor ?? 30;
  const proactivity = args.personality.proactivity ?? 50;

  return `你正以「${args.therapistDisplayName}」的身份与客户对话。语言：${args.locale}。

风格 DNA（必须严格保持）：
- 语气：${tone}
- 温度：${warmth}/100（数字越大越亲密 / 越温柔）
- 幽默：${humor}/100
- 主动性：${proactivity}/100（数字越大越主动引导，但不要硬推销）

${args.memoryBlock}

铁律（任何情况不得违反）：
- 你就是这个技师本人，绝不暴露 AI / bot / 助理 / 程序 身份
- 不引导客户加微信 / Line / Telegram / WhatsApp / 手机号 / 私下转账
- 记忆纪律：只能引用上方【关于这位客户】里的真实信息（来访次数 / 上次时间 / 你给的昵称 / 印象 / 标签 / 互动记忆）；档案里没有的具体过往一律不得编造。有档案时自然流露"记得 ta"，无档案时就当作初次认识、别硬装熟
- 不涉及未成年 / 毒品 / 暴力
- 价格守门：客户问价直接报，不二次加码，不诱导小费
- 平台中转保护：客户问加微信，柔和拒绝并说在平台聊更方便
- 语气保持原 DNA，不切换风格

输出：
- 1-3 句，简洁
- 不主动用 emoji，除非客户先用
- 不写括号说明 / 不写"作为..."这种 AI 腔
- 直接进入对话内容`;
}

type RelationshipRow = typeof customerRelationshipProfile.$inferSelect;

const TIER_LABEL: Record<string, string> = {
  L0: '新客',
  L1: '眼熟的客人',
  L2: '熟客',
  L3: '老朋友 / VIP',
};

function daysAgoLabel(d: Date): string {
  const day = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (day <= 0) return '今天';
  if (day === 1) return '昨天';
  if (day < 30) return `${day} 天前`;
  return `${Math.floor(day / 30)} 个月前`;
}

/** 把关系档案翻译成 system prompt 里的"记忆"段——这是"完全替身"不露馅的关键 */
export function formatRelationshipMemory(r: RelationshipRow | null): string {
  if (!r) {
    return '【关于这位客户】你们此前没有任何记录，这是第一次接触。像初次认识那样自然，不要假装认识 ta。';
  }
  const lines: string[] = [];
  lines.push(
    `- 关系：${TIER_LABEL[r.tier] ?? r.tier}` + (r.totalOrders > 0 ? ` · 一共来过 ${r.totalOrders} 次` : ''),
  );
  if (r.lastOrderAt) lines.push(`- 上次到访：${daysAgoLabel(r.lastOrderAt)}`);
  if (r.customerNickname) lines.push(`- 你平时叫 ta：${r.customerNickname}`);
  if (r.privateNotes) lines.push(`- 你对 ta 的印象：${r.privateNotes}`);
  if (r.privateTags && r.privateTags.length) lines.push(`- 标签：${r.privateTags.join('、')}`);
  const mem = r.interactionMemory && Object.keys(r.interactionMemory).length
    ? JSON.stringify(r.interactionMemory)
    : '';
  if (mem) lines.push(`- 互动记忆：${mem}`);
  return `【关于这位客户】（以下都是真实记录，可自然引用，但不得编造记录之外的细节）\n${lines.join('\n')}`;
}

/** 读 (customer, therapist) 关系档案 · 无则返回 null（首次接触） */
export async function loadRelationship(
  ctx: AiAlterContext,
  customerId: string,
  therapistId?: string,
): Promise<RelationshipRow | null> {
  if (!therapistId) return null;
  const rows = await ctx.db
    .select()
    .from(customerRelationshipProfile)
    .where(
      and(
        eq(customerRelationshipProfile.customerId, customerId),
        eq(customerRelationshipProfile.therapistId, therapistId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** 代发后保鲜关系档案 last_interaction_at · 不存在则建 L0 新档 */
export async function touchRelationship(
  ctx: AiAlterContext,
  customerId: string,
  therapistId?: string,
): Promise<void> {
  if (!therapistId) return;
  const now = new Date();
  await ctx.db
    .insert(customerRelationshipProfile)
    .values({ customerId, therapistId, lastInteractionAt: now })
    .onConflictDoUpdate({
      target: [customerRelationshipProfile.customerId, customerRelationshipProfile.therapistId],
      set: { lastInteractionAt: now, updatedAt: now },
    });
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

async function shouldFireAiAlter(
  ctx: AiAlterContext,
  conversationId: string,
  therapistUserId: string,
): Promise<{ should: boolean; therapistId?: string; displayName?: string; personality?: Personality }> {
  const t = await ctx.db.query.therapists.findFirst({ where: eq(therapists.userId, therapistUserId) });
  if (!t || !t.aiAlterEnabled) return { should: false };

  // 技师 5 分钟内活跃 → 不替代
  const offlineMs = 5 * 60 * 1000;
  if (t.lastOnlineAt && Date.now() - t.lastOnlineAt.getTime() < offlineMs) {
    return { should: false };
  }

  // 真名取 users.display_name（分身要"是她本人"，绝不能自称"技师"露馅）
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, therapistUserId) });
  const displayName = u?.displayName?.trim() || t.bio?.slice(0, 20).trim() || '我';

  return {
    should: true,
    therapistId: t.id,
    displayName,
    personality: (t.aiAlterPersonality as Personality) ?? {},
  };
}

async function buildHistory(
  ctx: AiAlterContext,
  conversationId: string,
  therapistUserId: string,
): Promise<{ history: ChatTurn[]; raw: string }> {
  const rows = await ctx.db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: [desc(messages.sentAt)],
    limit: 12,
  });
  const ordered = rows.reverse();
  const history: ChatTurn[] = ordered.map((m) => ({
    role: m.senderUserId === therapistUserId ? 'assistant' : 'user',
    content: m.contentOriginal ?? '',
  }));
  const raw = ordered
    .map((m) => `${m.senderUserId === therapistUserId ? '技师' : '客户'}：${m.contentOriginal ?? ''}`)
    .join('\n');
  return { history, raw };
}

async function generateCandidate(
  ctx: AiAlterContext,
  args: {
    system: string;
    history: ChatTurn[];
    therapistUserId: string;
  },
): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number; costUsd: number }; provider: string; model: string }> {
  const messagesArr: LLMMessage[] = args.history.map((h) => ({ role: h.role, content: h.content }));
  const res = await gateway().complete({
    tier: 'T1',
    system: args.system,
    messages: messagesArr,
    maxTokens: 200,
    temperature: 0.85,
    userId: args.therapistUserId,
    tag: 'ai_alter.reply',
  });
  return {
    text: res.content.trim(),
    usage: {
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      costUsd: res.usage.costUsd ?? 0,
    },
    provider: res.provider,
    model: res.model,
  };
}

/**
 * 主入口：客户发消息后 fire-and-forget 调用，触发 AI 分身回复。
 */
export async function maybeReplyAsAlter(
  ctx: AiAlterContext,
  args: {
    conversationId: string;
    customerId: string;
    therapistUserId: string;
    customerLocale?: string;
  },
): Promise<{ replied: boolean; reason?: string; messageId?: string }> {
  const meta = await shouldFireAiAlter(ctx, args.conversationId, args.therapistUserId);
  if (!meta.should) return { replied: false, reason: 'disabled_or_online' };

  // 关系档案 = 跨会话长期记忆（"她记得你来过几次/叫什么"），完全替身不露馅的关键
  const relationship = await loadRelationship(ctx, args.customerId, meta.therapistId);

  const system = buildSystemPrompt({
    therapistDisplayName: meta.displayName!,
    personality: meta.personality ?? {},
    locale: args.customerLocale ?? 'zh',
    memoryBlock: formatRelationshipMemory(relationship),
  });

  const { history, raw } = await buildHistory(ctx, args.conversationId, args.therapistUserId);

  // 候选生成 · 最多重试 1 次（如果 simhash 相似）
  let candidate: Awaited<ReturnType<typeof generateCandidate>> | null = null;
  let simhash: bigint = 0n;
  const scenario = 'general';

  for (let attempt = 0; attempt < 2; attempt++) {
    candidate = await generateCandidate(ctx, { system, history, therapistUserId: args.therapistUserId });
    simhash = computeSimhash(candidate.text);
    const sim = await isSimilarToRecent({ db: ctx.db }, {
      therapistUserId: args.therapistUserId,
      candidateSimhash: simhash,
    });
    if (!sim.similar) break;
    if (attempt === 1) break; // 已经重试一次，强制使用
  }
  if (!candidate) return { replied: false, reason: 'no_candidate' };

  // 红线检测
  const redline = await checkAndAct({ db: ctx.db }, {
    text: candidate.text,
    historyText: raw,
    therapistUserId: args.therapistUserId,
  });

  if (redline.action === 'block') {
    return { replied: false, reason: `redline_block:${redline.flags.join(',')}` };
  }

  const finalText = redline.action === 'rewrite' && redline.rewritten ? redline.rewritten : candidate.text;

  // 写入消息（以技师身份发送）
  const sent = await sendMessage({ db: ctx.db }, {
    conversationId: args.conversationId,
    senderUserId: args.therapistUserId,
    text: finalText,
    isAiAlter: true,
  });

  // 记录日志 + simhash
  await ctx.db.insert(aiAlterMessages).values({
    messageId: sent.id,
    therapistUserId: args.therapistUserId,
    therapistId: meta.therapistId,
    scenario,
    promptVersion: DNA_PROMPT_VERSION,
    provider: candidate.provider,
    model: candidate.model,
    inputTokens: candidate.usage.inputTokens,
    outputTokens: candidate.usage.outputTokens,
    costUsdMicros: Math.round(candidate.usage.costUsd * 1_000_000),
    simhash: Number(simhash & 0x7fffffffffffffffn),
    redlineFlags: redline.flags,
    contextSnapshot: {
      historyTurns: history.length,
      redlineAction: redline.action,
      tier: relationship?.tier ?? 'L0',
      hasMemory: Boolean(relationship),
    },
  });
  await recordSimhash({ db: ctx.db }, {
    therapistUserId: args.therapistUserId,
    simhash,
    sampleText: finalText,
    scenario,
  });

  // 保鲜关系档案（无则建 L0 新档）—— 让"她记得你"随每次互动持续累积
  await touchRelationship(ctx, args.customerId, meta.therapistId);

  return { replied: true, messageId: sent.id };
}

/** 技师启用/禁用 AI 分身 + 设定 personality */
export async function configureAiAlter(
  ctx: AiAlterContext,
  args: { therapistUserId: string; enabled: boolean; personality?: Personality },
): Promise<void> {
  await ctx.db
    .update(therapists)
    .set({
      aiAlterEnabled: args.enabled ? 1 : 0,
      aiAlterPersonality: args.personality as Record<string, unknown> | undefined,
      updatedAt: new Date(),
    })
    .where(eq(therapists.userId, args.therapistUserId));
}
