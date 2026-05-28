/**
 * 数据看板 · M14 完整版
 *
 * 三视图：
 * - 技师端 me：我的 KPI（订单 / 收入 / 评分 / 申诉 / AI 代发）
 * - 客户端 me：消费 / 收藏 / 邀请收益
 * - 运营大盘：DAU/MAU、订单漏斗、GMV、refund/dispute 比、城市分布
 *
 * 仅按时间窗 + group by 简单聚合，重型分析（cohort / retention）留 v2 接入 ClickHouse。
 */

import { sql } from 'drizzle-orm';
import { Database } from '@loverush/db';

export interface DashboardContext {
  db: Database;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

// ──────────────── 技师端看板 ────────────────

export interface TherapistDashboardArgs {
  therapistUserId: string;
  rangeDays?: number;
}

export async function therapistDashboard(ctx: DashboardContext, args: TherapistDashboardArgs) {
  const days = args.rangeDays ?? 30;
  const since = isoDaysAgo(days);

  const [orders] = await ctx.db.execute(sql`
    SELECT
      COUNT(*)::int                                                            AS total_orders,
      COUNT(*) FILTER (WHERE status IN ('PAID','IN_SERVICE','COMPLETED','REVIEWED'))::int AS paid_orders,
      COUNT(*) FILTER (WHERE status = 'COMPLETED' OR status = 'REVIEWED')::int AS completed_orders,
      COUNT(*) FILTER (WHERE status = 'CANCELLED')::int                        AS cancelled_orders,
      COUNT(*) FILTER (WHERE status = 'DISPUTED')::int                         AS disputed_orders,
      COUNT(*) FILTER (WHERE status = 'REFUNDED')::int                         AS refunded_orders,
      COALESCE(SUM(price_points) FILTER (WHERE status IN ('PAID','IN_SERVICE','COMPLETED','REVIEWED')), 0)::bigint AS gross_points
    FROM orders
    WHERE therapist_user_id = ${args.therapistUserId}
      AND created_at >= ${since}
  `) as Array<{
    total_orders: number;
    paid_orders: number;
    completed_orders: number;
    cancelled_orders: number;
    disputed_orders: number;
    refunded_orders: number;
    gross_points: string;
  }>;

  const [tips] = await ctx.db.execute(sql`
    SELECT COALESCE(SUM(net_points), 0)::bigint AS net_tip_points, COUNT(*)::int AS tip_count
    FROM tips
    WHERE therapist_user_id = ${args.therapistUserId}
      AND created_at >= ${since}
  `) as Array<{ net_tip_points: string; tip_count: number }>;

  const [shop] = await ctx.db.execute(sql`
    SELECT
      COUNT(*)::int                                              AS shop_orders,
      COALESCE(SUM(therapist_commission_points), 0)::bigint      AS shop_commission_points
    FROM shop_orders
    WHERE therapist_user_id = ${args.therapistUserId}
      AND status = 'paid'
      AND created_at >= ${since}
  `) as Array<{ shop_orders: number; shop_commission_points: string }>;

  const [reviewAgg] = await ctx.db.execute(sql`
    SELECT
      COUNT(*)::int                                  AS review_count,
      AVG(score_service)::int                        AS avg_score_service,
      AVG(score_appearance)::int                     AS avg_score_appearance,
      AVG(score_body)::int                           AS avg_score_body,
      COUNT(*) FILTER (WHERE appeal_status='pending')::int AS pending_appeals
    FROM reviews
    WHERE target_user_id = ${args.therapistUserId}
      AND is_hidden = 0
      AND created_at >= ${since}
  `) as Array<{
    review_count: number;
    avg_score_service: number;
    avg_score_appearance: number;
    avg_score_body: number;
    pending_appeals: number;
  }>;

  const [aiAlter] = await ctx.db.execute(sql`
    SELECT
      COUNT(*)::int                              AS messages,
      COALESCE(SUM(cost_usd_micros), 0)::bigint  AS cost_usd_micros
    FROM ai_alter_messages
    WHERE therapist_user_id = ${args.therapistUserId}
      AND created_at >= ${since}
  `) as Array<{ messages: number; cost_usd_micros: string }>;

  const [tickets] = await ctx.db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed'))::int AS open_tickets,
      COUNT(*)::int                                                    AS total_tickets
    FROM tickets
    WHERE target_user_id = ${args.therapistUserId}
      AND opened_at >= ${since}
  `) as Array<{ open_tickets: number; total_tickets: number }>;

  const [earning] = await ctx.db.execute(sql`
    SELECT available_cents, pending_cents, withdrawn_cents, tip_earnings_cents,
           shop_commission_cents, invite_rewards_cents
    FROM therapist_earnings
    WHERE therapist_user_id = ${args.therapistUserId}
  `) as Array<{
    available_cents: string;
    pending_cents: string;
    withdrawn_cents: string;
    tip_earnings_cents: string;
    shop_commission_cents: string;
    invite_rewards_cents: string;
  }>;

  return {
    range_days: days,
    orders: orders ?? {},
    tips: tips ?? { net_tip_points: 0, tip_count: 0 },
    shop: shop ?? { shop_orders: 0, shop_commission_points: 0 },
    reviews: reviewAgg ?? {},
    ai_alter: aiAlter ?? {},
    tickets: tickets ?? {},
    earnings: earning ?? null,
  };
}

// ──────────────── 客户端看板 ────────────────

export async function customerDashboard(
  ctx: DashboardContext,
  args: { customerId: string; rangeDays?: number },
) {
  const days = args.rangeDays ?? 90;
  const since = isoDaysAgo(days);

  const [orders] = await ctx.db.execute(sql`
    SELECT
      COUNT(*)::int                                                                  AS total_orders,
      COUNT(*) FILTER (WHERE status IN ('PAID','IN_SERVICE','COMPLETED','REVIEWED'))::int AS paid_orders,
      COALESCE(SUM(price_points), 0)::bigint                                          AS total_spent_points
    FROM orders
    WHERE customer_id = ${args.customerId}
      AND created_at >= ${since}
  `) as Array<{ total_orders: number; paid_orders: number; total_spent_points: string }>;

  const [tipsGiven] = await ctx.db.execute(sql`
    SELECT COALESCE(SUM(gross_points), 0)::bigint AS tip_points, COUNT(*)::int AS tip_count
    FROM tips WHERE customer_id = ${args.customerId} AND created_at >= ${since}
  `) as Array<{ tip_points: string; tip_count: number }>;

  const [rels] = await ctx.db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE tier IN ('L2','L3'))::int AS favorite_count,
      COUNT(*)::int                                    AS total_relations
    FROM customer_relationship_profile WHERE customer_id = ${args.customerId}
  `) as Array<{ favorite_count: number; total_relations: number }>;

  const [points] = await ctx.db.execute(sql`
    SELECT balance, frozen, total_in, total_out
    FROM points_account WHERE user_id = ${args.customerId}
  `) as Array<{ balance: string; frozen: string; total_in: string; total_out: string }>;

  const [inviteReward] = await ctx.db.execute(sql`
    SELECT COALESCE(SUM(amount), 0)::bigint AS invite_reward_points
    FROM points_transaction
    WHERE user_id = ${args.customerId}
      AND type = 'INVITE_REWARD'
      AND direction = 'IN'
  `) as Array<{ invite_reward_points: string }>;

  return {
    range_days: days,
    orders: orders ?? {},
    tips_given: tipsGiven ?? {},
    relationships: rels ?? {},
    points: points ?? null,
    invite_reward: inviteReward ?? {},
  };
}

// ──────────────── 运营大盘 ────────────────

export async function adminDashboard(ctx: DashboardContext, args: { rangeDays?: number } = {}) {
  const days = args.rangeDays ?? 7;
  const since = isoDaysAgo(days);
  const prevSince = isoDaysAgo(days * 2);

  // DAU / WAU / MAU（基于 analytics_events 中 actor_user_id distinct）
  const [act] = await ctx.db.execute(sql`
    SELECT
      COUNT(DISTINCT actor_user_id) FILTER (WHERE occurred_at >= ${isoDaysAgo(1)})::int  AS dau,
      COUNT(DISTINCT actor_user_id) FILTER (WHERE occurred_at >= ${isoDaysAgo(7)})::int  AS wau,
      COUNT(DISTINCT actor_user_id) FILTER (WHERE occurred_at >= ${isoDaysAgo(30)})::int AS mau
    FROM analytics_events
  `) as Array<{ dau: number; wau: number; mau: number }>;

  // 订单漏斗
  const funnel = await ctx.db.execute(sql`
    SELECT status, COUNT(*)::int AS cnt
    FROM orders
    WHERE created_at >= ${since}
    GROUP BY status
  `);

  // GMV（PAID 起算积分）+ 上一周期对比
  const [gmv] = await ctx.db.execute(sql`
    SELECT
      COALESCE(SUM(price_points) FILTER (WHERE paid_at >= ${since}), 0)::bigint                          AS gmv_points,
      COALESCE(SUM(price_points) FILTER (WHERE paid_at >= ${prevSince} AND paid_at < ${since}), 0)::bigint AS gmv_points_prev,
      COUNT(*) FILTER (WHERE paid_at >= ${since})::int                                                   AS paid_orders,
      COUNT(*) FILTER (WHERE paid_at >= ${prevSince} AND paid_at < ${since})::int                        AS paid_orders_prev
    FROM orders
    WHERE status IN ('PAID','IN_SERVICE','COMPLETED','REVIEWED','REFUNDED')
      AND paid_at >= ${prevSince}
  `) as Array<{ gmv_points: string; gmv_points_prev: string; paid_orders: number; paid_orders_prev: number }>;

  // refund / dispute 比
  const [rd] = await ctx.db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'COMPLETED' OR status = 'REVIEWED')::int AS completed,
      COUNT(*) FILTER (WHERE status = 'REFUNDED')::int                         AS refunded,
      COUNT(*) FILTER (WHERE status = 'DISPUTED')::int                         AS disputed
    FROM orders
    WHERE created_at >= ${since}
  `) as Array<{ completed: number; refunded: number; disputed: number }>;

  // 用户分布
  const userDist = await ctx.db.execute(sql`
    SELECT user_type, COUNT(*)::int AS cnt FROM users GROUP BY user_type
  `);

  // 城市分布
  const cityDist = await ctx.db.execute(sql`
    SELECT service_city AS city, COUNT(*)::int AS therapist_count
    FROM therapists
    WHERE service_city IS NOT NULL
    GROUP BY service_city
    ORDER BY therapist_count DESC
    LIMIT 20
  `);

  // ━━━━━━━━━━ P1 升级:新增 / 留存 / 警报 / 注册漏斗 ━━━━━━━━━━

  // ① 新增用户(本期 vs 上期)按 user_type 拆分
  const newUsers = await ctx.db.execute(sql`
    SELECT
      user_type,
      COUNT(*) FILTER (WHERE created_at >= ${since})::int                                      AS curr,
      COUNT(*) FILTER (WHERE created_at >= ${prevSince} AND created_at < ${since})::int         AS prev
    FROM users
    GROUP BY user_type
  `);

  // ② 注册 → 核验 → 下单 → 支付 → 完成 → 评价 转化漏斗
  //    分母:本期内注册的所有 customer
  const [signupFunnel] = await ctx.db.execute(sql`
    WITH cohort AS (
      SELECT id FROM users WHERE user_type = 'customer' AND created_at >= ${since}
    )
    SELECT
      (SELECT COUNT(*) FROM cohort)::int                                                                      AS registered,
      (SELECT COUNT(DISTINCT customer_id) FROM orders WHERE customer_id IN (SELECT id FROM cohort))::int       AS created_order,
      (SELECT COUNT(DISTINCT customer_id) FROM orders
        WHERE customer_id IN (SELECT id FROM cohort) AND status IN ('PAID','IN_SERVICE','COMPLETED','REVIEWED'))::int AS paid_order,
      (SELECT COUNT(DISTINCT customer_id) FROM orders
        WHERE customer_id IN (SELECT id FROM cohort) AND status IN ('COMPLETED','REVIEWED'))::int               AS completed_order,
      (SELECT COUNT(DISTINCT customer_id) FROM orders
        WHERE customer_id IN (SELECT id FROM cohort) AND status = 'REVIEWED')::int                              AS reviewed_order
  `) as Array<{
    registered: number;
    created_order: number;
    paid_order: number;
    completed_order: number;
    reviewed_order: number;
  }>;

  // ③ 留存 D1 / D7 / D30(基于本期注册用户在 D+N 当天是否还有 analytics 事件)
  //    简化:活跃日 = 注册后第 N 天 ±1 天窗口内有事件
  const [retention] = await ctx.db.execute(sql`
    WITH cohort AS (
      SELECT id, created_at FROM users WHERE created_at >= ${since}
    )
    SELECT
      (SELECT COUNT(*) FROM cohort)::int AS cohort_size,
      (SELECT COUNT(DISTINCT u.id) FROM cohort u
        JOIN analytics_events e ON e.actor_user_id = u.id
        WHERE e.occurred_at >= u.created_at + INTERVAL '1 day'
          AND e.occurred_at <  u.created_at + INTERVAL '2 days'
      )::int AS d1_active,
      (SELECT COUNT(DISTINCT u.id) FROM cohort u
        JOIN analytics_events e ON e.actor_user_id = u.id
        WHERE e.occurred_at >= u.created_at + INTERVAL '7 days'
          AND e.occurred_at <  u.created_at + INTERVAL '8 days'
      )::int AS d7_active,
      (SELECT COUNT(DISTINCT u.id) FROM cohort u
        JOIN analytics_events e ON e.actor_user_id = u.id
        WHERE e.occurred_at >= u.created_at + INTERVAL '30 days'
          AND e.occurred_at <  u.created_at + INTERVAL '31 days'
      )::int AS d30_active
  `) as Array<{ cohort_size: number; d1_active: number; d7_active: number; d30_active: number }>;

  // ④ 运营警报:运营总监最关心的"需立即处理"信号
  const [alerts] = await ctx.db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM tickets WHERE status NOT IN ('resolved','closed'))::int      AS open_tickets,
      (SELECT COUNT(*) FROM content_audit_records WHERE status = 'pending')::int          AS pending_audits,
      (SELECT COUNT(*) FROM therapists
        WHERE verification_status IN ('pending','in_review'))::int                        AS pending_verifications,
      (SELECT COUNT(*) FROM withdrawals WHERE status = 'pending')::int                    AS pending_withdrawals,
      (SELECT COUNT(*) FROM agent_wholesale_orders WHERE status = 'pending')::int         AS pending_wholesale,
      (SELECT COUNT(*) FROM orders WHERE status = 'DISPUTED')::int                        AS disputed_orders,
      (SELECT COUNT(*) FROM risk_events WHERE resolution IS NULL)::int                    AS unresolved_risk
  `) as Array<{
    open_tickets: number;
    pending_audits: number;
    pending_verifications: number;
    pending_withdrawals: number;
    pending_wholesale: number;
    disputed_orders: number;
    unresolved_risk: number;
  }>;

  return {
    range_days: days,
    activity: act ?? {},
    funnel,
    gmv: gmv ?? {},
    refund_dispute: rd ?? {},
    user_distribution: userDist,
    city_distribution: cityDist,
    new_users: newUsers,
    signup_funnel: signupFunnel ?? {},
    retention: retention ?? {},
    alerts: alerts ?? {},
  };
}
