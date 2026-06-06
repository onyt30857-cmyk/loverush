/**
 * E2E · 客户"了解程度"档 computeCustomerFamiliarity(真画像深度→0/1/2)· 需 loverush_test
 *   DATABASE_URL=...loverush_test pnpm exec vitest run test/customer-familiarity.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { users, customerMasterPreferences } from '@loverush/db';
import { computeCustomerFamiliarity } from '../src/services/customerFamiliarity';
import { getDb, truncateAll } from './helpers';

async function mkCustomer(name: string): Promise<string> {
  const db = await getDb();
  const [u] = await db
    .insert(users)
    .values({
      userType: 'customer',
      status: 'active',
      displayName: name,
      bip39PubkeyHash: `h-${name}-${Math.random().toString(36).slice(2)}`,
    })
    .returning();
  return u!.id;
}

describe('客户了解程度档 computeCustomerFamiliarity', () => {
  beforeAll(async () => {
    await truncateAll();
  });

  it('无任何画像 → 0(新客)', async () => {
    const db = await getDb();
    const uid = await mkCustomer('newbie');
    expect(await computeCustomerFamiliarity(db, uid)).toBe(0);
  });

  it('填了 1-2 个偏好维度 → 1(渐熟)', async () => {
    const db = await getDb();
    const uid = await mkCustomer('warming');
    await db.insert(customerMasterPreferences).values({
      userId: uid,
      bodyTypePrefs: ['苗条'],
      serviceStylePrefs: ['泰式'],
    });
    expect(await computeCustomerFamiliarity(db, uid)).toBe(1);
  });

  it('有 intentSummary(LLM 一句话画像)+多维度 → 2(熟客)', async () => {
    const db = await getDb();
    const uid = await mkCustomer('known');
    await db.insert(customerMasterPreferences).values({
      userId: uid,
      bodyTypePrefs: ['苗条'],
      serviceStylePrefs: ['泰式'],
      emotionalNeeds: ['被倾听'],
      intentSummary: '偏好温柔型、注重情绪陪伴的熟客',
    });
    expect(await computeCustomerFamiliarity(db, uid)).toBe(2);
  });
});
