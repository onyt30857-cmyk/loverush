/**
 * E2E · 到店服务门店信息投递(2026-06-05)
 *
 * 验证:技师确认(LOCKED)后客户才拿到 shopInfo(地址+须知+仅过审指引媒体)+ 私聊收到 shop_info 卡;
 *       确认前 / outcall 技师 → 无 shopInfo。需 loverush_test 库(已跑 0036 迁移)。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { therapists, users, pointsAccount, mediaAssets, messages, conversations } from '@loverush/db';
import { createOrder, submitOrder, confirmAndLock, getOrderDetail } from '../src/services/orders';
import { getDb, truncateAll } from './helpers';

async function mkUser(name: string, type: 'customer' | 'therapist'): Promise<string> {
  const db = await getDb();
  const [u] = await db.insert(users).values({ userType: type, status: 'active', displayName: name, bip39PubkeyHash: `h-${name}-${Math.random().toString(36).slice(2)}` }).returning();
  return u!.id;
}
async function mkMedia(ownerId: string, audit: 'approved' | 'pending'): Promise<string> {
  const db = await getDb();
  const [m] = await db.insert(mediaAssets).values({
    ownerUserId: ownerId, type: 'photo', r2Key: `k-${Math.random().toString(36).slice(2)}`,
    publicUrl: `https://cdn.test/${audit}.jpg`, purpose: 'shop_guide', auditStatus: audit,
  } as never).returning();
  return m!.id;
}
async function mkTherapist(name: string, mode: 'incall' | 'outcall', guide: Array<{ mediaId: string; kind: 'image' }>): Promise<{ userId: string; therapistId: string }> {
  const db = await getDb();
  const userId = await mkUser(name, 'therapist');
  const [t] = await db.insert(therapists).values({
    userId, displayName: name, verificationStatus: 'passed', onlineStatus: 'online',
    serviceMode: mode,
    serviceAddressFullEncrypted: mode === 'incall' ? '曼谷 Asok Sukhumvit 23 巷 5 号 B 栋 8 楼' : null,
    shopArrivalNote: mode === 'incall' ? '到楼下按 0808 门铃,说预约的' : null,
    shopGuideMedia: guide,
    scoreAppearance: 900, scoreBody: 900, scoreService: 900,
    basePriceJson: [{ duration: 60, pricePoints: 200 }],
  } as never).returning();
  return { userId, therapistId: t!.id };
}
async function setBalance(userId: string, balance: number) {
  const db = await getDb();
  await db.insert(pointsAccount).values({ userId, balance, frozen: 0 }).onConflictDoUpdate({ target: pointsAccount.userId, set: { balance, frozen: 0 } });
}
async function placeAndSubmit(customerId: string, therapistId: string): Promise<string> {
  const o = await createOrder({ db: await getDb() }, {
    customerId, therapistId,
    serviceSnapshot: { skills: ['泰式'], durationMin: 60, pricePoints: 200 },
  });
  await submitOrder({ db: await getDb() }, o.id, customerId);
  return o.id;
}
async function shopInfoMsgCount(customerId: string, therapistUserId: string): Promise<number> {
  const db = await getDb();
  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.customerId, customerId), eq(conversations.therapistUserId, therapistUserId)),
  });
  if (!conv) return 0;
  const rows = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.conversationId, conv.id), eq(messages.type, 'shop_info')));
  return rows.length;
}

describe('E2E · 到店门店信息投递', () => {
  let customerId: string;
  let incall: { userId: string; therapistId: string };
  let outcall: { userId: string; therapistId: string };
  let approvedMedia: string;

  beforeAll(async () => {
    await truncateAll();
    customerId = await mkUser('Cust', 'customer');
    await setBalance(customerId, 5000);
    const tmpOwner = await mkUser('TmpOwner', 'therapist'); // 临时拿来挂 media owner(下面真技师另建)
    // 真技师 + 其名下媒体(approved + pending)
    incall = await mkTherapist('BkkShop', 'incall', []);
    approvedMedia = await mkMedia(incall.userId, 'approved');
    const pendingMedia = await mkMedia(incall.userId, 'pending');
    const db = await getDb();
    await db.update(therapists).set({ shopGuideMedia: [{ mediaId: approvedMedia, kind: 'image' }, { mediaId: pendingMedia, kind: 'image' }] as never }).where(eq(therapists.id, incall.therapistId));
    outcall = await mkTherapist('HomeServe', 'outcall', []);
    void tmpOwner;
  }, 30_000);

  it('提交后(PENDING_CONFIRM)→ 无 shopInfo(地址绝不提前下发)', async () => {
    const orderId = await placeAndSubmit(customerId, incall.therapistId);
    const d = await getOrderDetail({ db: await getDb() }, orderId);
    expect(d).not.toBeNull();
    expect((d as { shopInfo?: unknown }).shopInfo == null).toBe(true);
  });

  it('技师确认(LOCKED)→ shopInfo 出现:地址+须知+仅过审指引媒体;私聊收到 shop_info 卡', async () => {
    const orderId = await placeAndSubmit(customerId, incall.therapistId);
    await confirmAndLock({ db: await getDb() }, orderId, incall.userId);
    const d = await getOrderDetail({ db: await getDb() }, orderId) as { shopInfo?: { address: string | null; arrivalNote: string | null; guideMedia: Array<{ url: string }> } };
    expect(d.shopInfo).toBeTruthy();
    expect(d.shopInfo!.address).toContain('Asok');
    expect(d.shopInfo!.arrivalNote).toContain('门铃');
    expect(d.shopInfo!.guideMedia.length).toBe(1); // pending 被剔除
    expect(d.shopInfo!.guideMedia[0]!.url).toContain('approved');
    // 私聊自动推了一张 shop_info 卡
    expect(await shopInfoMsgCount(customerId, incall.userId)).toBeGreaterThanOrEqual(1);
  });

  it('outcall 技师 → 即便 LOCKED 也无 shopInfo(上门没门店)', async () => {
    // 上门单必填客户地址(上门功能要求),这里补上;本测试只验"上门→无门店 shopInfo"
    const o = await createOrder({ db: await getDb() }, {
      customerId, therapistId: outcall.therapistId,
      serviceSnapshot: { skills: ['泰式'], durationMin: 60, pricePoints: 200 },
      customerAddress: '曼谷某公寓 10 楼',
    });
    await submitOrder({ db: await getDb() }, o.id, customerId);
    const orderId = o.id;
    await confirmAndLock({ db: await getDb() }, orderId, outcall.userId);
    const d = await getOrderDetail({ db: await getDb() }, orderId) as { shopInfo?: unknown };
    expect(d.shopInfo == null).toBe(true);
    expect(await shopInfoMsgCount(customerId, outcall.userId)).toBe(0);
  });
});
