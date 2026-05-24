/**
 * 单元测试 · redline.ts 规则层（不调 LLM 的部分）
 *
 * 这里直接测 `checkAndAct`：
 *  - LLM fake_memory 不会触发（没传 historyText）
 *  - 其他 4 类规则全靠正则
 *
 * 注意：本测试不需要 PG / LLM 配置，但仍走 ctx.db.insert(aiAlterRedlineLogs)。
 * 为此用 mock db 注入。
 */

import { describe, it, expect } from 'vitest';
import { checkAndAct } from '../src/services/redline';

// 极简 mock：db.insert(...).values(...) 链式调用都 noop
// 注意：不能用 Proxy(returns chain) — Proxy 会拦截 `then` 让 chain 看起来是 thenable，
// 导致 `await chain` 调用 then(resolve, reject) 时 resolve 没被调用 → 永远挂起。
function mockCtx() {
  const noop = () => Promise.resolve(undefined);
  const chain = {
    values: noop,
    returning: noop,
    onConflictDoNothing: noop,
    onConflictDoUpdate: noop,
  };
  return { db: { insert: () => chain } } as unknown as Parameters<typeof checkAndAct>[0];
}

const therapistUserId = '00000000-0000-0000-0000-000000000001';

describe('Unit · redline 规则检测', () => {
  it('正常聊天 → pass', async () => {
    const r = await checkAndAct(mockCtx(), {
      text: '今晚 8 点见，我会准时到',
      therapistUserId,
    });
    expect(r.action).toBe('pass');
    expect(r.flags).toEqual([]);
  });

  it('诱导加微信 → rewrite', async () => {
    const r = await checkAndAct(mockCtx(), {
      text: '私下加我微信 xxx 更方便联系',
      therapistUserId,
    });
    expect(r.flags).toContain('contact_off_platform');
    expect(r.action).toBe('rewrite');
  });

  it('诱导加 Telegram → rewrite', async () => {
    const r = await checkAndAct(mockCtx(), {
      text: '我们直接 telegram 上聊吧',
      therapistUserId,
    });
    expect(r.flags).toContain('contact_off_platform');
  });

  it('线下转账 → rewrite', async () => {
    const r = await checkAndAct(mockCtx(), {
      text: '微信红包给我，省手续费',
      therapistUserId,
    });
    expect(r.flags).toContain('payment_off_platform');
    expect(r.action).toBe('rewrite');
  });

  it('USDT 线下结算 → rewrite', async () => {
    const r = await checkAndAct(mockCtx(), {
      text: '可以直接转 USDT 给我个人账户',
      therapistUserId,
    });
    expect(r.flags).toContain('payment_off_platform');
  });

  it('涉未成年 → BLOCK（硬拒绝）', async () => {
    const r = await checkAndAct(mockCtx(), {
      text: '想要 18 岁的学生妹',
      therapistUserId,
    });
    expect(r.flags).toContain('minor');
    expect(r.action).toBe('block');
    expect(r.rewritten).toBeUndefined();
  });

  it('涉违法（毒品） → BLOCK', async () => {
    const r = await checkAndAct(mockCtx(), {
      text: '可以一起嗨大麻和摇头丸',
      therapistUserId,
    });
    expect(r.flags).toContain('illegal');
    expect(r.action).toBe('block');
  });

  it('多 flag 同时命中（联系方式 + 支付）', async () => {
    const r = await checkAndAct(mockCtx(), {
      text: '加我微信，直接微信红包转账',
      therapistUserId,
    });
    expect(r.flags).toContain('contact_off_platform');
    expect(r.flags).toContain('payment_off_platform');
    expect(r.action).toBe('rewrite');
  });

  it('硬 block + 软 flag 同时命中 → action 应为 block', async () => {
    const r = await checkAndAct(mockCtx(), {
      text: '想要 18 岁的学生妹，加我微信',
      therapistUserId,
    });
    expect(r.flags).toContain('minor');
    expect(r.flags).toContain('contact_off_platform');
    expect(r.action).toBe('block');
  });

  it('普通业务问候不误判', async () => {
    const r = await checkAndAct(mockCtx(), {
      text: '请问您今晚 9 点方便见面吗，60 分钟标准服务',
      therapistUserId,
    });
    expect(r.action).toBe('pass');
  });

  it('提到价格不误判', async () => {
    const r = await checkAndAct(mockCtx(), {
      text: '60 分钟 200 积分，超时按 50 积分/30 分钟加收',
      therapistUserId,
    });
    expect(r.action).toBe('pass');
  });
});
