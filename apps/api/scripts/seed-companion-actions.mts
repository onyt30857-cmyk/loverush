/**
 * Seed companion_actions 目录。价格/分成是示例值，最终由 Tony 拍板或 admin 改。
 * 用法本地: DATABASE_URL=<local> bun apps/api/scripts/seed-companion-actions.mts
 */
import { createDb, companionActions } from '@loverush/db';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL 未注入'); process.exit(1); }
const db = createDb(url, { maxConnections: 3 });

const ACTIONS = [
  { code: 'voice_whisper',     actionType: 'voice',     pricePoints: 30,  revenueShareBps: 7000, expReward: 15 },
  { code: 'wake_up',           actionType: 'schedule',  pricePoints: 20,  revenueShareBps: 7000, expReward: 10 },
  { code: 'tonight_exclusive', actionType: 'exclusive', pricePoints: 200, revenueShareBps: 7000, expReward: 60 },
  { code: 'peek',              actionType: 'media',     pricePoints: 50,  revenueShareBps: 7000, expReward: 20 },
  { code: 'flirt_mode',        actionType: 'mode',      pricePoints: 40,  revenueShareBps: 7000, expReward: 25 },
];
for (const a of ACTIONS) {
  await db.insert(companionActions).values(a).onConflictDoUpdate({
    target: companionActions.code,
    set: { pricePoints: a.pricePoints, revenueShareBps: a.revenueShareBps, expReward: a.expReward, isActive: 1 },
  });
  console.log('seeded', a.code);
}
process.exit(0);
