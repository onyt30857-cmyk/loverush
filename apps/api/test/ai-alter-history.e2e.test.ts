/**
 * 分身历史治理 e2e · buildHistory 按消息类型过滤
 *
 * 验证根因①修复：动作卡片(order_offer/gift_hint 等 JSON)不再被当 assistant turn 回灌 LLM，
 * 且窗口不被卡片挤占(末轮崩根因)。
 *
 * 跑：cd apps/api && pnpm exec vitest run test/ai-alter-history.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { conversations, messages } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import { buildHistory } from '../src/services/ai_alter';

async function openConv(customerId: string, therapistUserId: string): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(conversations)
    .values({ customerId, therapistUserId })
    .returning({ id: conversations.id });
  return row!.id;
}

async function insertMsg(
  conversationId: string,
  senderUserId: string,
  type: string,
  content: string,
  offsetSec: number,
) {
  const db = await getDb();
  await db.insert(messages).values({
    conversationId,
    senderUserId,
    type,
    contentOriginal: content,
    sentAt: new Date(Date.UTC(2026, 0, 1, 0, 0, offsetSec)),
  });
}

const CARD_JSON = JSON.stringify({ therapistId: 'x', therapistName: '小雨', tiers: [{ duration: 60, pricePoints: 200 }] });
const GIFT_JSON = JSON.stringify({ giftId: 'g1', name: '玫瑰', pricePoints: 50 });

describe('buildHistory · 卡片不回灌 + 窗口不被卡片吃掉', () => {
  let therapistUserId: string;
  let customerId: string;

  beforeAll(async () => {
    await truncateAll();
    const t = await registerNew('therapist');
    therapistUserId = t.user.id;
    const c = await registerNew('customer');
    customerId = c.user.id;
  });

  it('混合类型：history 只含自然语言，卡片 JSON 被剔除，角色正确', async () => {
    const db = await getDb();
    const convId = await openConv(customerId, therapistUserId);
    await insertMsg(convId, customerId, 'text', '在吗', 1);
    await insertMsg(convId, therapistUserId, 'text', '在的呀', 2);
    await insertMsg(convId, therapistUserId, 'order_offer', CARD_JSON, 3);
    await insertMsg(convId, customerId, 'text', '好的', 4);
    await insertMsg(convId, therapistUserId, 'gift_hint', GIFT_JSON, 5);
    await insertMsg(convId, therapistUserId, 'text', '想你了', 6);

    const { history, raw } = await buildHistory({ db } as Parameters<typeof buildHistory>[0], convId, therapistUserId);

    const contents = history.map((h) => h.content);
    // 卡片 JSON 绝不在历史里
    expect(contents.some((c) => c.includes('tiers') || c.includes('therapistId'))).toBe(false);
    expect(contents.some((c) => c.includes('giftId'))).toBe(false);
    expect(raw.includes('tiers')).toBe(false);
    // 自然语言全保留
    expect(contents).toEqual(['在吗', '在的呀', '好的', '想你了']);
    // 角色映射正确
    expect(history.find((h) => h.content === '在吗')!.role).toBe('user');
    expect(history.find((h) => h.content === '想你了')!.role).toBe('assistant');
  });

  it('大量卡片挤占：真对话不被卡片吃出窗口(末轮崩修复)', async () => {
    await truncateAll();
    const t = await registerNew('therapist');
    const tid = t.user.id;
    const c = await registerNew('customer');
    const cid = c.user.id;
    const db = await getDb();
    const convId = await openConv(cid, tid);
    // 4 条真对话散落在 12 张卡片之间(共 16 行 > historyWindow 8)
    let sec = 0;
    await insertMsg(convId, cid, 'text', '第一句', ++sec);
    for (let i = 0; i < 4; i++) await insertMsg(convId, tid, 'order_offer', CARD_JSON, ++sec);
    await insertMsg(convId, tid, 'text', '第二句', ++sec);
    for (let i = 0; i < 4; i++) await insertMsg(convId, tid, 'gift_hint', GIFT_JSON, ++sec);
    await insertMsg(convId, cid, 'text', '第三句', ++sec);
    for (let i = 0; i < 4; i++) await insertMsg(convId, tid, 'chat_paywall', '{"x":1}', ++sec);
    await insertMsg(convId, tid, 'text', '第四句', ++sec);

    const { history } = await buildHistory({ db } as Parameters<typeof buildHistory>[0], convId, tid);
    const contents = history.map((h) => h.content);
    // 旧实现：最近 8 行几乎全是卡片，"第一句/第二句"会被挤出。修复后 4 句全在。
    expect(contents).toEqual(['第一句', '第二句', '第三句', '第四句']);
  });
});
