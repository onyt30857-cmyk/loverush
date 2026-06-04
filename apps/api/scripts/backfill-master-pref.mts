/**
 * M04 · 回填客户匹配画像(管道A 上线前已完成 onboarding 的老数据)
 *
 * 管道A(onboarding 完成同步 master_preferences)只对上线后新完成生效。
 * 此脚本把历史已完成 onboarding 的偏好(saved_memory.facts)补进 customer_master_preferences。
 * 复用管道A 同一映射逻辑(syncMasterPreferences)。
 *
 * 用法: railway run -s loverush -- bun apps/api/scripts/backfill-master-pref.mts [--execute]
 */
import { createDb } from '@loverush/db';
import { sql } from 'drizzle-orm';
import { syncMasterPreferences } from '../src/services/assistant/onboarding';

const EXECUTE = process.argv.includes('--execute');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL 未注入(railway run -s loverush -- ...)');
  process.exit(1);
}
const db = createDb(url, { maxConnections: 5 });

const rows = await db.query.customerSavedMemory.findMany({
  where: sql`(facts->>'onboarding_complete') = 'true'`,
});
console.log(`onboarding 完成 ${rows.length} 个 · 模式: ${EXECUTE ? '执行(--execute)' : 'DRY-RUN'}\n`);

let ok = 0;
for (const r of rows) {
  const facts = (r.facts ?? {}) as Record<string, unknown>;
  const style = facts.service_style;
  console.log(`▶ ${r.userId} · service_style=${JSON.stringify(style)} body=${JSON.stringify(facts.body_type)}`);
  if (EXECUTE) {
    // facts 顶层在 onboarding 完成时已提升 service_style/body_type/look_style 等,直接喂同一映射
    await syncMasterPreferences({ db }, r.userId, facts as never);
    ok++;
    console.log('  ✓ 已同步 master_preferences');
  }
}
console.log(`\n完成: ${EXECUTE ? `已回填 ${ok} 个` : 'DRY-RUN 未写库'}`);
process.exit(0);
