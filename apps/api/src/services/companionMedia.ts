/**
 * M18 撩拨发图 · Phase 2 · 编排服务（先撩后发免费图）
 *
 * runTeasePhotoFlow：分身回复后，若客户在要图 → 先发一句撩拨文字，再发一张免费图。
 *   门槛层层把关（任何一关不过直接 return，绝不强发）：
 *     1. want   —— 客户当前是否在要图（wantPhotoOverride 优先，否则关键词判定）
 *     2. cooldown —— 连发冷却（imageCooldownOk：距上次发图须新增 >= cooldownMessages 条）
 *     3. fresh   —— pickFreshMedia 取一张"没发过 + 够亲密度 + free tier"的图（发光/无图 → null）
 *   通过后：sendMessage 撩拨文字(分身身份) → sendMessage 图(type=image,分身身份) → recordMediaSend(防重)
 *
 * 铁律：
 *   - 窄 select 全在 chatMedia service 内（本文件只编排，不直查表）。
 *   - 整个流程 try/catch 包裹，任何失败 console.warn 降级、绝不抛（钩子方 void 调用，抛了也吞，但这里再兜一层）。
 */

import type { Database } from '@loverush/db';
import { pickFreshMedia, imageCooldownOk, recordMediaSend, recentAlterTexts } from './chatMedia';
import { sendMessage } from './chat';
import { getIntimacy } from './companion';

export interface CompanionMediaContext {
  db: Database;
}

export interface RunTeasePhotoFlowArgs {
  conversationId: string;
  customerId: string;
  therapistUserId: string;
  /** 亲密度等级；不传则内部从 getIntimacy 取真实等级(分级门槛用) */
  intimacyLevel?: number;
  cooldownMessages: number;
  /** 显式指定客户是否在要图（测试/上层已判定时用）；不传则走 detectPhotoIntent(customerText) */
  wantPhotoOverride?: boolean;
  /** 客户最近一条消息文本（用于关键词意图判定） */
  customerText?: string;
}

/**
 * 关键词判定客户是否在要图（避 LLM key 依赖，零外部调用）。
 * 无 text → false（安全：拿不到上下文绝不主动发图）。
 */
export function detectPhotoIntent(text?: string): boolean {
  if (!text) return false;
  return /照片|图|自拍|看看你|发张|pic|photo|长什么样|真人/i.test(text);
}

/**
 * 生成撩拨文字。一组在人设里的撩拨语，零 LLM 成本、零露馅风险
 * （真实 LLM 撩拨成本高+耦合+难验证+易露馅,刻意不用 [[reference_llm_roleplay_reliability]]）。
 *
 * 防模板化复读（[[reference_ai_voice_design]] / 调研 ACMC+repeat-distance）：
 *   - 库扩到 15 条（纯随机重复概率从 1/5=20% 降到 1/15≈6.7%）
 *   - repeat-distance：传入本会话最近发过的撩拨句，从"没说过的"里选，杜绝连续复读
 *     （和图片层 pickFreshMedia 永不重发同一思路，文案层补齐）
 */
const TEASES = [
  '想看啊？那你得先好好哄哄我~',
  '这么急着看我呀…那再陪我聊两句嘛😚',
  '嗯…就给你一个人看哦，不许给别人',
  '害羞死了…你要看的话，得答应我别跑',
  '偷偷发你一张，看完要夸我好不好看哦',
  '急什么呀，越急我越想逗逗你😏',
  '看可以，先告诉我今天有没有想我嘛',
  '哎呀被你这么一说，脸都红了…那就一张哦',
  '想看真的我呀？那你得对我好一点点～',
  '就知道你会要，拿你没办法…只此一张哦',
  '先说好，看了不许跑去找别人',
  '人家精心拍的，你可要好好看呀～',
  '嘻嘻，想我了对不对？那我奖励你一下下',
  '这张是我刚拍的，只想发给你一个人看',
  '答应我看完要回我话，不许已读不回哦😚',
] as const;

/**
 * @param recentTexts 本会话最近的分身文字消息（用于避开刚发过的撩拨句）；不传则纯随机。
 */
export function generateTease(recentTexts: string[] = []): string {
  const recent = new Set(recentTexts);
  const pool = TEASES.filter((t) => !recent.has(t));
  const arr = pool.length > 0 ? pool : TEASES; // 全被用过(极端)则回退全库
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * 先撩后发免费图。门槛任意不过即 return；全程不抛。
 */
export async function runTeasePhotoFlow(
  ctx: CompanionMediaContext,
  args: RunTeasePhotoFlowArgs,
): Promise<void> {
  try {
    const want = args.wantPhotoOverride ?? detectPhotoIntent(args.customerText);
    if (!want) return;

    const cooldownOk = await imageCooldownOk(ctx, {
      therapistUserId: args.therapistUserId,
      customerId: args.customerId,
      conversationId: args.conversationId,
      cooldownMessages: args.cooldownMessages,
    });
    if (!cooldownOk) return; // 连发冷却没到

    // 撩拨话术防复读：取最近 8 条分身文字，generateTease 从没说过的里选
    const recentTexts = await recentAlterTexts(ctx, { conversationId: args.conversationId, limit: 8 });

    // 真实亲密度等级（分级门槛用）：不传则从 getIntimacy 取，越亲解锁越私密的图
    const intimacyLevel = args.intimacyLevel
      ?? (await getIntimacy(ctx, { customerId: args.customerId, therapistUserId: args.therapistUserId })).level;

    // 优先免费图（撩拨白嫖一张），免费图发光了再退付费图（发锁定 offer 待解锁）
    const freeMedia = await pickFreshMedia(ctx, {
      therapistUserId: args.therapistUserId,
      customerId: args.customerId,
      intimacyLevel,
      tiers: ['free'],
    });

    if (freeMedia) {
      // ── 免费图：先原子占位防并发重发 → 撩拨文字 → 发真图 ──
      // 1) 先 recordMediaSend 占位：占到(true)才发；没占到(false=并发抢先/已发过)直接 return，
      //    彻底杜绝"并发两流程都 pickFreshMedia 到同一张图、都发一遍"的重发。
      const reserved = await recordMediaSend(ctx, {
        therapistUserId: args.therapistUserId,
        customerId: args.customerId,
        mediaId: freeMedia.id,
        conversationId: args.conversationId,
      });
      if (!reserved) return;

      // 2) 撩拨文字（分身身份发，零标识）
      await sendMessage(ctx, {
        conversationId: args.conversationId,
        senderUserId: args.therapistUserId,
        text: generateTease(recentTexts),
        isAiAlter: true,
      });

      // 3) 图（type=image，content 存图 url；分身身份发）
      await sendMessage(ctx, {
        conversationId: args.conversationId,
        senderUserId: args.therapistUserId,
        text: freeMedia.url,
        type: 'image',
        isAiAlter: true,
      });
      return;
    }

    // ── 免费图发光了 → 退付费图：撩拨文字 + 发 media_locked 锁定 offer（不发真图、不记录，解锁时才记） ──
    const paidMedia = await pickFreshMedia(ctx, {
      therapistUserId: args.therapistUserId,
      customerId: args.customerId,
      intimacyLevel,
      tiers: ['paid'],
    });
    if (!paidMedia) return; // 付费图也没有 → 不发

    // 1) 撩拨文字（分身身份发，零标识）
    await sendMessage(ctx, {
      conversationId: args.conversationId,
      senderUserId: args.therapistUserId,
      text: generateTease(recentTexts),
      isAiAlter: true,
    });

    // 2) 锁定 offer（type=media_locked，content 存解锁所需元信息；分身身份发）
    await sendMessage(ctx, {
      conversationId: args.conversationId,
      senderUserId: args.therapistUserId,
      text: JSON.stringify({
        mediaId: paidMedia.id,
        pricePoints: paidMedia.pricePoints,
        thumbnailUrl: paidMedia.thumbnailUrl,
      }),
      type: 'media_locked',
      isAiAlter: true,
    });
  } catch (err) {
    console.warn('[companionMedia] runTeasePhotoFlow failed (降级不抛):', err instanceof Error ? err.message : err);
  }
}
