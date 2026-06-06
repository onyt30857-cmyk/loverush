/**
 * E2E · 订单付款流程彻底根治(普通约单下单即落真实法币价)
 *
 * 治"技师端点'确认已线下收款'没反应":根因=普通约单建成积分模式(currency_code NULL),
 * 前端按估算法币显按钮、后端按订单行真实币种(NULL)硬拒。
 * 根治后:普通约单下单即落法币价 → 整条 LOCKED→PAID→COMPLETED 走得通;旧 NULL 单确认时自愈补价。
 *
 * 需 DATABASE_URL 指向 loverush_test。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { therapists, pointsAccount, orders, exchangeRates } from '@loverush/db';
import { api, getDb, truncateAll, registerNew } from './helpers';

const PRICE = 200; // 服务积分价
const CUR = 'THB';
const RATE = 3; // 1 THB = 3 积分 → 200 积分 = 66.66 THB

let customerToken: string;
let customerId: string;
let therapistToken: string;
let therapistUserId: string;
let therapistId: string;

async function setBalance(userId: string, balance: number) {
  const db = await getDb();
  await db
    .insert(pointsAccount)
    .values({ userId, balance, frozen: 0 })
    .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance, frozen: 0 } });
}
async function getOrderRow(orderId: string) {
  const db = await getDb();
  return db.query.orders.findFirst({ where: eq(orders.id, orderId) });
}

describe('E2E · 订单法币流程根治', () => {
  beforeAll(async () => {
    await truncateAll();
    const c = await registerNew('customer');
    customerToken = c.access_token;
    customerId = c.user.id;

    const t = await registerNew('therapist');
    therapistToken = t.access_token;
    therapistUserId = t.user.id;
    // basePriceJson 带 currencyCode → deriveDefaultCurrency 返回 THB
    await api.put(
      '/therapists/me',
      {
        bio: '专业按摩 8 年',
        serviceCity: 'Bangkok',
        skillsJson: [{ skill: '泰式', level: 5 }],
        basePriceJson: [{ duration: 60, pricePoints: PRICE, currencyCode: CUR }],
      },
      therapistToken,
    );
    const db = await getDb();
    // serviceMode=incall:createOrder 不要求上门地址(本测试聚焦付款流程,非地址)
    // basePriceJson 带 currencyCode + serviceCountry → deriveDefaultCurrency 稳取 THB(直接写库,绕开 PUT 整形)
    await db
      .update(therapists)
      .set({
        verificationStatus: 'passed',
        serviceMode: 'incall',
        serviceCountry: 'Thailand',
        basePriceJson: [{ duration: 60, pricePoints: PRICE, currencyCode: CUR }],
      })
      .where(eq(therapists.userId, therapistUserId));
    therapistId = (await db.query.therapists.findFirst({ where: eq(therapists.userId, therapistUserId) }))!.id;
    // seed THB 汇率(convertPointsToFiat 需要)
    await db.insert(exchangeRates).values({ currencyCode: CUR, pointsPerUnit: String(RATE) });
    await setBalance(customerId, 100_000);
  }, 30_000);

  async function createOrder(): Promise<string> {
    const res = await api.post<{ id: string; currencyCode: string | null; totalFiat: string | null }>(
      '/orders',
      { therapist_id: therapistId, service_snapshot: { skills: ['泰式'], durationMin: 60, pricePoints: PRICE } },
      customerToken,
    );
    expect(res.status).toBe(200);
    return res.body.data!.id;
  }

  it('根治:普通约单下单即落真实法币价(currency_code/total_fiat 非空)', async () => {
    const orderId = await createOrder();
    const o = await getOrderRow(orderId);
    expect(o?.currencyCode).toBe(CUR);
    expect(o?.totalFiat).not.toBeNull();
    expect(parseFloat(o!.totalFiat!)).toBeCloseTo(66.66, 1); // 200/3

    // 报价口径与下单一致
    const q = await api.post<{ currencyCode: string | null; totalFiat: number | null }>(
      '/orders/quote',
      { therapist_id: therapistId, service_snapshot: { skills: ['泰式'], durationMin: 60, pricePoints: PRICE } },
      customerToken,
    );
    expect(q.body.data?.currencyCode).toBe(CUR);
  });

  it('整条 happy path:submit→confirm(LOCKED)→确认线下收款(PAID)→start→complete(COMPLETED)', async () => {
    const orderId = await createOrder();
    expect((await api.post<{ status: string }>(`/orders/${orderId}/submit`, undefined, customerToken)).body.data?.status).toBe('PENDING_CONFIRM');
    expect((await api.post<{ status: string }>(`/orders/${orderId}/confirm`, undefined, therapistToken)).body.data?.status).toBe('LOCKED');

    // 关键:技师确认已线下收款 → PAID(之前这步对积分单 400 卡死)
    const paid = await api.post<{ status: string }>(`/orders/${orderId}/confirm-offline-paid`, undefined, therapistToken);
    expect(paid.status).toBe(200);
    expect(paid.body.data?.status).toBe('PAID');
    const o = await getOrderRow(orderId);
    expect(o?.offlinePaidAt).not.toBeNull();
    expect(o?.currencyCode).toBe(CUR);

    expect((await api.post<{ status: string }>(`/orders/${orderId}/start`, undefined, therapistToken)).body.data?.status).toBe('IN_SERVICE');
    expect((await api.post<{ status: string }>(`/orders/${orderId}/complete`, undefined, therapistToken)).body.data?.status).toBe('COMPLETED');
  });

  it('旧单自愈:currency_code=NULL 的 LOCKED 单,确认线下收款时自动补价 + 转 PAID', async () => {
    const db = await getDb();
    const [legacy] = await db
      .insert(orders)
      .values({
        orderNo: `LR-LEGACY-${Date.now()}`,
        customerId,
        therapistId,
        therapistUserId,
        status: 'LOCKED',
        serviceSnapshot: { skills: ['泰式'], durationMin: 60, pricePoints: PRICE },
        pricePoints: PRICE,
        currencyCode: null, // 旧积分单
        totalFiat: null,
      })
      .returning();

    const paid = await api.post<{ status: string }>(`/orders/${legacy!.id}/confirm-offline-paid`, undefined, therapistToken);
    expect(paid.status).toBe(200);
    expect(paid.body.data?.status).toBe('PAID');
    const o = await getOrderRow(legacy!.id);
    expect(o?.currencyCode).toBe(CUR); // 自愈补上
    expect(o?.totalFiat).not.toBeNull();
  });
});
