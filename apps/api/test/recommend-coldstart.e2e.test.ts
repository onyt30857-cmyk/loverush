/**
 * E2E · 推荐供给侧曝光公平(新技师冷启动加成)· 需 loverush_test
 *   DATABASE_URL=...loverush_test pnpm exec vitest run test/recommend-coldstart.e2e.test.ts
 *
 * 验证:同城两技师、其它条件相近,新技师(completedOrders=0)拿到 coldStart 加成,
 * 不被完单多的头部技师碾压(框架:双边优化,护技师留存)。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { users, therapists } from '@loverush/db';
import { recallCandidates, scoreCandidates } from '../src/services/recommend';
import { getDb, truncateAll } from './helpers';

let customerId: string;

async function mkCustomer(): Promise<string> {
  const db = await getDb();
  const [u] = await db
    .insert(users)
    .values({ userType: 'customer', status: 'active', displayName: 'c', bip39PubkeyHash: `h-c-${Math.random()}` })
    .returning();
  return u!.id;
}
async function mkTherapist(name: string, completedOrders: number): Promise<string> {
  const db = await getDb();
  const [u] = await db
    .insert(users)
    .values({ userType: 'therapist', status: 'active', displayName: name, bip39PubkeyHash: `h-${name}-${Math.random()}` })
    .returning();
  await db.insert(therapists).values({
    userId: u!.id,
    verificationStatus: 'passed',
    serviceCity: 'TestCity',
    serviceCountry: 'TH',
    onlineStatus: 'offline',
    scoreAppearance: 200,
    scoreBody: 200,
    scoreService: 200,
    rating: 400,
    completedOrders,
  });
  return u!.id;
}

describe('推荐供给侧曝光公平 · 新技师冷启动', () => {
  beforeAll(async () => {
    await truncateAll();
    customerId = await mkCustomer();
    await mkTherapist('newbie', 0); // 新技师
    await mkTherapist('veteran', 30); // 头部
  });

  it('新技师拿到 coldStart 加成,头部没有', async () => {
    const db = await getDb();
    const cands = await recallCandidates({ db }, { customerId, city: 'TestCity' });
    const scored = await scoreCandidates({ db }, { customerId, city: 'TestCity' }, cands);
    const newbie = scored.find((s) => s.therapist.completedOrders === 0)!;
    const vet = scored.find((s) => s.therapist.completedOrders === 30)!;
    expect(newbie.factors.coldStart).toBe(35);
    expect(vet.factors.coldStart).toBeUndefined();
  });

  it('冷启动让新技师不被头部碾压(分差被显著拉近/反超)', async () => {
    const db = await getDb();
    const cands = await recallCandidates({ db }, { customerId, city: 'TestCity' });
    const scored = await scoreCandidates({ db }, { customerId, city: 'TestCity' }, cands);
    const newbie = scored.find((s) => s.therapist.completedOrders === 0)!;
    const vet = scored.find((s) => s.therapist.completedOrders === 30)!;
    // 头部 completedOrders 因子 = min(50,30)=30;新技师 coldStart=35 → 新技师反超 5 分(其它相近)
    expect(newbie.score).toBeGreaterThanOrEqual(vet.score);
  });
});
