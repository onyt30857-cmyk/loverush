/**
 * AI 治理后台 service · M03 客户助理 + M06 技师分身
 *
 * 4 维:
 *   ① 红线监控  · ai_alter_redline_logs 聚合 + 高频技师 + 列表
 *   ② 成本看板  · ai_alter_messages.cost_usd_micros 拆 provider/model/scenario/技师
 *   ③ 代发审计  · ai_alter_messages JOIN messages.content_original 看原文
 *   ④ 客户画像  · customer_behavior_profile + customer_assistant_profile
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';

export interface AiAdminContext {
  db: Database;
}

// ──────────────── ① 红线监控 ────────────────

export async function getAiRedlineOverview(
  ctx: AiAdminContext,
  args: { rangeDays?: number } = {},
) {
  const days = args.rangeDays ?? 7;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  // 总览(按 flag × 1d/7d/30d)
  const byFlag = (await ctx.db.execute(sql`
    SELECT
      flag,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int   AS d1,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int  AS d7,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS d30,
      COUNT(*) FILTER (WHERE action = 'block')::int                          AS blocked,
      COUNT(*) FILTER (WHERE action = 'rewrite')::int                        AS rewritten,
      COUNT(*) FILTER (WHERE action = 'warn')::int                           AS warned,
      COUNT(*) FILTER (WHERE action = 'pass')::int                           AS passed
    FROM ai_alter_redline_logs
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY flag
    ORDER BY d30 DESC
  `)) as unknown as Array<{
    flag: string;
    d1: number;
    d7: number;
    d30: number;
    blocked: number;
    rewritten: number;
    warned: number;
    passed: number;
  }>;

  // 高频屡犯技师 Top 10(本期)
  const topTherapists = (await ctx.db.execute(sql`
    SELECT
      l.therapist_user_id,
      u.display_name,
      COUNT(*)::int                                            AS total,
      COUNT(*) FILTER (WHERE l.action = 'block')::int           AS blocked,
      array_agg(DISTINCT l.flag)                               AS flags_hit
    FROM ai_alter_redline_logs l
    JOIN users u ON u.id = l.therapist_user_id
    WHERE l.created_at >= ${since}
    GROUP BY l.therapist_user_id, u.display_name
    HAVING COUNT(*) >= 2
    ORDER BY total DESC
    LIMIT 10
  `)) as unknown as Array<{
    therapist_user_id: string;
    display_name: string | null;
    total: number;
    blocked: number;
    flags_hit: string[];
  }>;

  return {
    range_days: days,
    by_flag: byFlag,
    top_repeat_therapists: topTherapists,
    generated_at: new Date().toISOString(),
  };
}

export async function listAiRedlineLogs(
  ctx: AiAdminContext,
  args: {
    flag?: string;
    action?: string;
    therapistUserId?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const limit = args.limit ?? 50;
  const offset = args.offset ?? 0;

  const conds: ReturnType<typeof sql>[] = [];
  if (args.flag) conds.push(sql`l.flag = ${args.flag}`);
  if (args.action) conds.push(sql`l.action = ${args.action}`);
  if (args.therapistUserId) conds.push(sql`l.therapist_user_id = ${args.therapistUserId}`);

  const whereSql =
    conds.length === 0
      ? sql`1=1`
      : conds.reduce<ReturnType<typeof sql>>((acc, c, i) => (i === 0 ? sql`${c}` : sql`${acc} AND ${c}`), sql``);

  const rows = (await ctx.db.execute(sql`
    SELECT
      l.id,
      l.therapist_user_id,
      l.stage,
      l.flag,
      l.action,
      l.candidate_text,
      l.context_text,
      l.rewritten_text,
      l.confidence,
      l.created_at,
      u.display_name AS therapist_name
    FROM ai_alter_redline_logs l
    LEFT JOIN users u ON u.id = l.therapist_user_id
    WHERE ${whereSql}
    ORDER BY l.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<{
    id: string;
    therapist_user_id: string;
    therapist_name: string | null;
    stage: string;
    flag: string;
    action: string;
    candidate_text: string | null;
    context_text: string | null;
    rewritten_text: string | null;
    confidence: number;
    created_at: string;
  }>;

  return rows;
}

// ──────────────── ② 成本看板 ────────────────

export async function getAiCostOverview(
  ctx: AiAdminContext,
  args: { rangeDays?: number } = {},
) {
  const days = args.rangeDays ?? 7;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const prevSince = new Date(Date.now() - days * 2 * 24 * 3600 * 1000).toISOString();

  // 总成本 + WoW
  const totalsRows = (await ctx.db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= ${since})::int                                                    AS msg_count,
      COUNT(*) FILTER (WHERE created_at >= ${prevSince} AND created_at < ${since})::int                       AS msg_count_prev,
      COALESCE(SUM(cost_usd_micros) FILTER (WHERE created_at >= ${since}), 0)::bigint                          AS cost_micros,
      COALESCE(SUM(cost_usd_micros) FILTER (WHERE created_at >= ${prevSince} AND created_at < ${since}), 0)::bigint AS cost_micros_prev,
      COALESCE(SUM(input_tokens) FILTER (WHERE created_at >= ${since}), 0)::bigint                             AS input_tokens,
      COALESCE(SUM(output_tokens) FILTER (WHERE created_at >= ${since}), 0)::bigint                            AS output_tokens
    FROM ai_alter_messages
    WHERE created_at >= ${prevSince}
  `)) as unknown as Array<{
    msg_count: number;
    msg_count_prev: number;
    cost_micros: string;
    cost_micros_prev: string;
    input_tokens: string;
    output_tokens: string;
  }>;

  // 按 provider / model 拆
  const byModel = (await ctx.db.execute(sql`
    SELECT
      provider,
      model,
      COUNT(*)::int                                  AS msg_count,
      COALESCE(SUM(cost_usd_micros), 0)::bigint      AS cost_micros,
      COALESCE(SUM(input_tokens), 0)::bigint         AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint        AS output_tokens
    FROM ai_alter_messages
    WHERE created_at >= ${since}
    GROUP BY provider, model
    ORDER BY cost_micros DESC
  `)) as unknown as Array<{
    provider: string;
    model: string;
    msg_count: number;
    cost_micros: string;
    input_tokens: string;
    output_tokens: string;
  }>;

  // 按 scenario 拆
  const byScenario = (await ctx.db.execute(sql`
    SELECT
      scenario,
      COUNT(*)::int                                  AS msg_count,
      COALESCE(SUM(cost_usd_micros), 0)::bigint      AS cost_micros,
      COALESCE(AVG(cost_usd_micros), 0)::bigint      AS avg_cost_micros
    FROM ai_alter_messages
    WHERE created_at >= ${since}
    GROUP BY scenario
    ORDER BY cost_micros DESC
  `)) as unknown as Array<{
    scenario: string;
    msg_count: number;
    cost_micros: string;
    avg_cost_micros: string;
  }>;

  // 单技师 cost vs GMV(本期):cost 高但 GMV 低 = 烧钱不赚钱
  const topSpenders = (await ctx.db.execute(sql`
    WITH ai_cost AS (
      SELECT therapist_user_id, SUM(cost_usd_micros)::bigint AS ai_cost_micros, COUNT(*)::int AS ai_msg_count
      FROM ai_alter_messages
      WHERE created_at >= ${since}
      GROUP BY therapist_user_id
    ),
    gmv AS (
      SELECT therapist_user_id, COALESCE(SUM(price_points), 0)::bigint AS gmv_points, COUNT(*)::int AS paid_orders
      FROM orders
      WHERE status IN ('PAID','IN_SERVICE','COMPLETED','REVIEWED')
        AND paid_at >= ${since}
      GROUP BY therapist_user_id
    )
    SELECT
      a.therapist_user_id,
      u.display_name,
      a.ai_msg_count,
      a.ai_cost_micros,
      COALESCE(g.gmv_points, 0)::bigint     AS gmv_points,
      COALESCE(g.paid_orders, 0)::int       AS paid_orders
    FROM ai_cost a
    JOIN users u ON u.id = a.therapist_user_id
    LEFT JOIN gmv g ON g.therapist_user_id = a.therapist_user_id
    ORDER BY a.ai_cost_micros DESC
    LIMIT 20
  `)) as unknown as Array<{
    therapist_user_id: string;
    display_name: string | null;
    ai_msg_count: number;
    ai_cost_micros: string;
    gmv_points: string;
    paid_orders: number;
  }>;

  const t = totalsRows[0];
  return {
    range_days: days,
    totals: {
      msg_count: t?.msg_count ?? 0,
      msg_count_prev: t?.msg_count_prev ?? 0,
      cost_usd: parseInt(t?.cost_micros ?? '0', 10) / 1_000_000,
      cost_usd_prev: parseInt(t?.cost_micros_prev ?? '0', 10) / 1_000_000,
      input_tokens: parseInt(t?.input_tokens ?? '0', 10),
      output_tokens: parseInt(t?.output_tokens ?? '0', 10),
    },
    by_model: byModel.map((m) => ({
      provider: m.provider,
      model: m.model,
      msg_count: m.msg_count,
      cost_usd: parseInt(m.cost_micros, 10) / 1_000_000,
      input_tokens: parseInt(m.input_tokens, 10),
      output_tokens: parseInt(m.output_tokens, 10),
    })),
    by_scenario: byScenario.map((s) => ({
      scenario: s.scenario,
      msg_count: s.msg_count,
      cost_usd: parseInt(s.cost_micros, 10) / 1_000_000,
      avg_cost_usd: parseInt(s.avg_cost_micros, 10) / 1_000_000,
    })),
    top_spenders: topSpenders.map((r) => ({
      therapist_user_id: r.therapist_user_id,
      display_name: r.display_name,
      ai_msg_count: r.ai_msg_count,
      ai_cost_usd: parseInt(r.ai_cost_micros, 10) / 1_000_000,
      gmv_points: parseInt(r.gmv_points, 10),
      paid_orders: r.paid_orders,
      // ROI 比:GMV 积分(每积分约 $0.01) vs AI 成本 USD
      // 比值 >= 1 说明每花 1 美元 AI 至少带来 1 美元 GMV(健康)
      roi: parseInt(r.ai_cost_micros, 10) > 0
        ? Number((parseInt(r.gmv_points, 10) * 0.01 / (parseInt(r.ai_cost_micros, 10) / 1_000_000)).toFixed(2))
        : null,
    })),
    generated_at: new Date().toISOString(),
  };
}

// ──────────────── ③ 代发审计 ────────────────

export async function listAiMessages(
  ctx: AiAdminContext,
  args: {
    therapistUserId?: string;
    scenario?: string;
    hasRedline?: boolean;
    limit?: number;
    offset?: number;
  } = {},
) {
  const limit = args.limit ?? 50;
  const offset = args.offset ?? 0;

  const conds: ReturnType<typeof sql>[] = [];
  if (args.therapistUserId) conds.push(sql`a.therapist_user_id = ${args.therapistUserId}`);
  if (args.scenario) conds.push(sql`a.scenario = ${args.scenario}`);
  if (args.hasRedline) conds.push(sql`array_length(a.redline_flags, 1) > 0`);

  const whereSql =
    conds.length === 0
      ? sql`1=1`
      : conds.reduce<ReturnType<typeof sql>>((acc, c, i) => (i === 0 ? sql`${c}` : sql`${acc} AND ${c}`), sql``);

  const rows = (await ctx.db.execute(sql`
    SELECT
      a.id,
      a.therapist_user_id,
      u.display_name           AS therapist_name,
      a.scenario,
      a.provider,
      a.model,
      a.input_tokens,
      a.output_tokens,
      a.cost_usd_micros,
      a.simhash,
      a.redline_flags,
      a.prompt_version,
      a.created_at,
      m.content_original       AS message_content,
      m.conversation_id,
      m.sender_user_id
    FROM ai_alter_messages a
    LEFT JOIN messages m ON m.id = a.message_id
    LEFT JOIN users u ON u.id = a.therapist_user_id
    WHERE ${whereSql}
    ORDER BY a.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)) as unknown as Array<{
    id: string;
    therapist_user_id: string;
    therapist_name: string | null;
    scenario: string;
    provider: string;
    model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_usd_micros: number | null;
    simhash: number | null;
    redline_flags: string[] | null;
    prompt_version: string;
    created_at: string;
    message_content: string | null;
    conversation_id: string | null;
    sender_user_id: string | null;
  }>;

  // SimHash 高重复 flag:同技师近期 simhash 出现过 ≥3 次(>= 92% 相似)
  // 简化:统计 simhash 直接重复次数,客户端 mark
  const repeatedHashes = (await ctx.db.execute(sql`
    SELECT therapist_user_id, simhash, COUNT(*)::int AS n
    FROM ai_alter_messages
    WHERE simhash IS NOT NULL
      AND created_at >= NOW() - INTERVAL '30 days'
    GROUP BY therapist_user_id, simhash
    HAVING COUNT(*) >= 3
  `)) as unknown as Array<{ therapist_user_id: string; simhash: number; n: number }>;

  const repeatMap = new Map<string, number>();
  for (const r of repeatedHashes) {
    repeatMap.set(`${r.therapist_user_id}:${r.simhash}`, r.n);
  }

  return rows.map((r) => ({
    ...r,
    simhash_repeat_count:
      r.simhash !== null ? repeatMap.get(`${r.therapist_user_id}:${r.simhash}`) ?? 0 : 0,
  }));
}

// ──────────────── ④ 客户助理画像 ────────────────

export async function getAiAssistantProfilesOverview(ctx: AiAdminContext) {
  // 行为模式分布
  const byMode = (await ctx.db.execute(sql`
    SELECT
      behavior_mode,
      COUNT(*)::int                                                                     AS total,
      COALESCE(AVG(mode_confidence), 0)::int                                            AS avg_confidence,
      COALESCE(AVG(total_orders), 0)::int                                               AS avg_orders,
      COALESCE(AVG(repeat_rate), 0)::int                                                AS avg_repeat_rate,
      COUNT(*) FILTER (WHERE total_orders >= 3)::int                                    AS heavy_users,
      COUNT(*) FILTER (WHERE total_orders = 0)::int                                     AS no_orders
    FROM customer_behavior_profile
    GROUP BY behavior_mode
    ORDER BY total DESC
  `)) as unknown as Array<{
    behavior_mode: string;
    total: number;
    avg_confidence: number;
    avg_orders: number;
    avg_repeat_rate: number;
    heavy_users: number;
    no_orders: number;
  }>;

  // 助理配置统计
  const profileStatsRows = (await ctx.db.execute(sql`
    SELECT
      COUNT(*)::int                                                  AS total_profiles,
      COUNT(*) FILTER (WHERE proactive_greeting_enabled = 1)::int     AS greeting_on,
      COUNT(*) FILTER (WHERE learning_enabled = 1)::int               AS learning_on,
      COALESCE(AVG(memory_window_days), 0)::int                      AS avg_memory_days
    FROM customer_assistant_profile
  `)) as unknown as Array<{
    total_profiles: number;
    greeting_on: number;
    learning_on: number;
    avg_memory_days: number;
  }>;

  // 近 30d 助理活跃:近 30d 内有更新 session_preferences 的客户数
  const activeRows = (await ctx.db.execute(sql`
    SELECT COUNT(DISTINCT user_id)::int AS active_users
    FROM customer_session_preferences
    WHERE updated_at >= NOW() - INTERVAL '30 days'
  `)) as unknown as Array<{ active_users: number }>;

  return {
    by_mode: byMode,
    profile_stats: profileStatsRows[0] ?? {
      total_profiles: 0,
      greeting_on: 0,
      learning_on: 0,
      avg_memory_days: 0,
    },
    active_users_30d: activeRows[0]?.active_users ?? 0,
    generated_at: new Date().toISOString(),
  };
}

export async function getAiAssistantProfileDetail(
  ctx: AiAdminContext,
  customerId: string,
) {
  const profile = await ctx.db.query.customerAssistantProfile.findFirst({
    where: (t, { eq }) => eq(t.userId, customerId),
  });
  const behavior = await ctx.db.query.customerBehaviorProfile.findFirst({
    where: (t, { eq }) => eq(t.userId, customerId),
  });
  const recentSessions = await ctx.db.query.customerSessionPreferences.findMany({
    where: (t, { eq }) => eq(t.userId, customerId),
    orderBy: (t, { desc }) => [desc(t.updatedAt)],
    limit: 10,
  });
  return { profile, behavior, recent_sessions: recentSessions };
}

/**
 * M03 · 单客户 L1-L5 全量记忆详情(admin only)
 */
export async function getAiAssistantMemoryDetail(
  ctx: AiAdminContext,
  customerId: string,
) {
  const saved = await ctx.db.query.customerSavedMemory.findFirst({
    where: (t, { eq }) => eq(t.userId, customerId),
  });
  const rotating = await ctx.db.query.customerReferenceMemory.findMany({
    where: (t, { and, eq, isNull }) =>
      and(
        eq(t.userId, customerId),
        eq(t.memoryType, 'rotating'),
        isNull(t.validTo),
      ),
    orderBy: (t, { desc }) => [desc(t.importance), desc(t.recordedAt)],
    limit: 50,
  });
  const relation = await ctx.db.query.customerReferenceMemory.findMany({
    where: (t, { and, eq, isNull }) =>
      and(
        eq(t.userId, customerId),
        eq(t.memoryType, 'relation'),
        isNull(t.validTo),
      ),
    orderBy: (t, { desc }) => [desc(t.importance), desc(t.recordedAt)],
    limit: 50,
  });
  const diff = await ctx.db.query.customerReferenceMemory.findMany({
    where: (t, { and, eq, isNull }) =>
      and(
        eq(t.userId, customerId),
        eq(t.memoryType, 'diff'),
        isNull(t.validTo),
      ),
    orderBy: (t, { desc }) => [desc(t.importance), desc(t.recordedAt)],
    limit: 50,
  });
  const clusters = await ctx.db.query.customerInterestClusters.findMany({
    where: (t, { eq }) => eq(t.userId, customerId),
    orderBy: (t, { desc }) => [desc(t.weight)],
  });
  const outreach = await ctx.db.query.customerOutreachState.findFirst({
    where: (t, { eq }) => eq(t.userId, customerId),
  });
  return {
    saved,
    rotating,
    relation,
    diff,
    clusters,
    outreach,
    generated_at: new Date().toISOString(),
  };
}

/**
 * M03 · 主动 push + 沉默召回 KPI(admin only)
 */
export async function getAiOutreachOverview(ctx: AiAdminContext) {
  const totals = (await ctx.db.execute(sql`
    SELECT
      COUNT(*)::int                                                              AS total_users,
      COUNT(*) FILTER (WHERE proactive_enabled = false)::int                     AS proactive_opt_out,
      COUNT(*) FILTER (WHERE silent_recall_enabled = false)::int                 AS recall_opt_out,
      COUNT(*) FILTER (WHERE last_push_at >= NOW() - INTERVAL '7 days')::int     AS pushed_7d,
      COUNT(*) FILTER (WHERE last_recall_at >= NOW() - INTERVAL '30 days')::int  AS recalled_30d,
      COALESCE(AVG(weekly_push_count), 0)::numeric(5,2)                          AS avg_weekly_push,
      COALESCE(AVG(monthly_recall_count), 0)::numeric(5,2)                       AS avg_monthly_recall
    FROM customer_outreach_state
  `)) as unknown as Array<{
    total_users: number;
    proactive_opt_out: number;
    recall_opt_out: number;
    pushed_7d: number;
    recalled_30d: number;
    avg_weekly_push: string;
    avg_monthly_recall: string;
  }>;

  // 召回效果:召回后 7 天内有新单的占比
  const recallEffect = (await ctx.db.execute(sql`
    WITH recalled AS (
      SELECT user_id, last_recall_at
      FROM customer_outreach_state
      WHERE last_recall_at IS NOT NULL
        AND last_recall_at >= NOW() - INTERVAL '60 days'
    ),
    converted AS (
      SELECT DISTINCT r.user_id
      FROM recalled r
      JOIN orders o ON o.customer_id = r.user_id
       AND o.created_at >= r.last_recall_at
       AND o.created_at <  r.last_recall_at + INTERVAL '7 days'
    )
    SELECT
      (SELECT COUNT(*)::int FROM recalled)  AS recalled_total,
      (SELECT COUNT(*)::int FROM converted) AS recalled_converted
  `)) as unknown as Array<{ recalled_total: number; recalled_converted: number }>;

  return {
    totals: totals[0] ?? null,
    recall_effect_60d: recallEffect[0] ?? null,
    generated_at: new Date().toISOString(),
  };
}
