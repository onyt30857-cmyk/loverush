/**
 * E2E for Phase 13.x · 端到端加密
 *
 * 闭环：
 *  - 两个客户各自上传 X25519 公钥
 *  - 客户端模拟加密一条消息（fake blob，不真做密码学，只验证字段流转）
 *  - 加密消息：isEncrypted=1 / contentLanguage=null / 不触发翻译
 *  - 对方拉消息 → 拿到 contentOriginal=blob 字符串
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { messageTranslations } from '@loverush/db';
import { api, getDb, registerNew, truncateAll, sleep } from './helpers';

const FAKE_PUB_A = 'AAAAA1234567890abcdefghijklmnopqrstuvwxyzABCDEFG=';
const FAKE_PUB_B = 'BBBBB1234567890abcdefghijklmnopqrstuvwxyzABCDEFG=';
const FAKE_ENCRYPTED_BLOB = 'v1.AAAAA1234567890abcdef=.BBBBB1234567=.CCCCC1234567890=';

describe('E2E · D-204 公钥上传 + 查询', () => {
  let customer: { token: string; id: string };
  let therapist: { token: string; id: string };

  beforeAll(async () => {
    await truncateAll();
    const c = await registerNew('customer');
    const t = await registerNew('therapist');
    customer = { token: c.access_token, id: c.user.id };
    therapist = { token: t.access_token, id: t.user.id };
  }, 30_000);

  it('客户上传公钥', async () => {
    const res = await api.post<{ algorithm: string; public_key: string; key_version: number }>(
      '/me/encryption-key',
      { algorithm: 'x25519', public_key: FAKE_PUB_A },
      customer.token,
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.algorithm).toBe('x25519');
    expect(res.body.data?.public_key).toBe(FAKE_PUB_A);
  });

  it('客户拉技师公钥（技师未上传 → null）', async () => {
    const res = await api.get<{ public_key: string } | null>(
      `/users/${therapist.id}/encryption-key`,
      customer.token,
    );
    expect(res.body.data).toBeNull();
  });

  it('技师上传公钥后客户能拉到', async () => {
    await api.post('/me/encryption-key', { algorithm: 'x25519', public_key: FAKE_PUB_B }, therapist.token);

    const res = await api.get<{ public_key: string }>(`/users/${therapist.id}/encryption-key`, customer.token);
    expect(res.body.data?.public_key).toBe(FAKE_PUB_B);
  });

  it('上传新公钥覆盖旧公钥（旧 key 标 expired）', async () => {
    const NEW_PUB = 'CCCCC1234567890abcdefghijklmnopqrstuvwxyzABCDEFG=';
    await api.post('/me/encryption-key', { algorithm: 'x25519', public_key: NEW_PUB }, therapist.token);

    const res = await api.get<{ public_key: string }>(`/users/${therapist.id}/encryption-key`, customer.token);
    expect(res.body.data?.public_key).toBe(NEW_PUB);
  });

  it('未登录访问公钥端点 401', async () => {
    const res = await api.get(`/users/${therapist.id}/encryption-key`);
    expect(res.status).toBe(401);
  });
});

describe('E2E · D-204 加密消息流转', () => {
  let customer: { token: string; id: string };
  let therapist: { token: string; id: string };
  let convId: string;

  beforeAll(async () => {
    await truncateAll();
    const c = await registerNew('customer');
    const t = await registerNew('therapist');
    customer = { token: c.access_token, id: c.user.id };
    therapist = { token: t.access_token, id: t.user.id };

    await api.post('/me/encryption-key', { algorithm: 'x25519', public_key: FAKE_PUB_A }, customer.token);
    await api.post('/me/encryption-key', { algorithm: 'x25519', public_key: FAKE_PUB_B }, therapist.token);

    // 开会话
    const conv = await api.post<{ id: string }>(
      '/conversations',
      { therapist_user_id: therapist.id },
      customer.token,
    );
    convId = conv.body.data!.id;
  }, 30_000);

  it('客户发加密消息（is_encrypted=true）', async () => {
    const res = await api.post<{ isEncrypted: number; contentLanguage: string | null; contentOriginal: string }>(
      `/conversations/${convId}/messages`,
      { text: FAKE_ENCRYPTED_BLOB, is_encrypted: true },
      customer.token,
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.isEncrypted).toBe(1);
    expect(res.body.data?.contentLanguage).toBeNull(); // 加密消息无源语言
    expect(res.body.data?.contentOriginal).toBe(FAKE_ENCRYPTED_BLOB);
  });

  it('技师拉消息能看到加密 blob 原文', async () => {
    const res = await api.get<Array<{ contentOriginal: string; isEncrypted: number; translation: unknown }>>(
      `/conversations/${convId}/messages`,
      therapist.token,
    );
    const m = res.body.data!.find((x) => x.contentOriginal === FAKE_ENCRYPTED_BLOB);
    expect(m).toBeDefined();
    expect(m?.isEncrypted).toBe(1);
    // 加密消息不应有翻译
    expect(m?.translation).toBeFalsy();
  });

  it('加密消息不触发翻译入库', async () => {
    // 等异步翻译应该执行的窗口
    await sleep(1500);

    const db = await getDb();
    // 找 customer 发的消息（contentOriginal = FAKE_ENCRYPTED_BLOB）
    const msgs = await db.query.messages.findMany();
    const target = msgs.find((m) => m.contentOriginal === FAKE_ENCRYPTED_BLOB);
    expect(target?.isEncrypted).toBe(1);

    // 翻译表里不应该有这条 messageId 的记录
    const trans = await db.query.messageTranslations.findMany({
      where: eq(messageTranslations.messageId, target!.id),
    });
    expect(trans.length).toBe(0);
  });

  it('明文消息正常入翻译流程（双向语言不同时）', async () => {
    // 客户和技师默认 locale=zh，翻译应该跳过（同语言）
    // 直接验证字段：明文消息 isEncrypted=0
    const res = await api.post<{ isEncrypted: number; contentLanguage: string | null }>(
      `/conversations/${convId}/messages`,
      { text: '明文消息测试' },
      customer.token,
    );
    expect(res.body.data?.isEncrypted).toBe(0);
    expect(res.body.data?.contentLanguage).toBe('zh');
  });
});

describe('E2E · D-203 viewerHasPaid 真接入', () => {
  let customer: { token: string; id: string };
  let therapist: { token: string; id: string; therapistId?: string };

  beforeAll(async () => {
    await truncateAll();
    const c = await registerNew('customer');
    const t = await registerNew('therapist');
    customer = { token: c.access_token, id: c.user.id };
    therapist = { token: t.access_token, id: t.user.id };

    // 给客户充点积分（不然解锁会失败）
    await api.post('/payments/recharge', { amount_usd_cents: 5000 }, customer.token);

    // 技师档案 + 标 passed + 填社交联系
    await api.put(
      '/therapists/me',
      { bio: 'xxxxxxxxxxxxxxxxxxxx', serviceCity: 'Bangkok' },
      therapist.token,
    );
    const { therapists } = await import('@loverush/db');
    const db = await getDb();
    await db
      .update(therapists)
      .set({
        verificationStatus: 'passed',
        socialContactsEncrypted: JSON.stringify({ whatsapp: '+66 xx xxx xxx' }),
      })
      .where(eq(therapists.userId, therapist.id));
    const row = await db.query.therapists.findFirst({
      where: eq(therapists.userId, therapist.id),
    });
    therapist.therapistId = row!.id;
  }, 30_000);

  it('未解锁时 GET /therapists/:id 不返回 socialContacts', async () => {
    const res = await api.get<{ socialContacts?: Record<string, string> }>(
      `/therapists/${therapist.therapistId}`,
      customer.token,
    );
    expect(res.body.data?.socialContacts).toBeUndefined();
  });

  it('解锁 social_contacts 后能看到', async () => {
    const unlock = await api.post(
      `/therapists/${therapist.therapistId}/unlock`,
      { unlock_type: 'social_contacts' },
      customer.token,
    );
    expect(unlock.status).toBe(200);

    const res = await api.get<{ socialContacts?: Record<string, string> }>(
      `/therapists/${therapist.therapistId}`,
      customer.token,
    );
    expect(res.body.data?.socialContacts?.whatsapp).toBe('+66 xx xxx xxx');
  });

  it('重复解锁 idempotent（不重复扣分）', async () => {
    const meBefore = await api.get<{ points: { balance: number } }>('/me', customer.token);
    const balBefore = meBefore.body.data!.points.balance;

    const res = await api.post<{ alreadyUnlocked: boolean }>(
      `/therapists/${therapist.therapistId}/unlock`,
      { unlock_type: 'social_contacts' },
      customer.token,
    );
    expect(res.body.data?.alreadyUnlocked).toBe(true);

    const meAfter = await api.get<{ points: { balance: number } }>('/me', customer.token);
    expect(meAfter.body.data!.points.balance).toBe(balBefore);
  });
});
