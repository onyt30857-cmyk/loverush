/**
 * E2E · 橱窗商品国家过滤 (Task 2)
 *
 * 验证 listShopItems 按 countryCode 过滤只返回该国可售商品。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getDb, truncateAll } from './helpers';
import { shopItems } from '@loverush/db';
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
