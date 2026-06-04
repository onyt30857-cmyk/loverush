/**
 * M18 撩拨发图 · Phase 2 · 编排服务 e2e
 *
 * 主干：注册 therapist+customer → seed 1 张免费图 → 建会话 →
 *   用例1 wantOverride=true,cooldown=0 → messages 里出现 1 张 type=image(content=图url) + 撩拨 text
 *   用例2 同会话再跑 → 图总数仍 1（防重不重发）
 *   用例3 新客户新会话 wantOverride=false → 图 0
 *
 * 跑：
 *   cd apps/api
 *   DATABASE_URL=...loverush_test pnpm exec vitest run test/companion-media.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { chatMedia, conversations, messages } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import { runTeasePhotoFlow } from '../src/services/companionMedia';

async function openConv(customerId: string, therapistUserId: string): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(conversations)
    .values({ customerId, therapistUserId })
    .returning({ id: conversations.id });
  return row!.id;
}

async function imageMsgs(conversationId: string) {
  const db = await getDb();
  return db
    .select({ id: messages.id, type: messages.type, content: messages.contentOriginal })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.type, 'image')));
}

async function textMsgs(conversationId: string) {
  const db = await getDb();
  return db
    .select({ id: messages.id, content: messages.contentOriginal })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.type, 'text')));
}

describe('M18 撩拨发图 · companionMedia 编排', () => {
  let therapistUserId: string;
  let customerId: string;
  let conversationId: string;
  const photoUrl = 'https://cdn.test/tease-free-1.jpg';

  beforeAll(async () => {
    await truncateAll();

    const therapist = await registerNew('therapist');
    therapistUserId = therapist.user.id;
    const customer = await registerNew('customer');
    customerId = customer.user.id;

    const db = await getDb();
    await db.insert(chatMedia).values({
      therapistUserId,
      url: photoUrl,
      tier: 'free',
      intimacyMin: 0,
    });

    conversationId = await openConv(customerId, therapistUserId);
  }, 30_000);

  it('用例1 wantOverride=true,cooldown=0 → 发撩拨文字 + 1 张免费图', async () => {
    const db = await getDb();
    await runTeasePhotoFlow(
      { db },
      {
        conversationId,
        customerId,
        therapistUserId,
        intimacyLevel: 0,
        cooldownMessages: 0,
        wantPhotoOverride: true,
      },
    );

    const imgs = await imageMsgs(conversationId);
    expect(imgs.length).toBe(1);
    expect(imgs[0]!.content).toBe(photoUrl);

    const texts = await textMsgs(conversationId);
    expect(texts.length).toBeGreaterThanOrEqual(1); // 撩拨文字
  });

  it('用例2 同会话再跑 → 图总数仍 1（防重）', async () => {
    const db = await getDb();
    await runTeasePhotoFlow(
      { db },
      {
        conversationId,
        customerId,
        therapistUserId,
        intimacyLevel: 0,
        cooldownMessages: 0,
        wantPhotoOverride: true,
      },
    );

    const imgs = await imageMsgs(conversationId);
    expect(imgs.length).toBe(1); // 唯一免费图已发过，不重发
  });

  it('用例3 新客户新会话 wantOverride=false → 图 0', async () => {
    const db = await getDb();
    const fresh = await registerNew('customer');
    const freshCustomerId = fresh.user.id;
    const freshConv = await openConv(freshCustomerId, therapistUserId);

    await runTeasePhotoFlow(
      { db },
      {
        conversationId: freshConv,
        customerId: freshCustomerId,
        therapistUserId,
        intimacyLevel: 0,
        cooldownMessages: 0,
        wantPhotoOverride: false,
      },
    );

    const imgs = await imageMsgs(freshConv);
    expect(imgs.length).toBe(0);
  });
});
