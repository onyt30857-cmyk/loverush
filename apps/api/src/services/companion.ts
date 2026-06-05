/**
 * M18 心动陪伴（陪聊付费）service
 *
 * triggerCompanionAction：客户对技师发起一个亲密动作
 *   1. 查 companion_actions（按 code，且 isActive=1）
 *   2. debit 客户 pricePoints（余额不足由 debit 内部抛 E2010）
 *   3. credit 技师分成（Math.floor(price * revenueShareBps / 10000)），平台留差额
 *   4. upsert intimacy 经验值（+expReward）
 *
 * getIntimacy：查客户 × 技师亲密度（exp / level）
 *
 * 计费走 points.ts 的 debit/credit（原子 + 幂等 + 流水）。
 * txnType 复用 CHAT_SPEND / CHAT_EARN（陪聊付费 ≈ 聊天消费/收入），
 * 用 metadata.scene='companion' 区分来源。
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { companionActions, intimacy } from '@loverush/db';
import { ErrorCode } from '@loverush/types';
import { HttpError } from '../middleware/errors';
import { credit, debit } from './points';
import { generateCompanionReply } from './ai_alter';
import { sendMessage } from './chat';

export interface CompanionContext {
  db: Database;
}

/** 亲密度等级阈值（exp 下界）· 0 陌生 1 熟悉 2 暧昧 3 心动 4 专属。待 Tony 调曲线。 */
export const INTIMACY_LEVEL_THRESHOLDS = [0, 50, 150, 350, 700] as const;
export function levelForExp(exp: number): number {
  let lvl = 0;
  for (let i = 0; i < INTIMACY_LEVEL_THRESHOLDS.length; i++) {
    if (exp >= INTIMACY_LEVEL_THRESHOLDS[i]!) lvl = i;
  }
  return lvl;
}

export interface TriggerCompanionArgs {
  customerId: string;
  therapistUserId: string;
  actionCode: string;
  /** 客户端 per-attempt token · 提供则用它做幂等键(retry 不重复扣款) · 不提供回退时间戳键 */
  idempotencyKey?: string;
  /** 当前会话 id · voice_whisper 语音入库需要(刷新后可从消息历史恢复) · 不传则只即时返回不入库 */
  conversationId?: string;
}

export interface TriggerCompanionResult {
  action: string;
  pricePoints: number;
  intimacyExp: number;
  level: number;
  /** 「她」对这次付费动作的亲密回复（T1 生成）；生成失败时为 null，不影响计费 */
  reply: string | null;
  /** voice_whisper 时「她的声音」合成音频 URL（ElevenLabs 声音复刻）；缺 key/样本/失败 → null，前端用占位 */
  audioUrl: string | null;
}

export async function triggerCompanionAction(
  ctx: CompanionContext,
  args: TriggerCompanionArgs,
): Promise<TriggerCompanionResult> {
  const { customerId, therapistUserId, actionCode } = args;

  const action = await ctx.db.query.companionActions.findFirst({
    where: and(eq(companionActions.code, actionCode), eq(companionActions.isActive, 1)),
  });
  if (!action) {
    throw HttpError.badRequest(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'companion action not found');
  }

  const pricePoints = action.pricePoints;
  // 客户端传 token → 幂等键固定（retry 命中 points 既有记录，钱只扣一次）；
  // 未传 → 回退时间戳键（向后兼容，但无 retry 保护）
  const baseKey = args.idempotencyKey
    ? `companion.${args.idempotencyKey}`
    : `companion.${customerId}.${therapistUserId}.${actionCode}.${Date.now()}`;

  // ──────── 先生成内容,成功才扣费(客户拿不到内容绝不收钱) ────────
  // 1. 「她」的亲密回复（T1）· 用当前亲密度等级定语气(动作产生的升级是结果,不影响本次回复)
  const curLevel = (await getIntimacy(ctx, { customerId, therapistUserId })).level;
  let reply: string | null = null;
  try {
    const r = await generateCompanionReply(
      { db: ctx.db },
      { therapistUserId, customerId, actionCode, intimacyLevel: curLevel },
    );
    reply = r.text;
  } catch (err) {
    console.warn('[companion] reply generation failed:', (err as Error)?.message);
    reply = null;
  }
  // 回复生成失败 → 不扣费,抛错让前端提示重试(绝不"扣了钱没内容")
  if (!reply) {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, '回复生成失败，请稍后重试（未扣费）');
  }

  // 2. voice_whisper → 合成「她的声音」· 客户买的就是语音,合成失败则不扣费抛错
  //    (没复刻声音的技师前端不展示该动作;这里是后端兜底防护)
  let audioUrl: string | null = null;
  if (actionCode === 'voice_whisper') {
    try {
      const { synthesizeWhisper } = await import('./voice');
      audioUrl = await synthesizeWhisper({ db: ctx.db }, { therapistUserId, text: reply });
    } catch (err) {
      console.warn('[companion] voice synth failed:', (err as Error)?.message);
      audioUrl = null;
    }
    if (!audioUrl) {
      throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, '语音合成失败，已取消本次扣费，请稍后再试');
    }
  }

  // ──────── 内容已就绪 → 计费 ────────
  // 3. 客户出账（余额不足 → debit 内部抛 E2010_BALANCE_INSUFFICIENT）
  await debit(
    { db: ctx.db },
    {
      userId: customerId,
      type: 'CHAT_SPEND',
      amount: pricePoints,
      description: `companion:${actionCode}`,
      relatedUserId: therapistUserId,
      idempotencyKey: baseKey,
      metadata: { scene: 'companion', actionCode },
    },
  );

  // 4. 技师分成入账（平台留差额，隐式）
  const share = Math.floor((pricePoints * action.revenueShareBps) / 10000);
  if (share > 0) {
    await credit(
      { db: ctx.db },
      {
        userId: therapistUserId,
        type: 'CHAT_EARN',
        amount: share,
        description: `companion:${actionCode}`,
        relatedUserId: customerId,
        idempotencyKey: `${baseKey}.share`,
        metadata: { scene: 'companion', actionCode },
      },
    );
  }

  // 5. 亲密度 upsert（+expReward）· returning 拿最新 exp 算 level
  const [row] = await ctx.db
    .insert(intimacy)
    .values({ customerId, therapistUserId, exp: action.expReward })
    .onConflictDoUpdate({
      target: [intimacy.customerId, intimacy.therapistUserId],
      set: {
        exp: sql`${intimacy.exp} + ${action.expReward}`,
        updatedAt: new Date(),
      },
    })
    .returning();

  const newExp = row?.exp ?? action.expReward;
  const newLevel = levelForExp(newExp);
  // level 升级则落库（intimacy.level 只在变化时写，省一次无谓 update）
  if (row && row.level !== newLevel) {
    await ctx.db
      .update(intimacy)
      .set({ level: newLevel, updatedAt: new Date() })
      .where(
        and(
          eq(intimacy.customerId, customerId),
          eq(intimacy.therapistUserId, therapistUserId),
        ),
      );
  }

  // 6. voice 语音入库 · 作为一条 type='voice' 消息(content=audioUrl,分身身份)持久化,
  //    刷新/重进对话可从消息历史恢复(修"付费语音刷新即丢")。需 conversationId;入库失败不回滚
  //    (语音已成功生成、本次 return 仍可即时播放,仅历史未存,降级可接受)。
  if (actionCode === 'voice_whisper' && audioUrl && args.conversationId) {
    try {
      await sendMessage(
        { db: ctx.db },
        {
          conversationId: args.conversationId,
          // content 存 JSON{text:转录文字, audioUrl:语音}，前端 voice 气泡解析(刷新后可恢复文字+音频)
          senderUserId: therapistUserId,
          text: JSON.stringify({ text: reply, audioUrl }),
          type: 'voice',
          isAiAlter: true,
        },
      );
    } catch (err) {
      console.warn('[companion] voice message persist failed (已扣费,即时仍可播):', (err as Error)?.message);
    }
  }

  return {
    action: actionCode,
    pricePoints,
    intimacyExp: action.expReward,
    level: newLevel,
    reply,
    audioUrl,
  };
}

export interface GetIntimacyArgs {
  customerId: string;
  therapistUserId: string;
}

export interface IntimacyResult {
  exp: number;
  level: number;
}

export async function getIntimacy(
  ctx: CompanionContext,
  args: GetIntimacyArgs,
): Promise<IntimacyResult> {
  const row = await ctx.db.query.intimacy.findFirst({
    where: and(
      eq(intimacy.customerId, args.customerId),
      eq(intimacy.therapistUserId, args.therapistUserId),
    ),
  });
  return { exp: row?.exp ?? 0, level: row?.level ?? 0 };
}

/**
 * 客户送礼后的「分身反应」· 把心意礼物(/tips 打赏)接进心动陪伴飞轮:
 *   ① 加亲密度(exp = 礼物积分/10,下限 1) → 推进"熟悉▸暧昧"进度
 *   ② 对话发一条 type='gift' 礼物消息(content JSON,双方可见"送了什么",不卡输入框/不触发额外 AI)
 *   ③ 分身娇羞道谢一句(generateCompanionReply,失败降级模板)
 * 不碰计费(giveTip 已扣);全程不抛(打赏成功不因反应失败回滚)。
 */
export async function reactToGift(
  ctx: CompanionContext,
  args: { customerId: string; therapistUserId: string; conversationId?: string; giftEmoji: string; giftName: string; grossPoints: number },
): Promise<{ level: number; exp: number }> {
  const exp = Math.max(1, Math.floor(args.grossPoints / 10));
  const [row] = await ctx.db
    .insert(intimacy)
    .values({ customerId: args.customerId, therapistUserId: args.therapistUserId, exp })
    .onConflictDoUpdate({
      target: [intimacy.customerId, intimacy.therapistUserId],
      set: { exp: sql`${intimacy.exp} + ${exp}`, updatedAt: new Date() },
    })
    .returning();
  const newExp = row?.exp ?? exp;
  const newLevel = levelForExp(newExp);
  if (row && row.level !== newLevel) {
    await ctx.db
      .update(intimacy)
      .set({ level: newLevel, updatedAt: new Date() })
      .where(and(eq(intimacy.customerId, args.customerId), eq(intimacy.therapistUserId, args.therapistUserId)));
  }

  if (args.conversationId) {
    // ① 礼物消息(type='gift',content=JSON{emoji,name,points},客户身份)·双方对话里可见"送了什么"
    //    后端发(不卡输入框);归 MEDIA 不回灌 LLM + 翻译跳过(JSON 不被翻坏)
    try {
      await sendMessage(
        { db: ctx.db },
        {
          conversationId: args.conversationId,
          senderUserId: args.customerId,
          text: JSON.stringify({ emoji: args.giftEmoji, name: args.giftName, points: args.grossPoints }),
          type: 'gift',
          isAiAlter: false,
        },
      );
    } catch (err) {
      console.warn('[companion] gift record message failed:', (err as Error)?.message);
    }

    // ② 分身娇羞道谢(她为礼物开心)
    let reply: string | null = null;
    try {
      const r = await generateCompanionReply(
        { db: ctx.db },
        { therapistUserId: args.therapistUserId, customerId: args.customerId, actionCode: `收到你送的「${args.giftName}」`, intimacyLevel: newLevel },
      );
      reply = r.text;
    } catch (err) {
      console.warn('[companion] gift reaction reply failed:', (err as Error)?.message);
    }
    if (reply) {
      try {
        await sendMessage(
          { db: ctx.db },
          { conversationId: args.conversationId, senderUserId: args.therapistUserId, text: reply, isAiAlter: true },
        );
      } catch (err) {
        console.warn('[companion] gift reaction sendMessage failed:', (err as Error)?.message);
      }
    }
  }
  return { level: newLevel, exp: newExp };
}
