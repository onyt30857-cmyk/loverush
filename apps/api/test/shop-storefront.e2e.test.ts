/**
 * E2E · 橱窗商品国家过滤 (Task 2) + 成人年龄门槛 (Task 3)
 *
 * 验证 listShopItems 按 countryCode 过滤只返回该国可售商品。
 * 验证 placeShopOrder 成人用品下单须先完成年龄确认。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getDb, truncateAll, registerNew, api } from './helpers';
import { shopItems, therapists, pointsAccount, therapistShopListings } from '@loverush/db';
import { listShopItems } from '../src/services/shop';

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
