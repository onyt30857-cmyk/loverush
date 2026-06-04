/**
 * M04 · 对话式匹配引擎验证(只读,不写库)
 * 用不同意图调 matchConversational,看 LLM 语义重排 + 可解释理由是否合理。
 * 用法: railway run -s loverush -- bun apps/api/scripts/verify-m04-match.mts
 */
import { createDb } from '@loverush/db';
import { matchConversational } from '../src/services/match';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL 未注入(railway run -s loverush -- ...)');
  process.exit(1);
}
const db = createDb(url, { maxConnections: 5 });

// 任取一个用户做 customerId(只影响拉黑排除/画像读取;本验证靠 intentText 驱动)
const someUser = await db.query.users.findFirst({});
const customerId = someUser?.id;
if (!customerId) {
  console.error('ERROR: 库里没有用户');
  process.exit(1);
}
console.log('customerId =', customerId, '\n');

const intents = [
  '想找个温柔会聊天、能让我放松的姐姐',
  '肩颈很僵硬,想要力度大一点的深度按摩',
  '第一次来有点紧张,希望对方耐心、不要太多话',
];

for (const intentText of intents) {
  console.log(`\n=== 意图: ${intentText} ===`);
  const { results, mode } = await matchConversational({ db }, { customerId, intentText, topN: 3 });
  console.log(`mode: ${mode} · 命中 ${results.length} 位`);
  for (const r of results) {
    const t = r.therapist;
    console.log(`  ▶ ${t.nationality ?? '?'} / ${(t.tags ?? []).slice(0, 2).join('、') || '无标签'}  score=${r.score}`);
    for (const reason of r.reasons) console.log(`     - ${reason}`);
  }
}
process.exit(0);
