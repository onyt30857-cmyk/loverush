/**
 * 单元测试 · M06 会话摘要记忆(治 gaslight 根)(2026-06-06)
 *
 * 把滑出 8 条窗口的对话滚动压成"承诺+关键信息"存进 interactionMemory,下次注入 prompt。
 * mock db + mock gateway,不调真 LLM、确定性验证:增量门控 / 脏防护 / 注入格式。
 */
import { describe, it, expect, vi } from 'vitest';
import { updateConversationSummary, formatRelationshipMemory } from '../src/services/ai_alter';

const TH_UID = 'th-user-1'; // 技师 users.id(判 messages 发送方)
const TH_ID = 'th-profile-1'; // 技师 therapists.id(关系表主键)
const CU = 'cust-1';

function textRow(senderUserId: string, content: string, i: number) {
  return { type: 'text', senderUserId, contentOriginal: content, sentAt: new Date(2026, 5, 6, 0, i) };
}

// 造 n 条自然语言对话(客户/分身交替)
function dialogue(n: number) {
  return Array.from({ length: n }, (_, i) =>
    textRow(i % 2 === 0 ? CU : TH_UID, `第${i + 1}句`, i),
  );
}

function mockCtx(rows: unknown[], onWrite?: (set: Record<string, unknown>) => void) {
  return {
    db: {
      query: { messages: { findMany: async () => rows } },
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
            onWrite?.(set);
            return Promise.resolve();
          },
        }),
      }),
    },
  } as never;
}

function mockGw(content: string) {
  const complete = vi.fn(async () => ({
    content,
    provider: 'mock',
    model: 'mock',
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
  }));
  return { gw: () => ({ complete } as never), complete };
}

function rel(interactionMemory: Record<string, unknown> | null) {
  return { tier: 'L0', totalOrders: 0, interactionMemory } as never;
}

describe('updateConversationSummary · 增量门控', () => {
  it('没攒够一个窗口(<8 新条)→ 不调 LLM、不写库', async () => {
    const { gw, complete } = mockGw('我答应他今晚9点');
    let wrote = false;
    await updateConversationSummary(
      mockCtx(dialogue(6), () => { wrote = true; }),
      { conversationId: 'c1', customerId: CU, therapistId: TH_ID, therapistUserId: TH_UID, relationship: rel({ lastTurn: 0 }) },
      gw,
    );
    expect(complete).not.toHaveBeenCalled();
    expect(wrote).toBe(false);
  });

  it('攒够一个窗口(≥8 新条)→ 调一次 LLM + 写回 lastTurn=turnCount', async () => {
    const { gw, complete } = mockGw('我答应他今晚9点过去，他叫小明、在意颜值');
    let captured: Record<string, unknown> | undefined;
    await updateConversationSummary(
      mockCtx(dialogue(10), (set) => { captured = set; }),
      { conversationId: 'c1', customerId: CU, therapistId: TH_ID, therapistUserId: TH_UID, relationship: rel({ lastTurn: 0 }) },
      gw,
    );
    expect(complete).toHaveBeenCalledTimes(1);
    const mem = captured?.interactionMemory as { summary: string; lastTurn: number };
    expect(mem.summary).toContain('今晚9点');
    expect(mem.lastTurn).toBe(10);
  });

  it('旧摘要已覆盖到 lastTurn,新增不足 8 → 仍跳过', async () => {
    const { gw, complete } = mockGw('x');
    await updateConversationSummary(
      mockCtx(dialogue(12)),
      { conversationId: 'c1', customerId: CU, therapistId: TH_ID, therapistUserId: TH_UID, relationship: rel({ summary: '旧', lastTurn: 10 }) },
      gw,
    );
    expect(complete).not.toHaveBeenCalled(); // 12-10=2 <8
  });
});

describe('updateConversationSummary · 脏防护', () => {
  it('LLM 返空 / "---" → 不覆盖旧摘要(不写库)', async () => {
    for (const dirty of ['', '   ', '---', '。。。']) {
      const { gw } = mockGw(dirty);
      let wrote = false;
      await updateConversationSummary(
        mockCtx(dialogue(10), () => { wrote = true; }),
        { conversationId: 'c1', customerId: CU, therapistId: TH_ID, therapistUserId: TH_UID, relationship: rel({ summary: '旧摘要', lastTurn: 0 }) },
        gw,
      );
      expect(wrote, `dirty=${JSON.stringify(dirty)}`).toBe(false);
    }
  });
});

describe('formatRelationshipMemory · 摘要注入', () => {
  it('有 summary → prompt 含"你还记得"', () => {
    const out = formatRelationshipMemory(rel({ summary: '我答应他今晚9点过去' }));
    expect(out).toContain('你还记得');
    expect(out).toContain('今晚9点');
  });
  it('无 summary → 不输出该行', () => {
    const out = formatRelationshipMemory(rel({}));
    expect(out).not.toContain('你还记得');
  });
});
