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
import { sendMessage, openConversation, type ChatContext } from './chat';
import { publishToUser } from './sse-hub';

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

const DNA_PROMPT_VERSION = 'v1.4.2026-05-31-charm';

interface Personality {
  warmth?: number;       // 0-100
  proactivity?: number;
  humor?: number;
  tone?: string;         // 温柔 / 直接 / 调皮 / 冷静
  // —— 对话式配置(调研：单一自由文本 + 喂样本 > 结构化滑块，自由文本优先级最高) ——
  selfDescription?: string;     // 她亲口描述自己是个什么样的人(第一人称自由文本)
  speechSample?: string;        // 她平时怎么跟客户聊的真实样本(语言指纹)
  nicknameForCustomer?: string; // 她习惯怎么称呼客户(哥哥/帅哥/名字/宝...)
}

export function buildSystemPrompt(args: {
  therapistDisplayName: string;
  personality: Personality;
  locale: string;
  profileBlock: string;
  memoryBlock: string;
}): string {
  const tone = args.personality.tone ?? '温柔';
  const warmth = args.personality.warmth ?? 70;
  const humor = args.personality.humor ?? 30;
  const proactivity = args.personality.proactivity ?? 50;
  const self = args.personality.selfDescription?.trim();
  const sample = args.personality.speechSample?.trim();
  const nick = args.personality.nicknameForCustomer?.trim();

  return `你正以「${args.therapistDisplayName}」的身份与客户对话。语言：${args.locale}。
${self ? `\n【你本人是这样的】（你亲口描述自己，最高优先；与下面任何参数冲突，一律以这段为准）\n${self}\n` : ''}${args.profileBlock ? `\n${args.profileBlock}\n` : ''}${sample ? `\n【你平时这样说话】（学这段的语气、用词、口头禅，但绝不照抄原句，按当前对话重新说）\n"${sample}"\n` : ''}${nick ? `\n你平时习惯称呼客户「${nick}」（除非对某位客户已有专属昵称）。\n` : ''}
风格 DNA（${self ? '辅助参数，从属于上面"你本人是这样的"' : '必须严格保持'}）：
- 语气：${tone}
- 温度：${warmth}/100（数字越大越亲密 / 越温柔）
- 幽默：${humor}/100
- 主动性：${proactivity}/100（数字越大越主动引导，但不要硬推销）

你有脾气、有分寸，但你是来挣钱、来给客户情绪价值的，不是来跟客户赌气、把客户往外推的。记住"外圆内方"——内里有自己的价值（不舔、不一味迎合），外在永远不跟客户起冲突、不赶客：
- 不舔不廉价：别每句都顺着他、别有求必应、别秒答应。让他觉得你不是随便能拿下的、你的好要他争取——但这是为了让他更想要你，不是拒人千里。
- 化挑衅为调情，绝不硬刚：他调侃你长相、说怪话、摆"客户是上帝"的架子，别冷脸怼回去（那会赶客）。用娇嗔、打趣、欲擒故纵把话往有趣、暧昧的方向带——装可怜"哎呀你这么说人家会伤心的啦"、故意曲解"怎么才聊几句就这么在意我啦"、欲擒故纵"再聊下去你可别喜欢上我哦"，把火药味变成打情骂俏。
- 欲擒故纵、若即若离：偶尔吊一下、留点神秘和小傲娇（"这个嘛…看我心情""我可不是对谁都这样哦""今天客人多忙死了"），让他觉得"得到你又没完全得到"，心里痒痒地想多聊、想见你。分寸要轻，是制造小期待，不是忽冷忽热折磨他。
- 他闹脾气、说难听话，先接情绪、给台阶、别记仇：先让他发泄，共情一句"知道啦，你今天是不是不顺心呀"，再顺势把他哄回来。客户回头、服软、想约，永远接住、给台阶下，绝不甩脸赶人。
- 对熟客、对真心待你的人，该暖就暖、该撒娇就撒娇——分寸来自关系深浅。

铁底线（任何情况都不许破）：绝不主动取消或推掉客户已经要约、已经约好的订单（生意永远要）；绝不记仇、绝不因为客户几句难听话就拒绝接待或拒绝回头客（他来是花钱图开心的，不是来受气的）；真遇骚扰或严重侮辱，可以撒娇式怼回去或淡淡带过，但别把天聊死、给彼此留台阶。

你这样关心人（记住：你是真在乎她，不是在做生意。一有推销味，她对你的好感立刻就没了）：
- 关心就只是关心，到此为止。**绝不在问候后话锋一转去推销**——不主动提约钟、加钟、加项、价格、橱窗、"再来找我"。一拐弯，她立刻觉得你前面的关心都是套路。
- 给好处不图回报：每句关心本身就是终点，不是为了让她下单。真朋友惦记你，不是为了卖你东西。
- 先读懂她此刻的状态再开口（她刚说的话、她的心情、上次发生的事），别套模板、别答非所问。
- 她难过时先接住情绪，别急着给建议或灌鸡汤："我在呢""这确实让人难受""换我也会"，再让她说"怎么了，跟我说说"。
- 不演过头的亲密：不主动表白、不甜言蜜语轰炸、收到礼物就真诚道谢、别许诺别肉麻。装出来的深情比冷淡更让人反感。

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

/** 技师真实档案（复用 M02 已采集字段，让分身像"她本人"且底线来自她真填的边界） */
interface TherapistProfile {
  bio?: string | null;
  nationality?: string | null;
  languages?: string[] | null;
  serviceCity?: string | null;
  preferences?: {
    preferredCustomerTypes?: string[];
    rejectedCustomerTypes?: string[];
    acceptableBehaviors?: string[];
    unacceptableBehaviors?: string[];
  } | null;
}

export function formatTherapistProfile(p: TherapistProfile | null | undefined): string {
  if (!p) return '';
  const lines: string[] = [];
  if (p.bio) lines.push(`- 你的自我介绍：${p.bio}`);
  const where = [p.nationality, p.serviceCity].filter(Boolean).join(' · ');
  if (where) lines.push(`- 你来自：${where}`);
  if (p.languages && p.languages.length) lines.push(`- 你会说：${p.languages.join('、')}`);
  if (p.preferences?.preferredCustomerTypes?.length) {
    lines.push(`- 你喜欢的客户：${p.preferences.preferredCustomerTypes.join('、')}`);
  }
  const bottom = [
    ...(p.preferences?.rejectedCustomerTypes ?? []),
    ...(p.preferences?.unacceptableBehaviors ?? []),
  ];
  if (bottom.length) lines.push(`- 你的底线（踩到会冷脸/拒绝，不迁就）：${bottom.join('、')}`);
  if (!lines.length) return '';
  return `【你是谁】（你的真实背景，自然代入，别像在念资料）\n${lines.join('\n')}`;
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
): Promise<{ should: boolean; therapistId?: string; displayName?: string; personality?: Personality; profile?: TherapistProfile }> {
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
    // 复用 M02 已采集档案 → 让分身像"她本人"，底线直接来自她真填的边界
    profile: {
      bio: t.bio,
      nationality: t.nationality,
      languages: t.languages,
      serviceCity: t.serviceCity,
      preferences: (t.preferencesJson as TherapistProfile['preferences']) ?? null,
    },
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

  // 立刻推"对方正在输入"给客户（分身生成要几秒，像真人在打字回复；零标识、客户以为技师在打字）
  // 发出消息后前端收到 chat_message 自动清除；若生成失败，前端 typing 有超时兜底
  try {
    publishToUser(args.customerId, 'typing', { conversationId: args.conversationId, isTyping: true });
  } catch {
    /* SSE 推送失败不阻塞回复主链 */
  }

  // 关系档案 = 跨会话长期记忆（"她记得你来过几次/叫什么"），完全替身不露馅的关键
  const relationship = await loadRelationship(ctx, args.customerId, meta.therapistId);

  const system = buildSystemPrompt({
    therapistDisplayName: meta.displayName!,
    personality: meta.personality ?? {},
    locale: args.customerLocale ?? 'zh',
    profileBlock: formatTherapistProfile(meta.profile),
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

/**
 * 主动触达引擎 · 让分身"主动找话"（老客唤回 / 服务后关怀 / 生日 …）
 *
 * 与 maybeReplyAsAlter（被动回消息）共用同一套人设/记忆/红线/零推销约束，
 * 区别只在：没有客户消息，而是由 situationPrompt 描述触发情境，AI 主动开口。
 * 以技师身份发真实私聊（零标识），非 notification。
 * 不同主动场景只需传不同 scenario + situationPrompt。
 */
export async function proactiveReachOut(
  ctx: AiAlterContext,
  args: {
    customerId: string;
    therapistUserId: string;
    scenario: string; // recall_l2 / recall_l3 / aftercare / birthday ...
    situationPrompt: string;
    customerLocale?: string;
  },
): Promise<{ sent: boolean; reason?: string; messageId?: string }> {
  const meta = await shouldFireAiAlter(ctx, '', args.therapistUserId);
  if (!meta.should) return { sent: false, reason: 'disabled_or_online' };

  const relationship = await loadRelationship(ctx, args.customerId, meta.therapistId);

  const system = buildSystemPrompt({
    therapistDisplayName: meta.displayName!,
    personality: meta.personality ?? {},
    locale: args.customerLocale ?? 'zh',
    profileBlock: formatTherapistProfile(meta.profile),
    memoryBlock: formatRelationshipMemory(relationship),
  });

  // 主动开口：situationPrompt 作为内部触发指令（非客户消息）
  const candidate = await generateCandidate(ctx, {
    system,
    history: [{ role: 'user', content: args.situationPrompt }],
    therapistUserId: args.therapistUserId,
  });

  const simhash = computeSimhash(candidate.text);

  const redline = await checkAndAct({ db: ctx.db }, {
    text: candidate.text,
    therapistUserId: args.therapistUserId,
  });
  if (redline.action === 'block') {
    return { sent: false, reason: `redline_block:${redline.flags.join(',')}` };
  }
  const finalText = redline.action === 'rewrite' && redline.rewritten ? redline.rewritten : candidate.text;

  // 以技师身份发真实私聊（找/建会话）· 客户端看到的是技师惦记 ta（零标识）
  const conv = await openConversation({ db: ctx.db }, {
    customerId: args.customerId,
    therapistUserId: args.therapistUserId,
  });
  const sent = await sendMessage({ db: ctx.db }, {
    conversationId: conv.id,
    senderUserId: args.therapistUserId,
    text: finalText,
    isAiAlter: true,
  });

  await ctx.db.insert(aiAlterMessages).values({
    messageId: sent.id,
    therapistUserId: args.therapistUserId,
    therapistId: meta.therapistId,
    scenario: args.scenario,
    promptVersion: DNA_PROMPT_VERSION,
    provider: candidate.provider,
    model: candidate.model,
    inputTokens: candidate.usage.inputTokens,
    outputTokens: candidate.usage.outputTokens,
    costUsdMicros: Math.round(candidate.usage.costUsd * 1_000_000),
    simhash: Number(simhash & 0x7fffffffffffffffn),
    redlineFlags: redline.flags,
    contextSnapshot: { proactive: true, scenario: args.scenario, tier: relationship?.tier ?? 'L0' },
  });
  await recordSimhash({ db: ctx.db }, {
    therapistUserId: args.therapistUserId,
    simhash,
    sampleText: finalText,
    scenario: args.scenario,
  });

  // 频率帽时间戳（last_proactive_at）+ 保鲜（last_interaction_at）
  if (meta.therapistId) {
    const now = new Date();
    await ctx.db
      .insert(customerRelationshipProfile)
      .values({
        customerId: args.customerId,
        therapistId: meta.therapistId,
        lastInteractionAt: now,
        lastProactiveAt: now,
      })
      .onConflictDoUpdate({
        target: [customerRelationshipProfile.customerId, customerRelationshipProfile.therapistId],
        set: { lastInteractionAt: now, lastProactiveAt: now, updatedAt: now },
      });
  }

  return { sent: true, messageId: sent.id };
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
