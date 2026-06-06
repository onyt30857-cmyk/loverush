/**
 * 单元测试 · M03 文字链记忆回库 R1(2026-06-06)
 *
 * 根因:文字链 chat() 只用前端传来的 history，刷新/换设备清空 → 失忆(语音链有 loadHistory，文字链此前从不回库)。
 * 修:history 为空时从 assistant_chat_log 重建最近 N 轮。本测试 mock db 确定性验证(不调真 LLM)。
 */
import { describe, it, expect } from 'vitest';
import { loadRecentHistory } from '../src/services/assistant/chat';

function mockCtx(rows: Array<Record<string, unknown>>) {
  return {
    db: { query: { assistantChatLog: { findMany: async () => rows } } },
  } as never;
}

describe('M03 loadRecentHistory · R1 回库重载', () => {
  it('日志按 desc 取回 → 翻正序拼成 user/assistant 交替', async () => {
    // findMany 返回 desc(最新在前)
    const rows = [
      { userInput: '第二轮问', finalContent: '第二轮答' },
      { userInput: '第一轮问', finalContent: '第一轮答' },
    ];
    const turns = await loadRecentHistory(mockCtx(rows), 'u1', null, 5);
    expect(turns).toEqual([
      { role: 'user', content: '第一轮问' },
      { role: 'assistant', content: '第一轮答' },
      { role: 'user', content: '第二轮问' },
      { role: 'assistant', content: '第二轮答' },
    ]);
  });

  it('空日志 → 返回空数组(不报错)', async () => {
    const turns = await loadRecentHistory(mockCtx([]), 'u1', null, 5);
    expect(turns).toEqual([]);
  });
});
