/**
 * E2E · M-THome 技师工作台「平台价值指标」· 需 loverush_test
 *   DATABASE_URL=...loverush_test pnpm exec vitest run test/therapist-platform-dashboard.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { orders, therapists } from '@loverush/db';
import { therapistDashboard } from '../src/services/dashboard';
import { getDb, truncateAll, registerNew } from './helpers';

let T = '';
let TID = ''; // therapists.id(订单 therapist_id 必填)
let A = '';
let B = '';
let C = '';
let seq = 0;

async function mkOrder(over: {
  customerId: string;
  status: string;
  totalFiat?: string | null;
  currencyCode?: string | null;
  createdAt?: Date;
}) {
  const db = await getDb();
  seq += 1;
  await db.insert(orders).values({
    orderNo: `LRTEST${Date.now()}${seq}`,
    customerId: over.customerId,
    therapistUserId: T,
    therapistId: TID,
    status: over.status as (typeof orders.$inferInsert)['status'],
    pricePoints: 5000,
    serviceSnapshot: { skills: ['泰式按摩'], durationMin: 60, pricePoints: 5000 },
    totalFiat: over.totalFiat ?? null,
    currencyCode: over.currencyCode ?? null,
    ...(over.createdAt ? { createdAt: over.createdAt } : {}),
  });
}

describe('M-THome 平台价值指标', () => {
  beforeAll(async () => {
    await truncateAll();
    T = (await registerNew('therapist')).user.id;
    const db = await getDb();
    let trow = await db.query.therapists.findFirst({ where: eq(therapists.userId, T) });
    if (!trow) {
      [trow] = await db.insert(therapists).values({ userId: T }).returning();
    }
    TID = trow!.id;
    A = (await registerNew('customer')).user.id;
    B = (await registerNew('customer')).user.id;
    C = (await registerNew('customer')).user.id;
    const old = new Date(Date.now() - 40 * 86400000); // 40 天前(窗口外,用于回头客判定)
    // A:回头客(40天前有成交 + 今天有成交 ฿500)
    await mkOrder({ customerId: A, status: 'COMPLETED', totalFiat: '500', currencyCode: 'THB', createdAt: old });
    await mkOrder({ customerId: A, status: 'PAID', totalFiat: '500', currencyCode: 'THB' });
    // B:新客(今天首次成交 ฿300)
    await mkOrder({ customerId: B, status: 'COMPLETED', totalFiat: '300', currencyCode: 'THB' });
    // C:待确认单(不算成交/客户数,只进 pending)
    await mkOrder({ customerId: C, status: 'PENDING_CONFIRM', totalFiat: '400', currencyCode: 'THB' });
  });

  it('平台块:客户数/新客/回头客/GMV/待确认/今日 全部正确', async () => {
    const db = await getDb();
    const d = (await therapistDashboard({ db }, { therapistUserId: T })) as { platform: Record<string, unknown> };
    const pf = d.platform;
    expect(pf.unique_customers).toBe(2); // A + B(C 是待确认不算成交)
    expect(pf.new_customers).toBe(1); // B
    expect(pf.repeat_customers).toBe(1); // A(40天前有成交)
    expect(parseFloat(pf.gmv_fiat as string)).toBe(800); // 窗口内成交 500(A今天)+300(B);A的40天前那笔在窗口外不计
    expect(pf.gmv_currency).toBe('THB');
    expect(pf.pending_confirm_count).toBe(1); // C
    expect(pf.today_orders).toBe(2); // A今天 + B今天(成交态)
    expect(parseFloat(pf.today_gmv as string)).toBe(800);
  });

  it('新技师无任何订单 → 平台块全 0,不报错', async () => {
    const db = await getDb();
    const fresh = (await registerNew('therapist')).user.id;
    const d = (await therapistDashboard({ db }, { therapistUserId: fresh })) as { platform: Record<string, unknown> };
    expect(d.platform.unique_customers).toBe(0);
    expect(d.platform.gmv_fiat).toBe('0');
    expect(d.platform.pending_confirm_count).toBe(0);
    expect(d.platform.today_orders).toBe(0);
  });
});
