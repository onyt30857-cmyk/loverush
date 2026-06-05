/**
 * E2E · 上门服务客户地址投递给技师(2026-06-05 · 到店的镜像)
 *
 * 验证:确认前技师只见区域+距离(无门牌)/ 客户自看完整 / 技师确认(LOCKED)后见完整+找路+私聊卡 /
 *       incall 无 customerLocation / 超服务范围下单被拦 / 缺地址被拦。需 loverush_test(已跑 0037)。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { cities, therapists, users, pointsAccount, mediaAssets, messages, conversations } from '@loverush/db';
import { createOrder, submitOrder, confirmAndLock, getOrderDetail } from '../src/services/orders';
import { getDb, truncateAll } from './helpers';

const BKK = { lat: '13.7563', lng: '100.5018' };       // 曼谷(技师服务城市中心 + 客户在此 → 距离~0)
const CHIANGMAI = { lat: '18.7883', lng: '98.9853' };  // 清迈(距曼谷~580km → 超 30km 范围)

let customerId: string;
let bangkokId: string;
let outcall: { userId: string; therapistId: string };
let incall: { userId: string; therapistId: string };
let approvedMedia: string;
let pendingMedia: string;

async function mkUser(name: string, type: 'customer' | 'therapist'): Promise<string> {
  const db = await getDb();
  const [u] = await db.insert(users).values({ userType: type, status: 'active', displayName: name, bip39PubkeyHash: `h-${name}-${Math.random().toString(36).slice(2)}` }).returning();
  return u!.id;
}
async function mkMedia(ownerId: string, audit: 'approved' | 'pending'): Promise<string> {
  const db = await getDb();
  const [m] = await db.insert(mediaAssets).values({
    ownerUserId: ownerId, type: 'photo', r2Key: `k-${Math.random().toString(36).slice(2)}`,
    publicUrl: `https://cdn.test/${audit}-${Math.random().toString(36).slice(2)}.jpg`, purpose: 'customer_location_guide', auditStatus: audit,
  } as never).returning();
  return m!.id;
}
async function mkTherapist(name: string, mode: 'outcall' | 'incall'): Promise<{ userId: string; therapistId: string }> {
  const db = await getDb();
  const userId = await mkUser(name, 'therapist');
  const [t] = await db.insert(therapists).values({
    userId, displayName: name, verificationStatus: 'passed', onlineStatus: 'online',
    serviceMode: mode, serviceCityId: bangkokId,
    scoreAppearance: 900, scoreBody: 900, scoreService: 900,
    basePriceJson: [{ duration: 60, pricePoints: 200 }],
  } as never).returning();
  return { userId, therapistId: t!.id };
}
async function locCardCount(custId: string, therUserId: string): Promise<number> {
  const db = await getDb();
  const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.customerId, custId), eq(conversations.therapistUserId, therUserId)) });
  if (!conv) return 0;
  const rows = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.conversationId, conv.id), eq(messages.type, 'customer_location')));
  return rows.length;
}
const snap = { skills: ['泰式'], durationMin: 60, pricePoints: 200 };

describe('E2E · 上门客户地址投递', () => {
  beforeAll(async () => {
    await truncateAll();
    const db = await getDb();
    const [c] = await db.insert(cities).values({ code: 'bangkok', countryCode: 'TH', translations: { en: 'Bangkok' }, latCenter: BKK.lat, lngCenter: BKK.lng })
      .onConflictDoUpdate({ target: cities.code, set: { latCenter: BKK.lat, lngCenter: BKK.lng } }).returning();
    bangkokId = c!.id;
    customerId = await mkUser('Cust', 'customer');
    await db.insert(pointsAccount).values({ userId: customerId, balance: 5000, frozen: 0 }).onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: 5000, frozen: 0 } });
    outcall = await mkTherapist('OutcallT', 'outcall');
    incall = await mkTherapist('IncallT', 'incall');
    approvedMedia = await mkMedia(customerId, 'approved');
    pendingMedia = await mkMedia(customerId, 'pending');
  }, 30_000);

  async function placeOutcall(): Promise<string> {
    const o = await createOrder({ db: await getDb() }, {
      customerId, therapistId: outcall.therapistId, serviceSnapshot: snap,
      customerAddress: '曼谷 Sukhumvit 23 巷 · Asok 公寓 18 楼 1803',
      customerAddressNote: '门禁码 1803#,到楼下打电话',
      customerAddressMedia: [{ mediaId: approvedMedia, kind: 'image' }, { mediaId: pendingMedia, kind: 'image' }],
      customerLat: BKK.lat, customerLng: BKK.lng, customerAreaName: 'Asok',
    });
    await submitOrder({ db: await getDb() }, o.id, customerId);
    return o.id;
  }

  it('缺上门地址 → createOrder 拦(outcall 必填)', async () => {
    await expect(createOrder({ db: await getDb() }, { customerId, therapistId: outcall.therapistId, serviceSnapshot: snap })).rejects.toThrow();
  });

  it('超服务范围(清迈,>30km)→ createOrder 拦', async () => {
    await expect(createOrder({ db: await getDb() }, {
      customerId, therapistId: outcall.therapistId, serviceSnapshot: snap,
      customerAddress: '清迈古城某某路', customerLat: CHIANGMAI.lat, customerLng: CHIANGMAI.lng,
    })).rejects.toThrow();
  });

  it('确认前 · 技师只见大致区域+距离,无门牌', async () => {
    const orderId = await placeOutcall();
    const d = await getOrderDetail({ db: await getDb() }, orderId, outcall.userId) as { customerLocation?: { full: boolean; address: string | null; areaName: string | null; distanceKm: number | null; media: unknown[] } };
    expect(d.customerLocation).toBeTruthy();
    expect(d.customerLocation!.full).toBe(false);
    expect(d.customerLocation!.address).toBeNull();
    expect(d.customerLocation!.areaName).toBe('Asok');
    expect(typeof d.customerLocation!.distanceKm).toBe('number');
    expect(d.customerLocation!.media.length).toBe(0);
  });

  it('客户自看 · 完整地址可见(自己填的)', async () => {
    const orderId = await placeOutcall();
    const d = await getOrderDetail({ db: await getDb() }, orderId, customerId) as { customerLocation?: { full: boolean; address: string | null } };
    expect(d.customerLocation!.full).toBe(true);
    expect(d.customerLocation!.address).toContain('Asok');
  });

  it('技师确认(LOCKED)→ 技师见完整地址+找路+仅过审楼栋照;技师私聊收到 customer_location 卡', async () => {
    const orderId = await placeOutcall();
    await confirmAndLock({ db: await getDb() }, orderId, outcall.userId);
    const d = await getOrderDetail({ db: await getDb() }, orderId, outcall.userId) as { customerLocation?: { full: boolean; address: string | null; note: string | null; media: unknown[] } };
    expect(d.customerLocation!.full).toBe(true);
    expect(d.customerLocation!.address).toContain('Asok');
    expect(d.customerLocation!.note).toContain('门禁');
    expect(d.customerLocation!.media.length).toBe(1); // pending 剔除
    expect(await locCardCount(customerId, outcall.userId)).toBeGreaterThanOrEqual(1);
  });

  it('incall 技师订单 → 无 customerLocation(到店不需要客户地址)', async () => {
    const o = await createOrder({ db: await getDb() }, { customerId, therapistId: incall.therapistId, serviceSnapshot: snap });
    await submitOrder({ db: await getDb() }, o.id, customerId);
    await confirmAndLock({ db: await getDb() }, o.id, incall.userId);
    const d = await getOrderDetail({ db: await getDb() }, o.id, incall.userId) as { customerLocation?: unknown };
    expect(d.customerLocation == null).toBe(true);
  });
});
