/**
 * 下单成功 → 分身情绪价值反馈 e2e
 *
 * 验证 reactToOrderPlaced:技师开了分身→发一条暖心反馈到对话;没开→不代发。
 * 跑时清空 LLM key,走模板兜底路径(确定性,不真调模型)。
 *
 * 跑：cd apps/api && ANTHROPIC_API_KEY= OPENAI_API_KEY= GEMINI_API_KEY= \
 *     DATABASE_URL=...loverush_test pnpm exec vitest run test/order-placed-reaction.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { therapists, messages } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import { reactToOrderPlaced } from '../src/services/ai_alter';

describe('下单成功 → 分身情绪价值反馈', () => {
  it('技师开了分身 → 发一条暖心反馈到对话(无 LLM 走模板兜底)', async () => {
    await truncateAll();
    const tUserId = (await registerNew('therapist')).user.id;
    const cUserId = (await registerNew('customer')).user.id;
    const db = await getDb();
    await db.insert(therapists).values({ userId: tUserId, aiAlterEnabled: 1 }); // 开了分身

    const r = await reactToOrderPlaced({ db }, { therapistUserId: tUserId, customerId: cUserId });
    expect(r.sent).toBe(true);

    const msgs = await db.select().from(messages).where(eq(messages.senderUserId, tUserId));
    expect(msgs.length).toBe(1);
    expect((msgs[0]!.contentOriginal ?? '').length).toBeGreaterThan(0);
    expect(msgs[0]!.isAiAlter).toBe(1); // 以分身身份发
  });

  it('技师没开分身 → 不代发(sent:false, 对话无消息)', async () => {
    await truncateAll();
    const t2 = (await registerNew('therapist')).user.id;
    const c2 = (await registerNew('customer')).user.id;
    const db = await getDb();
    await db.insert(therapists).values({ userId: t2 }); // aiAlterEnabled 默认 0(没开分身)

    const r = await reactToOrderPlaced({ db }, { therapistUserId: t2, customerId: c2 });
    expect(r.sent).toBe(false);

    const msgs = await db.select().from(messages).where(eq(messages.senderUserId, t2));
    expect(msgs.length).toBe(0);
  });
});
