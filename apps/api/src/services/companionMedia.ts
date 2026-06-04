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
import { pickFreshMedia, imageCooldownOk, recordMediaSend } from './chatMedia';
import { sendMessage } from './chat';

export interface CompanionMediaContext {
  db: Database;
}

export interface RunTeasePhotoFlowArgs {
  conversationId: string;
  customerId: string;
  therapistUserId: string;
  intimacyLevel: number;
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
 * 生成撩拨文字。本期返回兜底常量（真实 LLM 撩拨留后续迭代）。
 */
export function generateTease(): string {
  return '想看啊？那你得先好好哄哄我~';
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

    const media = await pickFreshMedia(ctx, {
      therapistUserId: args.therapistUserId,
      customerId: args.customerId,
      intimacyLevel: args.intimacyLevel,
      tiers: ['free'],
    });
    if (!media) return; // 发光了 / 无图

    // 1) 撩拨文字（分身身份发，零标识）
    await sendMessage(ctx, {
      conversationId: args.conversationId,
      senderUserId: args.therapistUserId,
      text: generateTease(),
      isAiAlter: true,
    });

    // 2) 图（type=image，content 存图 url；分身身份发）
    await sendMessage(ctx, {
      conversationId: args.conversationId,
      senderUserId: args.therapistUserId,
      text: media.url,
      type: 'image',
      isAiAlter: true,
    });

    // 3) 记录发送（防重核心，一图对一客户只发一次）
    await recordMediaSend(ctx, {
      therapistUserId: args.therapistUserId,
      customerId: args.customerId,
      mediaId: media.id,
      conversationId: args.conversationId,
    });
  } catch (err) {
    console.warn('[companionMedia] runTeasePhotoFlow failed (降级不抛):', err instanceof Error ? err.message : err);
  }
}
