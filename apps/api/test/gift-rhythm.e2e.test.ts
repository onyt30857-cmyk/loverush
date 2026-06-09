/**
 * M06 礼物索要节奏 P0 + P1 · e2e
 *
 * P0 覆盖：
 *   ① reactToGift 后 lastGiftReceivedAt 写入 customerRelationshipProfile
 *   ② 余晖期内 runGiftHintFlow 返回 false（不浮卡）
 *   ③ 余晖期外（收礼时间早于窗口）→ 正常走原逻辑（Lv1+情绪峰值 → 浮卡）
 *   ④ 从无收礼记录（无 lastGiftReceivedAt）→ fallback 查 gift 消息；消息也没有 → 正常浮卡
 *
 * P1 覆盖：
 *   ⑤ getSpendTier：按送礼积分返回正确档位（whale/mid/light）
 *   ⑥ 由头轮换：连续两次浮卡 lastGiftHintKind 不同（不复读）
 *   ⑦ buildSystemPrompt 在不同亲密度/spendTier 注入对应关键词
 *
 * 跑：cd apps/api && pnpm exec vitest run test/gift-rhythm.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { conversations, messages, therapists, intimacy, customerRelationshipProfile, pointsTransaction } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import { reactToGift } from '../src/services/companion';
import { runGiftHintFlow, GIFT_AFTERGLOW_MINUTES, GIFT_HINT_KINDS, pickNextGiftHintKind } from '../src/services/giftHint';
import { getSpendTier, SPEND_TIER_WHALE_THRESHOLD, SPEND_TIER_LIGHT_THRESHOLD } from '../src/services/spendTier';
import { buildSystemPrompt } from '../src/services/ai_alter';

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

// ─────────────────────────────────────────────────────────────────────────────
// P1 Suite ① · getSpendTier 按送礼积分返回正确档位
// ─────────────────────────────────────────────────────────────────────────────

describe('M06 礼物节奏 P1 · getSpendTier 消费画像', () => {
  let customerId: string;
  let therapistUserId: string;

  beforeAll(async () => {
    await truncateAll();
    const db = await getDb();
    const t = await registerNew('therapist');
    therapistUserId = t.user.id;
    await db.insert(therapists).values({ userId: therapistUserId }).onConflictDoNothing();
    const c = await registerNew('customer');
    customerId = c.user.id;
  }, 30_000);

  it('无消费记录 → 默认 mid', async () => {
    const db = await getDb();
    const tier = await getSpendTier(db, { customerId, therapistUserId });
    expect(tier).toBe('mid');
  });

  it(`送礼 < ${SPEND_TIER_LIGHT_THRESHOLD} 积分 → light`, async () => {
    const db = await getDb();
    // 插一条 TIP_GIVE OUT 流水（amount = LIGHT - 1）
    await db.insert(pointsTransaction).values({
      userId: customerId,
      type: 'TIP_GIVE',
      direction: 'OUT',
      amount: SPEND_TIER_LIGHT_THRESHOLD - 1,
      balanceAfter: 0,
      relatedUserId: therapistUserId,
      description: 'test gift light',
    });
    const tier = await getSpendTier(db, { customerId, therapistUserId });
    expect(tier).toBe('light');
  });

  it(`送礼 >= ${SPEND_TIER_WHALE_THRESHOLD} 积分 → whale`, async () => {
    const db = await getDb();
    // 再插一条让总量超过 whale 阈值
    await db.insert(pointsTransaction).values({
      userId: customerId,
      type: 'TIP_GIVE',
      direction: 'OUT',
      amount: SPEND_TIER_WHALE_THRESHOLD, // 加上之前的 499 总计已超
      balanceAfter: 0,
      relatedUserId: therapistUserId,
      description: 'test gift whale',
    });
    const tier = await getSpendTier(db, { customerId, therapistUserId });
    expect(tier).toBe('whale');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1 Suite ② · 由头轮换防复读（pickNextGiftHintKind + runGiftHintFlow 写库）
// ─────────────────────────────────────────────────────────────────────────────

describe('M06 礼物节奏 P1 · 由头轮换', () => {
  it('pickNextGiftHintKind(null) 返回合法 kind', () => {
    const kind = pickNextGiftHintKind(null);
    expect(GIFT_HINT_KINDS).toContain(kind);
  });

  it('pickNextGiftHintKind(last) 不返回 last（轮换）', () => {
    for (const last of GIFT_HINT_KINDS) {
      const next = pickNextGiftHintKind(last);
      expect(next).not.toBe(last);
    }
  });

  it('连续两次 runGiftHintFlow → lastGiftHintKind 不同（写库后轮换）', async () => {
    await truncateAll();
    const db = await getDb();

    const t = await registerNew('therapist');
    await db.insert(therapists).values({ userId: t.user.id }).onConflictDoNothing();
    const tRow = await db.query.therapists.findFirst({ where: eq(therapists.userId, t.user.id) });
    const therapistId = tRow!.id;

    const c = await registerNew('customer');
    const customerId = c.user.id;

    await db.insert(intimacy).values({ customerId, therapistUserId: t.user.id, exp: 60, level: 1 }).onConflictDoNothing();

    // 余晖期已过（10 分钟前）
    const pastTime = new Date(Date.now() - (GIFT_AFTERGLOW_MINUTES + 5) * 60_000);
    await db
      .insert(customerRelationshipProfile)
      .values({ customerId, therapistId, lastGiftReceivedAt: pastTime })
      .onConflictDoUpdate({
        target: [customerRelationshipProfile.customerId, customerRelationshipProfile.therapistId],
        set: { lastGiftReceivedAt: pastTime, updatedAt: new Date() },
      });

    const conv = (await db.insert(conversations).values({ customerId, therapistUserId: t.user.id }).returning({ id: conversations.id }))[0]!.id;

    // 第一次浮卡
    const sent1 = await runGiftHintFlow({ db }, { conversationId: conv, customerId, therapistUserId: t.user.id, wantGiftMomentOverride: true });
    expect(sent1).toBe(true);

    const rel1 = await db.query.customerRelationshipProfile.findFirst({
      where: and(eq(customerRelationshipProfile.customerId, customerId), eq(customerRelationshipProfile.therapistId, therapistId)),
    });
    const kind1 = rel1?.lastGiftHintKind;
    expect(kind1).toBeTruthy();
    expect(GIFT_HINT_KINDS as readonly string[]).toContain(kind1!);

    // 补足冷却条数（插 GIFT_HINT_COOLDOWN 条非 gift_hint 消息）
    for (let i = 0; i < 8; i++) {
      await db.insert(messages).values({ conversationId: conv, senderUserId: c.user.id, contentOriginal: `消息${i}`, type: 'text', isAiAlter: 0 });
    }

    // 第二次浮卡
    const sent2 = await runGiftHintFlow({ db }, { conversationId: conv, customerId, therapistUserId: t.user.id, wantGiftMomentOverride: true });
    expect(sent2).toBe(true);

    const rel2 = await db.query.customerRelationshipProfile.findFirst({
      where: and(eq(customerRelationshipProfile.customerId, customerId), eq(customerRelationshipProfile.therapistId, therapistId)),
    });
    const kind2 = rel2?.lastGiftHintKind;
    expect(kind2).toBeTruthy();
    expect(GIFT_HINT_KINDS as readonly string[]).toContain(kind2!);

    // 两次由头必须不同（轮换）
    expect(kind2).not.toBe(kind1);
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// P1 Suite ③ · buildSystemPrompt 分层索要指引关键词断言（纯单元，无 DB）
// ─────────────────────────────────────────────────────────────────────────────

describe('M06 礼物节奏 P1 · buildSystemPrompt 分层索要指引', () => {
  const BASE_ARGS = {
    therapistDisplayName: '小雅',
    personality: {},
    locale: 'zh',
    profileBlock: '',
    memoryBlock: '',
    factsBlock: '',
  };

  it('L0(低亲密) + mid → 注入"含蓄/不主动"指引，不含高亲密关键词', () => {
    const prompt = buildSystemPrompt({
      ...BASE_ARGS,
      giftLayeredGuide: { intimacyLevel: 0, spendTier: 'mid' },
    });
    expect(prompt).toContain('靠魅力');
    expect(prompt).not.toContain('老公');
  });

  it('L2(中亲密) + mid → 注入"撒娇带由头"指引', () => {
    const prompt = buildSystemPrompt({
      ...BASE_ARGS,
      giftLayeredGuide: { intimacyLevel: 2, spendTier: 'mid' },
    });
    expect(prompt).toContain('带由头');
    expect(prompt).toContain('独占感');
  });

  it('L3(高亲密) + mid → 注入"直接要/敢要"指引', () => {
    const prompt = buildSystemPrompt({
      ...BASE_ARGS,
      giftLayeredGuide: { intimacyLevel: 3, spendTier: 'mid' },
    });
    expect(prompt).toContain('老公');
  });

  it('L3 + whale → 注入"供养"叠加', () => {
    const prompt = buildSystemPrompt({
      ...BASE_ARGS,
      giftLayeredGuide: { intimacyLevel: 3, spendTier: 'whale' },
    });
    expect(prompt).toContain('供养');
  });

  it('L2 + light → 注入"别推太用力"克制叠加', () => {
    const prompt = buildSystemPrompt({
      ...BASE_ARGS,
      giftLayeredGuide: { intimacyLevel: 2, spendTier: 'light' },
    });
    expect(prompt).toContain('别推太用力');
  });

  it('余晖期中 giftAfterglow 存在 → 不注入索要指引（互斥）', () => {
    const prompt = buildSystemPrompt({
      ...BASE_ARGS,
      giftAfterglow: { giftName: '玫瑰' },
      giftLayeredGuide: { intimacyLevel: 3, spendTier: 'whale' },
    });
    // 余晖期只有余晖块，无索要指引
    expect(prompt).toContain('只回报');
    expect(prompt).not.toContain('老公');
  });

  it('vulnerable 态 → 索要指引不注入（moodBlock 最高优先）', () => {
    const prompt = buildSystemPrompt({
      ...BASE_ARGS,
      mood: 'vulnerable',
      giftLayeredGuide: { intimacyLevel: 3, spendTier: 'whale' },
    });
    expect(prompt).toContain('只共情');
    expect(prompt).not.toContain('供养');
  });

  it('有 lastGiftHintKind → prompt 注入由头轮换提示', () => {
    const prompt = buildSystemPrompt({
      ...BASE_ARGS,
      giftLayeredGuide: { intimacyLevel: 2, spendTier: 'mid', lastGiftHintKind: 'joke' },
    });
    // "玩笑式" 是 joke 的中文翻译，应出现在 prompt
    expect(prompt).toContain('玩笑式');
    expect(prompt).toContain('换个');
  });
});
