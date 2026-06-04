/**
 * M18 撩拨发图 · 挑图核心 e2e
 *
 * 主干：注册 therapist+customer → seed 2 张免费图 →
 *   用例1 防重：挑→记→挑(≠首张)→记→第三次挑 null
 *   用例2 亲密度门槛：插一张 intimacyMin=3 的图，lvl0 客户挑(tiers free/paid) → 若挑到则其 intimacyMin<=0
 *
 * 跑：
 *   cd apps/api
 *   DATABASE_URL=...loverush_test pnpm exec vitest run test/chat-media.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { chatMedia, conversations } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import {
  pickFreshMedia,
  recordMediaSend,
  imageCooldownOk,
} from '../src/services/chatMedia';

describe('M18 撩拨发图 · chatMedia', () => {
  let therapistUserId: string;
  let customerId: string;
  let freeIds: string[] = [];

  beforeAll(async () => {
    await truncateAll();

    const therapist = await registerNew('therapist');
    therapistUserId = therapist.user.id;
    const customer = await registerNew('customer');
    customerId = customer.user.id;

    const db = await getDb();
    const inserted = await db
      .insert(chatMedia)
      .values([
        { therapistUserId, url: 'https://cdn.test/free-1.jpg', tier: 'free', intimacyMin: 0 },
        { therapistUserId, url: 'https://cdn.test/free-2.jpg', tier: 'free', intimacyMin: 0 },
      ])
      .returning({ id: chatMedia.id });
    freeIds = inserted.map((r) => r.id);
    expect(freeIds.length).toBe(2);
  }, 30_000);

  it('用例1 防重：挑→记→挑(≠首张)→记→第三次挑 null', async () => {
    const db = await getDb();
    const ctx = { db };

    const first = await pickFreshMedia(ctx, {
      therapistUserId,
      customerId,
      intimacyLevel: 0,
      tiers: ['free'],
    });
    expect(first).not.toBeNull();
    expect(freeIds).toContain(first!.id);
    await recordMediaSend(ctx, { therapistUserId, customerId, mediaId: first!.id });

    const second = await pickFreshMedia(ctx, {
      therapistUserId,
      customerId,
      intimacyLevel: 0,
      tiers: ['free'],
    });
    expect(second).not.toBeNull();
    expect(second!.id).not.toBe(first!.id);
    expect(freeIds).toContain(second!.id);
    await recordMediaSend(ctx, { therapistUserId, customerId, mediaId: second!.id });

    const third = await pickFreshMedia(ctx, {
      therapistUserId,
      customerId,
      intimacyLevel: 0,
      tiers: ['free'],
    });
    expect(third).toBeNull();
  });

  it('用例2 亲密度门槛：lvl0 客户不会挑到 intimacyMin=3 的图', async () => {
    const db = await getDb();
    const ctx = { db };

    // 新客户，避免被用例1的发送记录污染
    const fresh = await registerNew('customer');
    const freshCustomerId = fresh.user.id;

    await db.insert(chatMedia).values({
      therapistUserId,
      url: 'https://cdn.test/paid-hi.jpg',
      tier: 'paid',
      intimacyMin: 3,
    });

    const picked = await pickFreshMedia(ctx, {
      therapistUserId,
      customerId: freshCustomerId,
      intimacyLevel: 0,
      tiers: ['free', 'paid'],
    });

    // lvl0 挑到的图，其 intimacyMin 必须 <= 0（绝不会是那张 intimacyMin=3 的 paid 图）
    if (picked) {
      expect(picked.intimacyMin).toBeLessThanOrEqual(0);
    }
  });

  it('用例3 防连发：刚发图后没新消息 → 冷却未到 false(修复前会抛 Date 错被吞)', async () => {
    const db = await getDb();
    const ctx = { db };
    const c = await registerNew('customer');
    const [conv] = await db
      .insert(conversations)
      .values({ customerId: c.user.id, therapistUserId })
      .returning({ id: conversations.id });
    // 模拟刚发过一张图
    await recordMediaSend(ctx, { therapistUserId, customerId: c.user.id, mediaId: freeIds[0]!, conversationId: conv!.id });
    // 之后 0 条新消息 < cooldown 2 → 必须 false(且不抛)
    const ok = await imageCooldownOk(ctx, {
      therapistUserId,
      customerId: c.user.id,
      conversationId: conv!.id,
      cooldownMessages: 2,
    });
    expect(ok).toBe(false);
  });
});
