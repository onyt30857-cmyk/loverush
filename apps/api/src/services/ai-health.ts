/**
 * AI 分身健康度评分（M06b 模块②）
 *
 * 给每个开了分身的技师算 0-100 综合健康分（4 维子分透明）。
 * 触发方式：admin 手动「刷新」(纯读库算分写库，不碰客户，低风险)，不自动 cron。
 *
 * 算法(7 天滑窗，对齐 ai_health_scores schema 注释)：
 *   redlineFreqScore   0-40: max(0, 40 - 红线数 × 4)
 *   simhashRepeatScore 0-25: max(0, 25 - 重复率 × 50)
 *   negativeFeedback   0-20: 20 - 低分评价 - 拉黑数 × 5
 *   volumeScore        0-15: 代发量在合理区间
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { aiHealthScores } from '@loverush/db';

export interface HealthContext {
  db: Database;
}

interface MetricRow {
  therapist_user_id: string;
  alter_count: number;
  redline_count: number;
  block_count: number;
  simhash_repeat_count: number;
  review_low_count: number;
}

function scoreFromMetrics(m: {
  alterCount: number;
  redlineCount: number;
  simhashRepeatCount: number;
  blockCount: number;
  reviewLowScoreCount: number;
}) {
  const redlineFreqScore = Math.max(0, 40 - m.redlineCount * 4);
  const repeatRate = m.alterCount > 0 ? m.simhashRepeatCount / m.alterCount : 0;
  const simhashRepeatScore = Math.max(0, Math.min(25, Math.round(25 - repeatRate * 50)));
  const negativeFeedbackScore = Math.max(0, 20 - m.reviewLowScoreCount - m.blockCount * 5);
  // 代发量：0=无活动给 0；1~50=合理满分；>50 缓降，最低 8
  const volumeScore =
    m.alterCount === 0 ? 0 : m.alterCount <= 50 ? 15 : Math.max(8, 15 - Math.floor((m.alterCount - 50) / 20));
  const overallScore = redlineFreqScore + simhashRepeatScore + negativeFeedbackScore + volumeScore;
  return { overallScore, redlineFreqScore, simhashRepeatScore, negativeFeedbackScore, volumeScore };
}

/** 重算所有 passed 技师的健康分（手动触发） */
export async function recomputeHealthScores(ctx: HealthContext): Promise<{ computed: number }> {
  const rows = (await ctx.db.execute(sql`
    SELECT t.user_id AS therapist_user_id,
      (SELECT count(*) FROM ai_alter_messages a WHERE a.therapist_user_id = t.user_id
         AND a.created_at > now() - interval '7 days')::int AS alter_count,
      (SELECT count(*) FROM ai_alter_redline_logs r WHERE r.therapist_user_id = t.user_id
         AND r.action IN ('block','rewrite') AND r.created_at > now() - interval '7 days')::int AS redline_count,
      (SELECT count(*) FROM customer_relationship_profile crp WHERE crp.therapist_id = t.id
         AND crp.is_blocked = 1)::int AS block_count,
      COALESCE((SELECT sum(cnt - 1) FROM (
         SELECT count(*) cnt FROM ai_alter_messages a2 WHERE a2.therapist_user_id = t.user_id
           AND a2.created_at > now() - interval '7 days' AND a2.simhash IS NOT NULL
         GROUP BY a2.simhash HAVING count(*) > 1) x), 0)::int AS simhash_repeat_count,
      0::int AS review_low_count
    FROM therapists t
    WHERE t.verification_status = 'passed'
  `)) as unknown as MetricRow[];

  const today = new Date().toISOString().slice(0, 10);
  let computed = 0;
  for (const r of rows) {
    const alterCount = Number(r.alter_count);
    const redlineCount = Number(r.redline_count);
    const simhashRepeatCount = Number(r.simhash_repeat_count);
    const blockCount = Number(r.block_count);
    const reviewLowScoreCount = Number(r.review_low_count);
    const s = scoreFromMetrics({ alterCount, redlineCount, simhashRepeatCount, blockCount, reviewLowScoreCount });
    // metrics 字段对齐 ai_health_scores schema 的 $type
    const metrics = {
      redlineCount,
      simhashRepeatCount,
      blockCount,
      reviewLowScoreCount,
      alterMessageCount: alterCount,
    };
    await ctx.db
      .insert(aiHealthScores)
      .values({
        therapistUserId: r.therapist_user_id,
        scoreDate: today,
        overallScore: s.overallScore,
        redlineFreqScore: s.redlineFreqScore,
        simhashRepeatScore: s.simhashRepeatScore,
        negativeFeedbackScore: s.negativeFeedbackScore,
        volumeScore: s.volumeScore,
        windowDays: 7,
        metrics,
      })
      .onConflictDoUpdate({
        target: [aiHealthScores.therapistUserId, aiHealthScores.scoreDate],
        set: {
          overallScore: s.overallScore,
          redlineFreqScore: s.redlineFreqScore,
          simhashRepeatScore: s.simhashRepeatScore,
          negativeFeedbackScore: s.negativeFeedbackScore,
          volumeScore: s.volumeScore,
          metrics,
        },
      });
    await ctx.db.execute(
      sql`UPDATE therapists SET ai_health_latest_score = ${s.overallScore} WHERE user_id = ${r.therapist_user_id}::uuid`,
    );
    computed++;
  }
  return { computed };
}

export interface HealthTherapistRow {
  therapistUserId: string;
  displayName: string | null;
  enabled: boolean;
  killSwitchReason: string | null;
  overallScore: number | null;
  redlineFreqScore: number | null;
  simhashRepeatScore: number | null;
  negativeFeedbackScore: number | null;
  volumeScore: number | null;
  metrics: unknown;
  scoreDate: string | null;
}

/** 健康仪表盘数据：全平台概览 + 技师榜（最差在前） */
export async function getHealthData(ctx: HealthContext): Promise<{
  overview: {
    enabledCount: number;
    scoredCount: number;
    avgScore: number | null;
    riskCount: number; // 健康分 < 50
    lastComputedAt: string | null;
  };
  therapists: HealthTherapistRow[];
}> {
  const rows = (await ctx.db.execute(sql`
    SELECT t.user_id AS therapist_user_id, u.display_name,
      t.ai_alter_enabled, t.ai_kill_switch_reason,
      h.overall_score, h.redline_freq_score, h.simhash_repeat_score,
      h.negative_feedback_score, h.volume_score, h.metrics, h.score_date
    FROM therapists t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN ai_health_scores h ON h.therapist_user_id = t.user_id
      AND h.score_date = (SELECT max(score_date) FROM ai_health_scores h2 WHERE h2.therapist_user_id = t.user_id)
    WHERE t.verification_status = 'passed' AND t.ai_alter_enabled = 1
    ORDER BY COALESCE(h.overall_score, 999) ASC
    LIMIT 100
  `)) as unknown as Array<{
    therapist_user_id: string;
    display_name: string | null;
    ai_alter_enabled: number;
    ai_kill_switch_reason: string | null;
    overall_score: number | null;
    redline_freq_score: number | null;
    simhash_repeat_score: number | null;
    negative_feedback_score: number | null;
    volume_score: number | null;
    metrics: unknown;
    score_date: string | null;
  }>;

  const therapists: HealthTherapistRow[] = rows.map((r) => ({
    therapistUserId: r.therapist_user_id,
    displayName: r.display_name,
    enabled: r.ai_alter_enabled === 1,
    killSwitchReason: r.ai_kill_switch_reason,
    overallScore: r.overall_score,
    redlineFreqScore: r.redline_freq_score,
    simhashRepeatScore: r.simhash_repeat_score,
    negativeFeedbackScore: r.negative_feedback_score,
    volumeScore: r.volume_score,
    metrics: r.metrics,
    scoreDate: r.score_date,
  }));

  const scored = therapists.filter((t) => t.overallScore !== null);
  const avgScore = scored.length
    ? Math.round(scored.reduce((s, t) => s + (t.overallScore ?? 0), 0) / scored.length)
    : null;
  const lastComputedAt = therapists.map((t) => t.scoreDate).filter(Boolean).sort().reverse()[0] ?? null;

  return {
    overview: {
      enabledCount: therapists.length,
      scoredCount: scored.length,
      avgScore,
      riskCount: scored.filter((t) => (t.overallScore ?? 100) < 50).length,
      lastComputedAt,
    },
    therapists,
  };
}
