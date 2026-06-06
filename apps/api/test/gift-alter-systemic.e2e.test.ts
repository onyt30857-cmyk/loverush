/**
 * 系统性根治 · 礼物分身回复(方向反 + 连发喷条 + 垃圾段)e2e
 *
 * 覆盖三个根因的修复:
 *  P0-1 触发门控:gift/卡片类消息(非自然语言)不触发正常回复管线 → 不与 reactToGift 道谢双发
 *  P0-2 角色接地:礼物道谢用收礼方向(谢谢你送我),绝不反向(想看你戴);5 个付费动作各有接地
 *  P0-3 垃圾段:splitIntoSegments 丢 "---"/纯标点/空段;generateCompanionReply 返回过 validateOutput
 *
 * 跑(清空 LLM key → 走确定性 fallback,绝不真打 LLM):
 *   ANTHROPIC_API_KEY= OPENAI_API_KEY= GOOGLE_GEMINI_API_KEY= \
 *   DATABASE_URL=...loverush_test pnpm exec vitest run test/gift-alter-systemic.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { conversations, messages, therapists, aiAlterPendingReply } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import {
  splitIntoSegments,
  giftGrounding,
  COMPANION_ACTION_GROUNDING,
} from '../src/services/ai_alter';
import { reactToGift } from '../src/services/companion';
import { sendMessage } from '../src/services/chat';
import { isNaturalLanguage as isNatFromKind } from '../src/services/messageKind';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ───────────── P0-1 · 触发门控判别器(纯) ─────────────
describe('P0-1 触发门控 · isNaturalLanguage(只放行 text)', () => {
  it('自然语言文本 → 触发回复', () => {
    expect(isNatFromKind('text')).toBe(true);
    expect(isNatFromKind(undefined)).toBe(true); // 默认 text
  });
  it('礼物/卡片/媒体 → 不触发回复(否则与 reactToGift 双发=喷条)', () => {
    expect(isNatFromKind('gift')).toBe(false);
    expect(isNatFromKind('order_offer')).toBe(false);
    expect(isNatFromKind('schedule_offer')).toBe(false);
    expect(isNatFromKind('order_card')).toBe(false);
    expect(isNatFromKind('customer_location')).toBe(false);
    expect(isNatFromKind('voice')).toBe(false);
    expect(isNatFromKind('image')).toBe(false);
  });
});

// ───────────── P0-2 · 角色/方向接地(纯) ─────────────
describe('P0-2 角色接地 · 礼物收礼方向 + 付费动作', () => {
  it('礼物接地:收礼口吻 + 负约束(绝不反向叫他戴)', () => {
    const g = giftGrounding('项链');
    expect(g).toContain('项链');
    expect(g).toContain('收到礼物'); // 收礼方向
    expect(g).toMatch(/你的/); // 东西归你
    expect(g).toMatch(/不能反过来|绝对不能/); // 负约束
  });
  it('5 个付费动作都有接地指令,主语=你(分身)对他(客户)', () => {
    for (const code of ['voice_whisper', 'flirt_mode', 'peek', 'wake_up', 'tonight_exclusive']) {
      expect(COMPANION_ACTION_GROUNDING[code]).toBeTruthy();
      expect(COMPANION_ACTION_GROUNDING[code]).toContain('【你');
    }
  });
});

// ───────────── P0-3 · 切段丢垃圾(纯) ─────────────
describe('P0-3 splitIntoSegments · 丢 "---"/纯标点/空段', () => {
  it('丢掉独立的 "---" 垃圾段,保留真实文字', () => {
    expect(splitIntoSegments('我想你~\n\n---\n\n（我在的）')).toEqual(['我想你~', '（我在的）']);
  });
  it('纯标点段被丢', () => {
    expect(splitIntoSegments('好呀\n\n。。。')).toEqual(['好呀']);
  });
  it('整段都是垃圾 → 返回空(上层 empty_segments 兜底,不发气泡)', () => {
    expect(splitIntoSegments('---')).toEqual([]);
    expect(splitIntoSegments('。。。\n\n~~~')).toEqual([]);
  });
  it('正常单段/无空行 → 原样返回', () => {
    expect(splitIntoSegments('哇好开心呀💕')).toEqual(['哇好开心呀💕']);
  });
});

// ───────────── 集成 · reactToGift 端到端(空 key → fallback) ─────────────
describe('reactToGift 端到端 · 一个礼物只出一条收礼道谢 + 不触发正常管线', () => {
  let therapistUserId: string;
  let customerId: string;
  let conversationId: string;

  beforeAll(async () => {
    await truncateAll();
    const t = await registerNew('therapist');
    therapistUserId = t.user.id;
    const c = await registerNew('customer');
    customerId = c.user.id;
    const db = await getDb();
    await db.insert(therapists).values({ userId: therapistUserId, aiAlterEnabled: 1 });
    const [conv] = await db
      .insert(conversations)
      .values({ customerId, therapistUserId })
      .returning({ id: conversations.id });
    conversationId = conv!.id;
  });

  it('送礼物 → 1 条 gift(客户) + 1 条道谢(技师·收礼方向),无反向,无额外回复', async () => {
    const db = await getDb();
    await reactToGift(
      { db },
      { customerId, therapistUserId, conversationId, giftEmoji: '💎', giftName: '项链', grossPoints: 1000 },
    );

    const msgs = await db
      .select({ sender: messages.senderUserId, type: messages.type, ai: messages.isAiAlter, body: messages.contentOriginal })
      .from(messages)
      .where(eq(messages.conversationId, conversationId));

    const gifts = msgs.filter((m) => m.type === 'gift');
    const thanks = msgs.filter((m) => m.ai === 1);

    expect(gifts).toHaveLength(1); // 一条礼物记录
    expect(gifts[0]!.sender).toBe(customerId); // 客户身份发
    expect(thanks).toHaveLength(1); // 只有一条分身道谢(不喷条)
    expect(thanks[0]!.sender).toBe(therapistUserId);

    const thankText = thanks[0]!.body ?? '';
    // 收礼方向:谢"你送我";绝不反向"想看你戴 / 你戴上"
    expect(thankText).toMatch(/谢谢你送我|你送我的/);
    expect(thankText).not.toMatch(/想看你戴|你戴上|你真的戴/);
  });

  it('礼物消息不触发正常回复管线(无 pending 行)· 而文本会触发', async () => {
    const db = await getDb();
    // 礼物已发(上一个 it),门控应未登记 pending
    await sleep(300);
    const pendingAfterGift = await db
      .select({ id: aiAlterPendingReply.conversationId })
      .from(aiAlterPendingReply)
      .where(eq(aiAlterPendingReply.conversationId, conversationId));
    expect(pendingAfterGift).toHaveLength(0); // gift 不登记 ← P0-1

    // 对照:客户发一条文本 → 应登记 pending(门控对自然语言仍生效)
    await sendMessage({ db }, { conversationId, senderUserId: customerId, text: '在吗想你了' });
    // schedulePendingReply 是 fire-and-forget,轮询等待
    let pendingAfterText: { id: string }[] = [];
    for (let i = 0; i < 20; i++) {
      pendingAfterText = await db
        .select({ id: aiAlterPendingReply.conversationId })
        .from(aiAlterPendingReply)
        .where(eq(aiAlterPendingReply.conversationId, conversationId));
      if (pendingAfterText.length > 0) break;
      await sleep(100);
    }
    expect(pendingAfterText).toHaveLength(1); // 文本触发 ← 门控对自然语言仍放行
  });
});
