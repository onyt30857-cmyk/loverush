/**
 * 单元测试 · PATCH /me/locale zod 校验
 *
 * 测的是 LocaleBody schema 的 input 合法性
 * 不调真 db · 只验证 z.enum(...) 行为
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// 与 routes/me.ts 同步 · 改这里就要同步那边
const LocaleBody = z.object({
  locale: z.enum(['zh', 'en', 'th', 'vi', 'ms', 'id']),
});

describe('Unit · /me/locale · 合法 locale', () => {
  const cases = ['zh', 'en', 'th', 'vi', 'ms', 'id'];
  for (const c of cases) {
    it(`accepts "${c}"`, () => {
      const r = LocaleBody.safeParse({ locale: c });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.locale).toBe(c);
    });
  }
});

describe('Unit · /me/locale · 非法 locale', () => {
  it('rejects "jp"(不在白名单)', () => {
    const r = LocaleBody.safeParse({ locale: 'jp' });
    expect(r.success).toBe(false);
  });

  it('rejects "ZH"(大小写敏感)', () => {
    const r = LocaleBody.safeParse({ locale: 'ZH' });
    expect(r.success).toBe(false);
  });

  it('rejects 空字符串', () => {
    const r = LocaleBody.safeParse({ locale: '' });
    expect(r.success).toBe(false);
  });

  it('rejects 缺字段', () => {
    const r = LocaleBody.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects 非 string 类型', () => {
    const r = LocaleBody.safeParse({ locale: 123 });
    expect(r.success).toBe(false);
  });
});
