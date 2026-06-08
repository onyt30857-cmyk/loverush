/**
 * E2E · 橱窗商品国家过滤 (Task 2) + 成人年龄门槛 (Task 3) + 佣金后移结算 (Task 4)
 *       + 下单国家校验 (Task 6) + admin service 层 CRUD + markShipped 链路 (Task 6)
 *
 * 验证 listShopItems 按 countryCode 过滤只返回该国可售商品。
 * 验证 placeShopOrder 成人用品下单须先完成年龄确认。
 * 验证下单时佣金 PENDING，settleShopOrder 后才入账。
 * 验证技师服务国家不在商品 countryCodes 时下单被拒 400。
 * 验证 createShopItem → markShipped → settleShopOrder 链路。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, truncateAll, registerNew, api } from './helpers';
import { shopItems, therapists, pointsAccount, therapistShopListings, shopOrders, therapistEarnings, cities } from '@loverush/db';
import {
  listShopItems,
  settleShopOrder,
  refundShopOrder,
  createShopItem,
  updateShopItem,
  markShipped,
} from '../src/services/shop';
import { refreshCountryCache } from '../src/services/countries';

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

// ──────────────────────────────────────────────────────────────────────────────
// Task 6 · 下单国家校验 e2e
// ──────────────────────────────────────────────────────────────────────────────

describe('E2E · 下单国家校验', () => {
  let custToken: string;
  let therIdTH: string;  // 绑定 TH 城市的技师
  let therIdNone: string; // 无 serviceCityId 的技师
  let itemTHOnly: string; // 只在 TH 可售
  let itemMYOnly: string; // 只在 MY 可售

  beforeAll(async () => {
    await truncateAll();

    const c = await registerNew('customer');
    custToken = c.access_token;
    const custId = c.user.id;

    // 成年确认
    await api.post('/me/adult-confirm', {}, custToken);

    const tTH = await registerNew('therapist');
    const tNone = await registerNew('therapist');

    const db = await getDb();

    // 给 customer 充足积分
    await db.insert(pointsAccount)
      .values({ userId: custId, balance: 100000, frozen: 0 })
      .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: 100000 } });

    // 插入一条 TH 城市记录（幂等：多次运行不冲突）
    await db.insert(cities).values({
      code: 'test-bangkok',
      countryCode: 'TH',
      translations: { en: 'Bangkok Test' },
    }).onConflictDoNothing();
    const city = await db.query.cities.findFirst({ where: eq(cities.code, 'test-bangkok') });

    // 刷新国家缓存，让 getCityCountryById 能查到
    await refreshCountryCache();

    // TH 技师：绑定上面的 city
    const [therTH] = await db.insert(therapists).values({
      userId: tTH.user.id,
      serviceCityId: city!.id,
    }).returning();
    therIdTH = therTH!.id;

    // 无 serviceCityId 技师
    const [therNone] = await db.insert(therapists).values({ userId: tNone.user.id }).returning();
    therIdNone = therNone!.id;

    // 创建商品：TH only
    const [iTH] = await db.insert(shopItems).values({
      sku: 'GATE-TH-ONLY',
      title: 'TH Only',
      category: 'adult_toys',
      pricePoints: 200,
      countryCodes: ['TH'],
      stockQty: 100,
      isActive: 1,
    }).returning();
    itemTHOnly = iTH!.id;

    // 创建商品：MY only
    const [iMY] = await db.insert(shopItems).values({
      sku: 'GATE-MY-ONLY',
      title: 'MY Only',
      category: 'adult_toys',
      pricePoints: 200,
      countryCodes: ['MY'],
      stockQty: 100,
      isActive: 1,
    }).returning();
    itemMYOnly = iMY!.id;

    // 两个技师都上架两件商品
    for (const [tId, tUserId] of [[therIdTH, tTH.user.id], [therIdNone, tNone.user.id]] as [string, string][]) {
      await db.insert(therapistShopListings).values({
        therapistId: tId,
        therapistUserId: tUserId,
        shopItemId: itemTHOnly,
        isActive: 1,
      });
      await db.insert(therapistShopListings).values({
        therapistId: tId,
        therapistUserId: tUserId,
        shopItemId: itemMYOnly,
        isActive: 1,
      });
    }
  });

  it('技师服务国家 TH · 商品 TH only → 下单成功 200', async () => {
    const res = await api.post<{ id: string }>(
      '/shop/orders',
      { therapist_id: therIdTH, shop_item_id: itemTHOnly, qty: 1 },
      custToken,
    );
    expect(res.status).toBe(200);
  });

  it('技师服务国家 TH · 商品 MY only → 下单被拒 400', async () => {
    const res = await api.post(
      '/shop/orders',
      { therapist_id: therIdTH, shop_item_id: itemMYOnly, qty: 1 },
      custToken,
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('E0001');
  });

  it('无 serviceCityId 技师 · 商品 MY only → 放行 200（MVP 不误拦）', async () => {
    const res = await api.post<{ id: string }>(
      '/shop/orders',
      { therapist_id: therIdNone, shop_item_id: itemMYOnly, qty: 1 },
      custToken,
    );
    expect(res.status).toBe(200);
  });

  it('商品 countryCodes 为空数组 · 任何技师下单被拒 400（暂不可售）', async () => {
    const db = await getDb();
    // 建一个 countryCodes=[] 的商品并上架给 TH 技师
    const [iEmpty] = await db.insert(shopItems).values({
      sku: 'GATE-EMPTY-CODES',
      title: 'Not For Sale',
      category: 'adult_toys',
      pricePoints: 200,
      countryCodes: [],
      stockQty: 100,
      isActive: 1,
    }).returning();
    const emptyItemId = iEmpty!.id;

    await db.insert(therapistShopListings).values({
      therapistId: therIdTH,
      therapistUserId: (await db.query.therapists.findFirst({ where: eq(therapists.id, therIdTH) }))!.userId,
      shopItemId: emptyItemId,
      isActive: 1,
    });

    const res = await api.post(
      '/shop/orders',
      { therapist_id: therIdTH, shop_item_id: emptyItemId, qty: 1 },
      custToken,
    );
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('E0001');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Task 9 · GET /shop/me/available 只返回技师所在国可售商品
// ──────────────────────────────────────────────────────────────────────────────

describe('E2E · GET /shop/me/available 技师国家过滤', () => {
  let therTokenTH: string;
  let therTokenNone: string; // 无 serviceCityId

  beforeAll(async () => {
    await truncateAll();

    // 建两个技师账号
    const tTH = await registerNew('therapist');
    const tNone = await registerNew('therapist');
    therTokenTH = tTH.access_token;
    therTokenNone = tNone.access_token;

    const db = await getDb();

    // 插入 TH 城市（幂等）
    await db.insert(cities).values({
      code: 'avail-bangkok',
      countryCode: 'TH',
      translations: { en: 'Bangkok Avail Test' },
    }).onConflictDoNothing();
    const city = await db.query.cities.findFirst({ where: eq(cities.code, 'avail-bangkok') });

    // 刷新国家缓存
    await refreshCountryCache();

    // 插入 therapist 行（registerNew 只建 user 行，therapist 档案是懒创建的）
    await db.insert(therapists)
      .values({ userId: tTH.user.id, serviceCityId: city!.id })
      .onConflictDoNothing();
    // tNone 技师：有 therapist 行但无 serviceCityId
    await db.insert(therapists)
      .values({ userId: tNone.user.id })
      .onConflictDoNothing();

    // 建商品：TH only、MY only、both
    await db.insert(shopItems).values([
      {
        sku: 'AVAIL-TH', title: 'TH Available', category: 'adult_toys',
        pricePoints: 100, countryCodes: ['TH'], stockQty: 5, isActive: 1,
      },
      {
        sku: 'AVAIL-MY', title: 'MY Available', category: 'adult_toys',
        pricePoints: 100, countryCodes: ['MY'], stockQty: 5, isActive: 1,
      },
      {
        sku: 'AVAIL-BOTH', title: 'Both Available', category: 'adult_toys',
        pricePoints: 100, countryCodes: ['TH', 'MY'], stockQty: 5, isActive: 1,
      },
    ]);
  });

  it('TH 技师 → 只返回 TH 可售商品', async () => {
    const res = await api.get('/shop/me/available', therTokenTH);
    expect(res.status).toBe(200);
    const body = res.body as { data: { sku: string }[]; meta: { countryCode?: string } };
    const skus = body.data.map((i) => i.sku).sort();
    expect(skus).toEqual(['AVAIL-BOTH', 'AVAIL-TH']);
    expect(body.meta?.countryCode).toBe('TH');
  });

  it('无 serviceCityId 技师 → 返回空数组 + noCity=true', async () => {
    const res = await api.get('/shop/me/available', therTokenNone);
    expect(res.status).toBe(200);
    const body = res.body as { data: unknown[]; meta: { noCity?: boolean } };
    expect(body.data).toEqual([]);
    expect(body.meta?.noCity).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Task 6 · admin service 层：createShopItem → markShipped → settleShopOrder 链路
// ──────────────────────────────────────────────────────────────────────────────

describe('Service · admin shop CRUD + markShipped 链路', () => {
  let custToken: string;
  let custId: string;
  let therUserId: string;
  let therId: string;

  beforeAll(async () => {
    await truncateAll();

    const c = await registerNew('customer');
    custToken = c.access_token;
    custId = c.user.id;

    const t = await registerNew('therapist');
    therUserId = t.user.id;

    const db = await getDb();

    await db.insert(pointsAccount)
      .values({ userId: custId, balance: 100000, frozen: 0 })
      .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: 100000 } });

    const [ther] = await db.insert(therapists).values({ userId: therUserId }).returning();
    therId = ther!.id;

    await api.post('/me/adult-confirm', {}, custToken);
  });

  it('createShopItem 建立商品，updateShopItem 更新库存', async () => {
    const db = await getDb();
    const item = await createShopItem({ db }, {
      sku: 'CRUD-TEST-' + Date.now(),
      title: 'Test Item',
      category: 'adult_toys',
      pricePoints: 300,
      stockQty: 5,
      countryCodes: ['TH'],
    });
    expect(item.id).toBeTruthy();
    expect(item.stockQty).toBe(5);

    const updated = await updateShopItem({ db }, item.id, { stockQty: 20, title: 'Updated Item' });
    expect(updated.stockQty).toBe(20);
    expect(updated.title).toBe('Updated Item');
  });

  it('createShopItem → 上架 → 下单 → markShipped → settleShopOrder 全链路', async () => {
    const db = await getDb();

    // 建商品
    const item = await createShopItem({ db }, {
      sku: 'SHIP-TEST-' + Date.now(),
      title: 'Shippable Item',
      category: 'adult_toys',
      pricePoints: 400,
      stockQty: 10,
      countryCodes: ['TH'],
    });

    // 上架
    await db.insert(therapistShopListings).values({
      therapistId: therId,
      therapistUserId: therUserId,
      shopItemId: item.id,
      isActive: 1,
    });

    // 下单（HTTP，走成年门控）
    const res = await api.post<{ id: string }>(
      '/shop/orders',
      { therapist_id: therId, shop_item_id: item.id, qty: 1 },
      custToken,
    );
    expect(res.status).toBe(200);
    const orderId = res.body.data!.id;

    // markShipped
    await markShipped({ db }, { orderId, trackingNumber: 'TRK123456' });
    const shipped = await db.query.shopOrders.findFirst({ where: eq(shopOrders.id, orderId) });
    expect(shipped!.status).toBe('shipped');
    expect(shipped!.trackingNumber).toBe('TRK123456');
    expect(shipped!.shippedAt).not.toBeNull();

    // settleShopOrder（deliver）
    await settleShopOrder({ db }, { orderId });
    const delivered = await db.query.shopOrders.findFirst({ where: eq(shopOrders.id, orderId) });
    expect(delivered!.status).toBe('delivered');
    expect(delivered!.commissionStatus).toBe('SETTLED');

    // 技师 earnings 入账
    const earn = await db.query.therapistEarnings.findFirst({
      where: eq(therapistEarnings.therapistUserId, therUserId),
    });
    expect(earn!.shopCommissionCents).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Task 10 · GET /shop/me/orders 客户可见性
// ──────────────────────────────────────────────────────────────────────────────

describe('E2E · GET /shop/me/orders 客户订单列表', () => {
  let custToken: string;
  let custId: string;
  let therUserId: string;
  let therId: string;

  beforeAll(async () => {
    await truncateAll();

    const c = await registerNew('customer');
    custToken = c.access_token;
    custId = c.user.id;

    const t = await registerNew('therapist');
    therUserId = t.user.id;

    const db = await getDb();

    await db.insert(pointsAccount)
      .values({ userId: custId, balance: 100000, frozen: 0 })
      .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: 100000 } });

    const [ther] = await db.insert(therapists).values({ userId: therUserId }).returning();
    therId = ther!.id;

    // 建商品 + 上架
    const [item] = await db.insert(shopItems).values({
      sku: 'MYORDERS-TEST',
      title: 'My Orders Item',
      category: 'adult_toys',
      pricePoints: 300,
      countryCodes: ['TH'],
      stockQty: 10,
      isActive: 1,
    }).returning();

    await db.insert(therapistShopListings).values({
      therapistId: therId,
      therapistUserId: therUserId,
      shopItemId: item!.id,
      isActive: 1,
    });

    // 成年确认
    await api.post('/me/adult-confirm', {}, custToken);

    // 下一笔单
    await api.post('/shop/orders', { therapist_id: therId, shop_item_id: item!.id, qty: 1 }, custToken);
  });

  it('下单后 GET /shop/me/orders 能查到该单', async () => {
    const res = await api.get('/shop/me/orders', custToken);
    expect(res.status).toBe(200);
    const body = res.body as { data: Array<{ orderNo: string; itemCategory: string; status: string }> };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    // 脱敏：返回 itemCategory 而非具体商品名
    expect(body.data[0]!.itemCategory).toBe('adult_toys');
    expect(body.data[0]!.status).toBe('paid');
  });

  it('GET /shop/me/orders 返回的字段不含具体商品 title', async () => {
    const res = await api.get('/shop/me/orders', custToken);
    const body = res.body as { data: Array<Record<string, unknown>> };
    // 列表行不应有 itemTitle 字段
    const row = body.data[0]!;
    expect(row.itemTitle).toBeUndefined();
    // 但有 itemCategory（隐私安全替代）
    expect(row.itemCategory).toBeDefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// I2 · 下单幂等：同一 request_id 两次下单只建一单、只扣一次款
// ──────────────────────────────────────────────────────────────────────────────

describe('E2E · 下单幂等（request_id）', () => {
  let custToken: string;
  let custId: string;
  let therId: string;
  let itemId: string;

  beforeAll(async () => {
    await truncateAll();

    const c = await registerNew('customer');
    custToken = c.access_token;
    custId = c.user.id;

    const t = await registerNew('therapist');
    const therUserId = t.user.id;

    const db = await getDb();

    await db.insert(pointsAccount)
      .values({ userId: custId, balance: 100000, frozen: 0 })
      .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: 100000 } });

    const [ther] = await db.insert(therapists).values({ userId: therUserId }).returning();
    therId = ther!.id;

    const [item] = await db.insert(shopItems).values({
      sku: 'IDEM-TEST',
      title: 'Idempotency Item',
      category: 'adult_toys',
      pricePoints: 500,
      countryCodes: ['TH'],
      stockQty: 50,
      isActive: 1,
    }).returning();
    itemId = item!.id;

    await db.insert(therapistShopListings).values({
      therapistId: therId,
      therapistUserId: therUserId,
      shopItemId: itemId,
      isActive: 1,
    });

    await api.post('/me/adult-confirm', {}, custToken);
  });

  it('同一 request_id 下单两次：只建一单、只扣一次款', async () => {
    const requestId = 'idem-test-' + Date.now();
    const db = await getDb();

    const balanceBefore = (await db.query.pointsAccount.findFirst({
      where: eq(pointsAccount.userId, custId),
    }))!.balance;

    const res1 = await api.post<{ id: string }>(
      '/shop/orders',
      { therapist_id: therId, shop_item_id: itemId, qty: 1, request_id: requestId },
      custToken,
    );
    expect(res1.status).toBe(200);
    const orderId1 = res1.body.data!.id;

    // 相同 request_id 再下一次（模拟双击）
    const res2 = await api.post<{ id: string }>(
      '/shop/orders',
      { therapist_id: therId, shop_item_id: itemId, qty: 1, request_id: requestId },
      custToken,
    );
    // 幂等：第二次返回同一订单（200），不重复建单
    expect(res2.status).toBe(200);
    expect(res2.body.data!.id).toBe(orderId1);

    // 只扣了一次 500 积分
    const balanceAfter = (await db.query.pointsAccount.findFirst({
      where: eq(pointsAccount.userId, custId),
    }))!.balance;
    expect(balanceBefore - balanceAfter).toBe(500);
  });

  it('不同 request_id 可以正常复购建新单', async () => {
    const db = await getDb();
    const res = await api.post<{ id: string }>(
      '/shop/orders',
      { therapist_id: therId, shop_item_id: itemId, qty: 1, request_id: 'idem-repurchase-' + Date.now() },
      custToken,
    );
    expect(res.status).toBe(200);
    // 新单 id 与之前不同（复购正常）
    const allOrders = await db.query.shopOrders.findMany({ where: eq(shopOrders.customerId, custId) });
    expect(allOrders.length).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// M2 · 状态机守卫：refunded 单不能 ship
// ──────────────────────────────────────────────────────────────────────────────

describe('Service · markShipped 状态守卫', () => {
  let custToken: string;
  let custId: string;
  let therUserId: string;
  let therId: string;

  beforeAll(async () => {
    await truncateAll();

    const c = await registerNew('customer');
    custToken = c.access_token;
    custId = c.user.id;

    const t = await registerNew('therapist');
    therUserId = t.user.id;

    const db = await getDb();

    await db.insert(pointsAccount)
      .values({ userId: custId, balance: 100000, frozen: 0 })
      .onConflictDoUpdate({ target: pointsAccount.userId, set: { balance: 100000 } });

    const [ther] = await db.insert(therapists).values({ userId: therUserId }).returning();
    therId = ther!.id;

    await api.post('/me/adult-confirm', {}, custToken);
  });

  it('refunded 单调用 markShipped 应抛 400 E3050', async () => {
    const db = await getDb();

    const [item] = await db.insert(shopItems).values({
      sku: 'GUARD-SHIP-TEST-' + Date.now(),
      title: 'Guard Ship Item',
      category: 'adult_toys',
      pricePoints: 200,
      countryCodes: ['TH'],
      stockQty: 10,
      isActive: 1,
    }).returning();

    await db.insert(therapistShopListings).values({
      therapistId: therId,
      therapistUserId: therUserId,
      shopItemId: item!.id,
      isActive: 1,
    });

    const res = await api.post<{ id: string }>(
      '/shop/orders',
      { therapist_id: therId, shop_item_id: item!.id, qty: 1 },
      custToken,
    );
    expect(res.status).toBe(200);
    const orderId = res.body.data!.id;

    // 先退款
    await refundShopOrder({ db }, { orderId });

    // 再尝试标发货：应报错
    await expect(markShipped({ db }, { orderId, trackingNumber: 'TRK-SHOULD-FAIL' }))
      .rejects.toThrow();

    // 确认订单状态仍为 refunded，没有被改成 shipped
    const order = await db.query.shopOrders.findFirst({ where: eq(shopOrders.id, orderId) });
    expect(order!.status).toBe('refunded');
  });
});
