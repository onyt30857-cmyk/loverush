/**
 * E2E · 橱窗商品国家过滤 (Task 2) + 成人年龄门槛 (Task 3) + 佣金后移结算 (Task 4)
 *
 * 验证 listShopItems 按 countryCode 过滤只返回该国可售商品。
 * 验证 placeShopOrder 成人用品下单须先完成年龄确认。
 * 验证下单时佣金 PENDING，settleShopOrder 后才入账。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, truncateAll, registerNew, api } from './helpers';
import { shopItems, therapists, pointsAccount, therapistShopListings, shopOrders, therapistEarnings } from '@loverush/db';
import { listShopItems, settleShopOrder, refundShopOrder } from '../src/services/shop';

async function seedItem(sku: string, countryCodes: string[]) {
  const db = await getDb();
  await db.insert(shopItems).values({
    sku,
    title: `item-${sku}`,
    category: 'adult_toys',
    pricePoints: 500,
    countryCodes,
    stockQty: 10,
    isActive: 1,
  });
}

describe('E2E · 橱窗商品国家过滤', () => {
  beforeAll(async () => {
    await truncateAll();
    await seedItem('TH-ONLY', ['TH']);
    await seedItem('MY-ONLY', ['MY']);
    await seedItem('BOTH', ['TH', 'MY']);
  });

  it('按国家过滤只返回该国可售商品', async () => {
    const db = await getDb();
    const th = await listShopItems({ db }, { countryCode: 'TH' });
    expect(th.map((i: any) => i.sku).sort()).toEqual(['BOTH', 'TH-ONLY']);
    const my = await listShopItems({ db }, { countryCode: 'MY' });
    expect(my.map((i: any) => i.sku).sort()).toEqual(['BOTH', 'MY-ONLY']);
  });

  it('不传国家返回全部上架商品', async () => {
    const db = await getDb();
    const all = await listShopItems({ db }, {});
    expect(all.length).toBe(3);
  });
});

describe('E2E · 下单年龄门槛', () => {
  let custToken: string;
  let therId: string;
  let itemId: string;

  beforeAll(async () => {
    await truncateAll();

    const c = await registerNew('customer');
    custToken = c.access_token;
    const custId = c.user.id;

    const t = await registerNew('therapist');
    const therUserId = t.user.id;

    const db = await getDb();

    // 给 customer 充足积分
    await db.insert(pointsAccount)
      .values({ userId: custId, balance: 100000, frozen: 0 })
      .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: 100000 } });

    // 创建 therapist 行
    const [ther] = await db.insert(therapists).values({ userId: therUserId }).returning();
    therId = ther!.id;

    // 创建商品
    const [item] = await db.insert(shopItems).values({
      sku: 'AGE-TEST',
      title: 'age-gate item',
      category: 'adult_toys',
      pricePoints: 500,
      countryCodes: ['TH'],
      stockQty: 10,
      isActive: 1,
    }).returning();
    itemId = item!.id;

    // 技师上架该商品
    await db.insert(therapistShopListings).values({
      therapistId: therId,
      therapistUserId: therUserId,
      shopItemId: itemId,
      isActive: 1,
    });
  });

  it('未确认成年下单被拒 403', async () => {
    const res = await api.post('/shop/orders', { therapist_id: therId, shop_item_id: itemId, qty: 1 }, custToken);
    expect(res.status).toBe(403);
  });

  it('确认成年后可下单 200', async () => {
    const conf = await api.post('/me/adult-confirm', {}, custToken);
    expect(conf.status).toBe(200);
    const res = await api.post('/shop/orders', { therapist_id: therId, shop_item_id: itemId, qty: 1 }, custToken);
    expect(res.status).toBe(200);
  });
});

describe('E2E · 佣金后移结算', () => {
  let custToken: string;
  let custId: string;
  let therUserId: string;
  let therId: string;
  let itemId: string;

  beforeAll(async () => {
    await truncateAll();

    const c = await registerNew('customer');
    custToken = c.access_token;
    custId = c.user.id;

    const t = await registerNew('therapist');
    therUserId = t.user.id;

    const db = await getDb();

    // 给 customer 充足积分
    await db.insert(pointsAccount)
      .values({ userId: custId, balance: 100000, frozen: 0 })
      .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: 100000 } });

    // 创建 therapist 行
    const [ther] = await db.insert(therapists).values({ userId: therUserId }).returning();
    therId = ther!.id;

    // 创建商品（pricePoints=500，commissionBpsDefault=2000 → 500*20%=100 points → 100 cents）
    const [item] = await db.insert(shopItems).values({
      sku: 'SETTLE-TEST',
      title: 'settle-test item',
      category: 'adult_toys',
      pricePoints: 500,
      countryCodes: ['TH'],
      stockQty: 20,
      isActive: 1,
    }).returning();
    itemId = item!.id;

    // 技师上架
    await db.insert(therapistShopListings).values({
      therapistId: therId,
      therapistUserId: therUserId,
      shopItemId: itemId,
      isActive: 1,
    });

    // 成年确认
    await api.post('/me/adult-confirm', {}, custToken);
  });

  it('下单时佣金 PENDING、技师 earnings 不入账', async () => {
    const res = await api.post<{ id: string }>('/shop/orders', { therapist_id: therId, shop_item_id: itemId, qty: 1 }, custToken);
    expect(res.status).toBe(200);
    const db = await getDb();
    const order = await db.query.shopOrders.findFirst({ where: eq(shopOrders.id, res.body.data!.id) });
    expect(order!.commissionStatus).toBe('PENDING');
    expect(order!.status).toBe('paid');
    const earn = await db.query.therapistEarnings.findFirst({ where: eq(therapistEarnings.therapistUserId, therUserId) });
    expect(earn?.shopCommissionCents ?? 0).toBe(0);
  });

  it('settle 后佣金入 earnings、状态 SETTLED/delivered', async () => {
    const res = await api.post<{ id: string }>('/shop/orders', { therapist_id: therId, shop_item_id: itemId, qty: 1 }, custToken);
    expect(res.status).toBe(200);
    const orderId = res.body.data!.id;
    await settleShopOrder({ db: await getDb() }, { orderId });
    const db = await getDb();
    const order = await db.query.shopOrders.findFirst({ where: eq(shopOrders.id, orderId) });
    expect(order!.commissionStatus).toBe('SETTLED');
    expect(order!.status).toBe('delivered');
    const earn = await db.query.therapistEarnings.findFirst({ where: eq(therapistEarnings.therapistUserId, therUserId) });
    expect(earn!.shopCommissionCents).toBe(100); // 500*20%=100 积分=100 cents
  });
});

describe('E2E · 退款回滚', () => {
  let custToken: string;
  let custId: string;
  let therUserId: string;
  let therId: string;
  let itemId: string;

  beforeAll(async () => {
    await truncateAll();

    const c = await registerNew('customer');
    custToken = c.access_token;
    custId = c.user.id;

    const t = await registerNew('therapist');
    therUserId = t.user.id;

    const db = await getDb();

    // 给 customer 充足积分
    await db.insert(pointsAccount)
      .values({ userId: custId, balance: 100000, frozen: 0 })
      .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: 100000 } });

    // 创建 therapist 行
    const [ther] = await db.insert(therapists).values({ userId: therUserId }).returning();
    therId = ther!.id;

    // 创建商品（pricePoints=500，commissionBpsDefault=2000 → 500*20%=100 points → 100 cents）
    const [item] = await db.insert(shopItems).values({
      sku: 'REFUND-TEST',
      title: 'refund-test item',
      category: 'adult_toys',
      pricePoints: 500,
      countryCodes: ['TH'],
      stockQty: 10,
      isActive: 1,
    }).returning();
    itemId = item!.id;

    // 技师上架
    await db.insert(therapistShopListings).values({
      therapistId: therId,
      therapistUserId: therUserId,
      shopItemId: itemId,
      isActive: 1,
    });

    // 成年确认
    await api.post('/me/adult-confirm', {}, custToken);
  });

  it('PENDING 单退款：退客户积分、回补库存、不扣技师', async () => {
    const db0 = await getDb();
    const before = (await db0.query.shopItems.findFirst({ where: eq(shopItems.id, itemId) }))!.stockQty;
    const res = await api.post<{ id: string }>('/shop/orders', { therapist_id: therId, shop_item_id: itemId, qty: 1 }, custToken);
    const orderId = res.body.data!.id;
    await refundShopOrder({ db: await getDb() }, { orderId });
    const db = await getDb();
    const order = await db.query.shopOrders.findFirst({ where: eq(shopOrders.id, orderId) });
    expect(order!.status).toBe('refunded');
    expect(order!.commissionStatus).toBe('VOID');
    const item = await db.query.shopItems.findFirst({ where: eq(shopItems.id, itemId) });
    expect(item!.stockQty).toBe(before); // 下单-1 退款+1 回到原值
    const acct = await db.query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, custId) });
    expect(acct!.balance).toBe(100000);
  });

  it('SETTLED 单退款：从技师 earnings 扣回佣金', async () => {
    const res = await api.post<{ id: string }>('/shop/orders', { therapist_id: therId, shop_item_id: itemId, qty: 1 }, custToken);
    const orderId = res.body.data!.id;
    await settleShopOrder({ db: await getDb() }, { orderId });
    const earnBefore = (await (await getDb()).query.therapistEarnings.findFirst({ where: eq(therapistEarnings.therapistUserId, therUserId) }))!.shopCommissionCents;
    await refundShopOrder({ db: await getDb() }, { orderId });
    const earn = await (await getDb()).query.therapistEarnings.findFirst({ where: eq(therapistEarnings.therapistUserId, therUserId) });
    expect(earn!.shopCommissionCents).toBe(earnBefore - 100);
  });
});
