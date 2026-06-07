/**
 * 回填 therapists.rating_bayes(+ 有评价者真实计数/贝叶斯分)· 跑一次。
 * 0 评价技师(上线前演示账号)→ ratingBayes 兜底 = 现有 scoreService 种子值,排序不退化。
 *
 * 前置:先跑 0044 迁移(加 rating_bayes 列)。
 * 跑法:railway run -- bash -c 'cd apps/api && bun scripts/backfill-rating-bayes.mts'
 */
import { createDb } from '@loverush/db';
import { therapists } from '@loverush/db';
import { refreshTherapistRating, clearMeanCache } from '../src/services/rating';

const db = createDb(process.env.DATABASE_URL!, { maxConnections: 4 });
clearMeanCache();

const all = await db.select({ id: therapists.id }).from(therapists);
console.log(`技师总数: ${all.length}`);

let done = 0;
for (const t of all) {
  await refreshTherapistRating({ db }, t.id);
  done++;
  if (done % 10 === 0) console.log(`  已回填 ${done}/${all.length}`);
}
console.log(`✅ 回填完成 ${done}/${all.length}`);

// 抽样核对
const sample = await db.select({
  id: therapists.id,
  scoreService: therapists.scoreService,
  ratingBayes: therapists.ratingBayes,
  ratingCount: therapists.ratingCount,
}).from(therapists).limit(8);
console.table(sample.map((s) => ({ ...s, id: s.id.slice(0, 8) })));
process.exit(0);
