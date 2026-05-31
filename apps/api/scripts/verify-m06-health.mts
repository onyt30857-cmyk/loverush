/* eslint-disable no-console */
/**
 * M06b 模块② · AI 健康分计算 · 本地验证
 *
 * 跑 recomputeHealthScores 给所有 passed 技师算分，再 getHealthData 取榜，打印结果。
 * 纯读库算分写库（ai_health_scores + therapists.ai_health_latest_score），不碰客户。
 *
 * 跑法：DATABASE_URL=<本地> <tsx> scripts/verify-m06-health.mts
 */
import { createDb } from '@loverush/db';
import { recomputeHealthScores, getHealthData } from '../src/services/ai-health.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://loverush:loverush_dev@localhost:54399/loverush';
if (!DB_URL.includes('localhost') && !DB_URL.includes('127.0.0.1')) {
  console.error('💥 拒绝运行：DATABASE_URL 非本地');
  process.exit(3);
}
const db = createDb(DB_URL);
const ctx = { db };

async function main() {
  console.log('▶ recomputeHealthScores …');
  const r = await recomputeHealthScores(ctx);
  console.log(`  ✓ computed = ${r.computed} 位技师`);

  console.log('▶ getHealthData …');
  const data = await getHealthData(ctx);
  console.log('  overview:', JSON.stringify(data.overview));
  console.log(`  technicians (${data.therapists.length}, 最差在前):`);
  for (const t of data.therapists.slice(0, 10)) {
    console.log(
      `   - ${(t.displayName ?? '(无名)').padEnd(8)} 总分=${t.overallScore ?? '—'} ` +
        `[红线${t.redlineFreqScore} 重复${t.simhashRepeatScore} 负反馈${t.negativeFeedbackScore} 活跃${t.volumeScore}] ` +
        `enabled=${t.enabled} ${t.killSwitchReason ? '关停:' + t.killSwitchReason : ''}`,
    );
  }

  if (r.computed === 0) console.warn('  ⚠ 没有 passed 技师，computed=0（本地库可能没种子数据）');
  console.log('✅ 健康分链路跑通');
  process.exit(0);
}

main().catch((e) => {
  console.error('💥 失败:', e);
  process.exit(1);
});
