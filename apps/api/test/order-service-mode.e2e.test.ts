/**
 * E2E · both 技师按单选服务方式(2026-06-05 · 修 both 技师双向交换地址缺陷)
 *
 * 验证:both 技师每单只走一个方向 —— 本单=到店 → 客户拿店址、不要客户地址;
 *       本单=上门 → 技师拿客户址、不发店址。门控以【订单 serviceMode】为准。需 loverush_test(已跑 0038)。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { cities, therapists, users, pointsAccount } from '@loverush/db';
import { createOrder, submitOrder, confirmAndLock, getOrderDetail } from '../src/services/orders';
import { getDb, truncateAll } from './helpers';

const BKK = { lat: '13.7563', lng: '100.5018' };
let customerId: string;
let both: { userId: string; therapistId: string };
const snap = { skills: ['泰式'], durationMin: 60, pricePoints: 200 };

async function mkUser(name: string, type: 'customer' | 'therapist'): Promise<string> {
  const db = await getDb();
  const [u] = await db.insert(users).values({ userType: type, status: 'active', displayName: name, bip39PubkeyHash: `h-${name}-${Math.random().toString(36).slice(2)}` }).returning();
  return u!.id;
}

describe('E2E · both 技师按单选模式', () => {
  beforeAll(async () => {
    await truncateAll();
    const db = await getDb();
    const [c] = await db.insert(cities).values({ code: 'bangkok', countryCode: 'TH', translations: { en: 'Bangkok' }, latCenter: BKK.lat, lngCenter: BKK.lng })
      .onConflictDoUpdate({ target: cities.code, set: { latCenter: BKK.lat, lngCenter: BKK.lng } }).returning();
    customerId = await mkUser('Cust', 'customer');
    await db.insert(pointsAccount).values({ userId: customerId, balance: 5000, frozen: 0 }).onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: 5000, frozen: 0 } });
    const tUser = await mkUser('BothT', 'therapist');
    const [t] = await db.insert(therapists).values({
      userId: tUser, displayName: 'BothT', verificationStatus: 'passed', onlineStatus: 'online',
      serviceMode: 'both', serviceCityId: c!.id,
      serviceAddressFullEncrypted: '曼谷 Asok 店址 5 楼', shopArrivalNote: '按门铃说预约的',
      scoreAppearance: 900, scoreBody: 900, scoreService: 900,
      basePriceJson: [{ duration: 60, pricePoints: 200 }],
    } as never).returning();
    both = { userId: tUser, therapistId: t!.id };
  }, 30_000);

  it('本单=到店:不要客户地址 · 确认后客户拿到店址 · 无 customerLocation', async () => {
    const o = await createOrder({ db: await getDb() }, { customerId, therapistId: both.therapistId, serviceSnapshot: snap, serviceMode: 'incall' });
    await submitOrder({ db: await getDb() }, o.id, customerId);
    await confirmAndLock({ db: await getDb() }, o.id, both.userId);
    const d = await getOrderDetail({ db: await getDb() }, o.id, customerId) as { shopInfo?: { address: string | null } | null; customerLocation?: unknown };
    expect(d.shopInfo).toBeTruthy();
    expect(d.shopInfo!.address).toContain('Asok');
    expect(d.customerLocation == null).toBe(true); // 到店单不交换客户地址
  });

  it('本单=上门:确认后技师拿客户址 · 无 shopInfo', async () => {
    const o = await createOrder({ db: await getDb() }, {
      customerId, therapistId: both.therapistId, serviceSnapshot: snap, serviceMode: 'outcall',
      customerAddress: '曼谷 Thonglor 公寓 12 楼', customerLat: BKK.lat, customerLng: BKK.lng, customerAreaName: 'Thonglor',
    });
    await submitOrder({ db: await getDb() }, o.id, customerId);
    await confirmAndLock({ db: await getDb() }, o.id, both.userId);
    const dT = await getOrderDetail({ db: await getDb() }, o.id, both.userId) as { shopInfo?: unknown; customerLocation?: { full: boolean; address: string | null } };
    expect(dT.customerLocation!.full).toBe(true);
    expect(dT.customerLocation!.address).toContain('Thonglor');
    expect(dT.shopInfo == null).toBe(true); // 上门单不给客户发店址
  });

  it('本单=到店但客户误传了地址 → 仍按到店走(不要地址 · 发店址)', async () => {
    const o = await createOrder({ db: await getDb() }, {
      customerId, therapistId: both.therapistId, serviceSnapshot: snap, serviceMode: 'incall',
      customerAddress: '不该被采用的地址',
    });
    await submitOrder({ db: await getDb() }, o.id, customerId);
    await confirmAndLock({ db: await getDb() }, o.id, both.userId);
    const d = await getOrderDetail({ db: await getDb() }, o.id, customerId) as { shopInfo?: unknown; customerLocation?: unknown };
    expect(d.shopInfo).toBeTruthy();
    expect(d.customerLocation == null).toBe(true);
  });
});
