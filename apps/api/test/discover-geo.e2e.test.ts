/**
 * E2E · 发现页 /therapists 地理距离 + 综合评分 + 技能多选筛选(2026-06-05 全量重建验证)
 *
 * 服务层直测 listTherapists(seed 城市坐标 + 技师)· 需 loverush_test 库(drizzle-kit push)。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { cities, therapists, users } from '@loverush/db';
import { listTherapists } from '../src/services/therapists';
import { getDb, truncateAll } from './helpers';

// 客户在曼谷市中心
const VIEWER = { lat: 13.7563, lng: 100.5018 };

let bangkokId: string;
let chiangmaiId: string;

async function seedCity(code: string, lat: string, lng: string): Promise<string> {
  const db = await getDb();
  // cities 是字典表 · truncateAll 不清它 · 按 code upsert 避免跨次重复
  const [row] = await db
    .insert(cities)
    .values({ code, countryCode: 'TH', translations: { en: code }, latCenter: lat, lngCenter: lng })
    .onConflictDoUpdate({ target: cities.code, set: { latCenter: lat, lngCenter: lng } })
    .returning();
  return row!.id;
}

async function seedTherapist(opts: {
  name: string;
  cityId: string;
  score: number; // 三维同分(0-1000)
  skill: string;
  heightCm: number;
}): Promise<string> {
  const db = await getDb();
  const [u] = await db
    .insert(users)
    .values({ userType: 'therapist', status: 'active', displayName: opts.name, bip39PubkeyHash: `hash-${opts.name}-${Math.round(VIEWER.lat * 1e6)}-${opts.heightCm}` })
    .returning();
  const [t] = await db
    .insert(therapists)
    .values({
      userId: u!.id,
      displayName: opts.name,
      serviceCityId: opts.cityId,
      verificationStatus: 'passed',
      onlineStatus: 'online',
      heightCm: opts.heightCm,
      skillsJson: [{ skill: opts.skill, level: 5 }],
      scoreAppearance: opts.score,
      scoreBody: opts.score,
      scoreService: opts.score,
    } as never)
    .returning();
  return t!.id;
}

describe('E2E · 发现页地理/评分/技能筛选', () => {
  beforeAll(async () => {
    await truncateAll();
    bangkokId = await seedCity('bangkok', '13.7563', '100.5018');
    chiangmaiId = await seedCity('chiang-mai', '18.7883', '98.9853'); // 距曼谷 ~580km
    await seedTherapist({ name: 'BkkThai', cityId: bangkokId, score: 900, skill: '泰式', heightCm: 170 }); // 9.0
    await seedTherapist({ name: 'BkkOil', cityId: bangkokId, score: 800, skill: '油压', heightCm: 160 }); // 8.0
    await seedTherapist({ name: 'CmThai', cityId: chiangmaiId, score: 950, skill: '泰式', heightCm: 175 }); // 9.5(远)
  }, 30_000);

  const names = (r: { data: Array<{ displayName: string | null }> }) => r.data.map((d) => d.displayName).sort();

  it('附近 50km + GPS → 只返回曼谷技师,带 distance_km,按距离升序', async () => {
    const r = await listTherapists({ db: await getDb() }, { ...VIEWER, radiusKm: 50 });
    expect(names(r)).toEqual(['BkkOil', 'BkkThai']); // 清迈被半径剔除
    // 都有距离且 <= 50
    for (const d of r.data) {
      expect(typeof d.distance_km).toBe('number');
      expect(d.distance_km!).toBeLessThanOrEqual(50);
    }
  });

  it('只给 GPS 不给半径 → 全返回,清迈带大距离且排末尾', async () => {
    const r = await listTherapists({ db: await getDb() }, { ...VIEWER });
    expect(r.data.length).toBe(3);
    const last = r.data[r.data.length - 1]!;
    expect(last.displayName).toBe('CmThai'); // 最远排末
    expect(last.distance_km!).toBeGreaterThan(400);
  });

  it('min_rating=9 → 综合分≥9 的(BkkThai 9.0 / CmThai 9.5),排除 BkkOil 8.0', async () => {
    const r = await listTherapists({ db: await getDb() }, { minRating: 9 });
    expect(names(r)).toEqual(['BkkThai', 'CmThai']);
  });

  it('skill 单选「泰式」→ 两个泰式技师', async () => {
    const r = await listTherapists({ db: await getDb() }, { skill: '泰式' });
    expect(names(r)).toEqual(['BkkThai', 'CmThai']);
  });

  it('skill 多选「泰式,油压」(OR)→ 三个都命中', async () => {
    const r = await listTherapists({ db: await getDb() }, { skill: '泰式,油压' });
    expect(names(r)).toEqual(['BkkOil', 'BkkThai', 'CmThai']);
  });

  it('height_min=165 → 只 BkkThai(170)/CmThai(175),排除 BkkOil(160)', async () => {
    const r = await listTherapists({ db: await getDb() }, { heightMin: 165 });
    expect(names(r)).toEqual(['BkkThai', 'CmThai']);
  });

  it('组合:附近 50km + min_rating=9 → 曼谷内且≥9 = 只 BkkThai', async () => {
    const r = await listTherapists({ db: await getDb() }, { ...VIEWER, radiusKm: 50, minRating: 9 });
    expect(names(r)).toEqual(['BkkThai']);
  });
});
