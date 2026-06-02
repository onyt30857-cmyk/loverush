/**
 * 单元测试 · M17 Telegram 服务（不需 PG / 不调 TG API）
 *  - verifyInitData：HMAC-SHA256 验签 有效/篡改/过期/无 hash
 *  - therapistToInlinePhoto：字段映射 / 无头像返 null / deeplink 按钮
 */
import { describe, it, expect } from 'vitest';
import { verifyInitData, therapistToInlinePhoto } from '../src/services/telegram';

const TEST_TOKEN = '123456:TEST_BOT_TOKEN_abcdefghijklmnop';

/** 用与服务端相同算法生成一条合法 initData（供测试） */
async function signInitData(token: string, fields: Record<string, string>): Promise<string> {
  const enc = new TextEncoder();
  const dcs = Object.entries(fields)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const kWeb = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', kWeb, enc.encode(token));
  const kSecret = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', kSecret, enc.encode(dcs));
  const hash = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

describe('verifyInitData', () => {
  const now = 1_900_000_000_000; // 固定时间，确定性
  const authDate = String(Math.floor(now / 1000));
  const user = JSON.stringify({ id: 777, username: 'alice', first_name: 'Alice' });

  it('合法签名通过并解析出 user', async () => {
    const initData = await signInitData(TEST_TOKEN, { auth_date: authDate, query_id: 'q1', user });
    const r = await verifyInitData(initData, TEST_TOKEN, 86400, now);
    expect(r.ok).toBe(true);
    expect(r.user?.id).toBe(777);
    expect(r.user?.username).toBe('alice');
  });

  it('篡改任一字段 → 验签失败', async () => {
    const initData = await signInitData(TEST_TOKEN, { auth_date: authDate, query_id: 'q1', user });
    const tampered = initData.replace('query_id=q1', 'query_id=hacked');
    const r = await verifyInitData(tampered, TEST_TOKEN, 86400, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_hash');
  });

  it('换错 token → 验签失败', async () => {
    const initData = await signInitData(TEST_TOKEN, { auth_date: authDate, user });
    const r = await verifyInitData(initData, 'wrong:token', 86400, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_hash');
  });

  it('auth_date 过期 → expired', async () => {
    const oldDate = String(Math.floor(now / 1000) - 90000); // 超过 24h
    const initData = await signInitData(TEST_TOKEN, { auth_date: oldDate, user });
    const r = await verifyInitData(initData, TEST_TOKEN, 86400, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('expired');
  });

  it('缺 hash → no_hash', async () => {
    const r = await verifyInitData('auth_date=' + authDate + '&user=' + encodeURIComponent(user), TEST_TOKEN, 86400, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_hash');
  });
});

describe('therapistToInlinePhoto', () => {
  const base = {
    id: 'abc-123',
    displayName: '小柔',
    avatarUrl: 'https://cdn.example.com/a.jpg',
    serviceCity: '上海',
    tags: ['泰式按摩'],
    basePriceJson: [{ duration: 60, pricePoints: 388 }],
    scoreAppearance: 290,
    scoreBody: 290,
    scoreService: 290,
  };

  it('映射出 photo 卡 + 城市/项目/价格/评分描述', () => {
    const r = therapistToInlinePhoto(base, { botUsername: 'loverush_bot' });
    expect(r).not.toBeNull();
    expect(r!.type).toBe('photo');
    expect(r!.id).toBe('abc-123');
    expect(r!.photo_url).toBe('https://cdn.example.com/a.jpg');
    expect(String(r!.description)).toContain('上海');
    expect(String(r!.description)).toContain('泰式按摩');
    expect(String(r!.description)).toContain('388');
  });

  it('botUsername → deeplink 按钮含 start=t_<id>', () => {
    const r = therapistToInlinePhoto(base, { botUsername: 'loverush_bot' });
    const markup = r!.reply_markup as { inline_keyboard: Array<Array<{ url?: string }>> };
    expect(markup.inline_keyboard[0]?.[0]?.url).toBe('https://t.me/loverush_bot?start=t_abc-123');
  });

  it('无头像 → 返回 null（inline photo 必须有图）', () => {
    const r = therapistToInlinePhoto({ ...base, avatarUrl: null }, { botUsername: 'loverush_bot' });
    expect(r).toBeNull();
  });
});
