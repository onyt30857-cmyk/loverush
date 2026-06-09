/**
 * M06 礼物索要节奏 P0 · e2e
 *
 * 覆盖：
 *   ① reactToGift 后 lastGiftReceivedAt 写入 customerRelationshipProfile
 *   ② 余晖期内 runGiftHintFlow 返回 false（不浮卡）
 *   ③ 余晖期外（收礼时间早于窗口）→ 正常走原逻辑（Lv1+情绪峰值 → 浮卡）
 *   ④ 从无收礼记录（无 lastGiftReceivedAt）→ fallback 查 gift 消息；消息也没有 → 正常浮卡
 *
 * 跑：cd apps/api && pnpm exec vitest run test/gift-rhythm.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { conversations, messages, therapists, intimacy, customerRelationshipProfile } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import { reactToGift } from '../src/services/companion';
import { runGiftHintFlow, GIFT_AFTERGLOW_MINUTES } from '../src/services/giftHint';

// ───────── 工具函数 ─────────

async function openConv(customerId: string, therapistUserId: string): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(conversations)
    .values({ customerId, therapistUserId })
    .returning({ id: conversations.id });
  return row!.id;
}

async function getRelationship(customerId: string, therapistId: string) {
  const db = await getDb();
  return db.query.customerRelationshipProfile.findFirst({
    where: and(
      eq(customerRelationshipProfile.customerId, customerId),
      eq(customerRelationshipProfile.therapistId, therapistId),
    ),
  });
}

async function countGiftHintMsgs(conversationId: string) {
  const db = await getDb();
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.type, 'gift_hint')));
  return rows.length;
}

// ───────── Suite ─────────

describe('M06 礼物索要节奏 P0', () => {
  let customerId: string;
  let therapistUserId: string;
  let therapistId: string; // therapists.id
  let conversationId: string;

  beforeAll(async () => {
    await truncateAll();

    const db = await getDb();

    const t = await registerNew('therapist');
    therapistUserId = t.user.id;

    // 建 therapists 行（e2e 手动建，与 gift-hint.e2e.test.ts 一致）
    await db.insert(therapists).values({ userId: therapistUserId }).onConflictDoNothing();
    const tRow = await db.query.therapists.findFirst({
      where: eq(therapists.userId, therapistUserId),
    });
    therapistId = tRow!.id;

    const c = await registerNew('customer');
    customerId = c.user.id;

    // 亲密度 Lv1（exp=60 >= 50）保证正常情况下能浮卡
    await db
      .insert(intimacy)
      .values({ customerId, therapistUserId, exp: 60, level: 1 })
      .onConflictDoNothing();

    conversationId = await openConv(customerId, therapistUserId);
  }, 30_000);

  // ① reactToGift 写 lastGiftReceivedAt
  it('reactToGift 后 lastGiftReceivedAt 被写入 relationship', async () => {
    const db = await getDb();
    const before = await getRelationship(customerId, therapistId);
    // reactToGift 在 relationship 不存在时会 insert；存在时 onConflictDoUpdate
    expect(before?.lastGiftReceivedAt ?? null).toBeNull();

    await reactToGift(
      { db },
      {
        customerId,
        therapistUserId,
        conversationId,
        giftEmoji: '💐',
        giftName: '玫瑰花束',
        grossPoints: 100,
      },
    );

    const after = await getRelationship(customerId, therapistId);
    expect(after?.lastGiftReceivedAt).not.toBeNull();
    // 收礼时间应该在 2 秒内
    const diffMs = Date.now() - (after!.lastGiftReceivedAt!.getTime());
    expect(diffMs).toBeLessThan(2_000);
  });

  // ② 余晖期内 runGiftHintFlow 返回 false
  it('余晖期内（lastGiftReceivedAt 刚写入）→ runGiftHintFlow 不浮卡', async () => {
    const db = await getDb();
    // relationship.lastGiftReceivedAt 刚由上一个 test 写入（几毫秒前），在 GIFT_AFTERGLOW_MINUTES 内
    const sent = await runGiftHintFlow(
      { db },
      {
        conversationId,
        customerId,
        therapistUserId,
        wantGiftMomentOverride: true, // 强制情绪峰值，隔离其他变量
      },
    );
    expect(sent).toBe(false);
    expect(await countGiftHintMsgs(conversationId)).toBe(0);
  });

  // ③ 余晖期外（手动把 lastGiftReceivedAt 设为早于窗口）→ 正常浮卡
  it('余晖期外（收礼时间超过窗口）→ Lv1+情绪峰值 → 浮卡', async () => {
    const db = await getDb();

    // 把 lastGiftReceivedAt 设为 (GIFT_AFTERGLOW_MINUTES + 1) 分钟前
    const pastTime = new Date(Date.now() - (GIFT_AFTERGLOW_MINUTES + 1) * 60_000);
    await db
      .insert(customerRelationshipProfile)
      .values({ customerId, therapistId, lastGiftReceivedAt: pastTime })
      .onConflictDoUpdate({
        target: [customerRelationshipProfile.customerId, customerRelationshipProfile.therapistId],
        set: { lastGiftReceivedAt: pastTime, updatedAt: new Date() },
      });

    const sent = await runGiftHintFlow(
      { db },
      {
        conversationId,
        customerId,
        therapistUserId,
        wantGiftMomentOverride: true,
      },
    );
    expect(sent).toBe(true);
    expect(await countGiftHintMsgs(conversationId)).toBe(1);
  });

  // ④ relationship 无 lastGiftReceivedAt + gift 消息存在（fallback 路径）→ 余晖期内不浮卡
  it('fallback 路径：relationship 无记录但对话有刚送的 gift 消息 → 余晖期内不浮', async () => {
    const db = await getDb();

    // 新注册一对用于隔离
    const t2 = await registerNew('therapist');
    await db.insert(therapists).values({ userId: t2.user.id }).onConflictDoNothing();
    await db
      .insert(intimacy)
      .values({ customerId, therapistUserId: t2.user.id, exp: 60, level: 1 })
      .onConflictDoNothing();

    const conv2 = await openConv(customerId, t2.user.id);

    // 直接在对话里插一条 gift 消息（模拟刚送礼），不经 reactToGift（relationship 无记录）
    await db.insert(messages).values({
      conversationId: conv2,
      senderUserId: customerId,
      contentOriginal: JSON.stringify({ emoji: '🌹', name: '玫瑰', points: 50 }),
      type: 'gift',
      isAiAlter: 0,
    });

    const sent = await runGiftHintFlow(
      { db },
      {
        conversationId: conv2,
        customerId,
        therapistUserId: t2.user.id,
        wantGiftMomentOverride: true,
      },
    );
    expect(sent).toBe(false); // fallback 查到刚发的 gift 消息 → 余晖期内不浮
  });
});
