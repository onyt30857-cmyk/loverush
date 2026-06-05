/**
 * 语境路由 e2e · contextSense 情绪态判定 + buildSystemPrompt mood 注入
 *
 * 验证根因②修复：付费/索礼触点受情绪态门控；脆弱态 prompt 注入"只共情零索取"。
 *
 * 跑：cd apps/api && pnpm exec vitest run test/context-sense.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { conversations, messages } from '@loverush/db';
import { getDb, registerNew, truncateAll } from './helpers';
import { senseContext, senseRecentContext } from '../src/services/contextSense';
import { buildSystemPrompt } from '../src/services/ai_alter';

describe('senseContext · 纯函数情绪态分类', () => {
  it('脆弱：倾诉/低落 → vulnerable', () => {
    expect(senseContext([{ content: '今天好累啊，压力好大', isCustomer: true }]).mood).toBe('vulnerable');
    expect(senseContext([{ content: '刚跟女朋友分手了，难受', isCustomer: true }]).mood).toBe('vulnerable');
    expect(senseContext([{ content: '失眠睡不着，好孤独', isCustomer: true }]).mood).toBe('vulnerable');
  });
  it('戒备：试探身份 → guarded', () => {
    expect(senseContext([{ content: '你是不是机器人啊', isCustomer: true }]).mood).toBe('guarded');
    expect(senseContext([{ content: '真的假的，别是套路', isCustomer: true }]).mood).toBe('guarded');
  });
  it('暖意：正面亲密 → warm', () => {
    expect(senseContext([{ content: '哈哈哈跟你聊天好开心', isCustomer: true }]).mood).toBe('warm');
  });
  it('中性 / 空 → neutral', () => {
    expect(senseContext([{ content: '今天天气不错', isCustomer: true }]).mood).toBe('neutral');
    expect(senseContext([]).mood).toBe('neutral');
  });
  it('只看客户的话，分身自己说的不参与判定', () => {
    // 分身说"别难过"不应把客户判成 vulnerable
    expect(senseContext([{ content: '别难过呀，我陪你', isCustomer: false }]).mood).toBe('neutral');
  });
  it('脆弱优先级高于暖意(安全优先)', () => {
    expect(
      senseContext([
        { content: '哈哈开心', isCustomer: true },
        { content: '其实我最近好累好难过', isCustomer: true },
      ]).mood,
    ).toBe('vulnerable');
  });
});

describe('senseRecentContext · DB 集成(忽略卡片/分身消息)', () => {
  let therapistUserId: string;
  let customerId: string;

  beforeAll(async () => {
    await truncateAll();
    therapistUserId = (await registerNew('therapist')).user.id;
    customerId = (await registerNew('customer')).user.id;
  });

  it('客户倾诉(夹着卡片JSON与分身回复) → vulnerable，卡片不干扰', async () => {
    const db = await getDb();
    const [conv] = await db.insert(conversations).values({ customerId, therapistUserId }).returning({ id: conversations.id });
    const convId = conv!.id;
    let sec = 0;
    const ins = (sender: string, type: string, content: string) =>
      db.insert(messages).values({ conversationId: convId, senderUserId: sender, type, contentOriginal: content, sentAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ++sec)) });
    await ins(customerId, 'text', '在吗');
    await ins(therapistUserId, 'text', '在呀');
    await ins(therapistUserId, 'order_offer', JSON.stringify({ therapistId: 'x', tiers: [] })); // 卡片 JSON 不该被当客户情绪
    await ins(customerId, 'text', '今天好累，压力好大，想找人说说话');

    const sensed = await senseRecentContext(db, convId, customerId);
    expect(sensed.mood).toBe('vulnerable');
  });
});

describe('buildSystemPrompt · mood 注入', () => {
  const base = {
    therapistDisplayName: '小雨',
    personality: {},
    locale: 'zh',
    profileBlock: '',
    memoryBlock: '',
    factsBlock: '',
  };
  it('vulnerable → 注入"只共情、只陪着"高优先指令', () => {
    const p = buildSystemPrompt({ ...base, mood: 'vulnerable' });
    expect(p).toMatch(/只共情、只陪着/);
    expect(p).toMatch(/绝不提钱/);
  });
  it('guarded → 注入"别硬聊别推销"', () => {
    const p = buildSystemPrompt({ ...base, mood: 'guarded' });
    expect(p).toMatch(/别硬聊别推销别要东西/);
  });
  it('neutral / 缺省 → 不注入 mood 块', () => {
    expect(buildSystemPrompt({ ...base, mood: 'neutral' })).not.toMatch(/只共情、只陪着/);
    expect(buildSystemPrompt(base)).not.toMatch(/只共情、只陪着/);
  });
});
