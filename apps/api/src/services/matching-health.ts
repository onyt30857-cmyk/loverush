/**
 * 派单健康 service · 运营总监 · 监控匹配质量
 *
 * 5 个维度聚合:
 *   ① 订单漏斗流失:各 status 数量 + DRAFT 滞留(创建后 24h+ 未提交)
 *   ② 城市供需比:每城市 (技师数, 本期订单数, 供需指数=订单/技师)
 *   ③ 技师热度 Top/Bottom:近 N 天被浏览次数(analytics events ref_type=therapist)
 *   ④ 响应时长:创建 → 支付 (created_at → paid_at) P50 / P95
 *   ⑤ 容量警示:verified 技师 cooling_status 分布
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';

export interface MatchingHealthContext {
  db: Database;
}

export interface MatchingHealth {
  range_days: number;
  funnel: {
    DRAFT: number;
    PENDING_CONFIRM: number;
    LOCKED: number;
    PAID: number;
    IN_SERVICE: number;
    COMPLETED: number;
    REVIEWED: number;
    CANCELLED: number;
    DISPUTED: number;
    REFUNDED: number;
    CLOSED: number;
    draft_stale_24h: number;
  };
  city_supply_demand: Array<{
    city: string;
    therapists: number;
    orders: number;
    demand_per_therapist: number;
  }>;
  therapist_heat: {
    hot: Array<{ therapist_user_id: string; display_name: string | null; views: number; orders: number }>;
    cold: Array<{ therapist_user_id: string; display_name: string | null; views: number; orders: number }>;
  };
  response_time: {
    p50_seconds: number | null;
    p95_seconds: number | null;
    sample_size: number;
  };
  capacity: {
    total_verified: number;
    active: number;
    cooling: number;
    suspended: number;
  };
  generated_at: string;
}

export async function getMatchingHealth(
  ctx: MatchingHealthContext,
  args: { rangeDays?: number } = {},
): Promise<MatchingHealth> {
  const days = args.rangeDays ?? 7;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  // ① 订单状态分布 + DRAFT 滞留
  const funnelRows = (await ctx.db.execute(sql`
    SELECT status, COUNT(*)::int AS cnt
    FROM orders
    WHERE created_at >= ${since}
    GROUP BY status
  `)) as unknown as Array<{ status: string; cnt: number }>;

  const [stale] = (await ctx.db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM orders
    WHERE status = 'DRAFT' AND created_at < NOW() - INTERVAL '24 hours'
  `)) as unknown as Array<{ cnt: number }>;

  const funnel: MatchingHealth['funnel'] = {
    DRAFT: 0,
    PENDING_CONFIRM: 0,
    LOCKED: 0,
    PAID: 0,
    IN_SERVICE: 0,
    COMPLETED: 0,
    REVIEWED: 0,
    CANCELLED: 0,
    DISPUTED: 0,
    REFUNDED: 0,
    CLOSED: 0,
    draft_stale_24h: stale?.cnt ?? 0,
  };
  for (const row of funnelRows) {
    if (row.status in funnel) {
      (funnel as Record<string, number>)[row.status] = row.cnt;
    }
  }

  // ② 城市供需比(每城市:技师数 + 本期订单数)
  const citySupplyDemand = (await ctx.db.execute(sql`
    SELECT
      t.service_city AS city,
      COUNT(DISTINCT t.user_id)::int AS therapists,
      COALESCE(
        (SELECT COUNT(*) FROM orders o
          WHERE o.therapist_user_id IN (
            SELECT t2.user_id FROM therapists t2 WHERE t2.service_city = t.service_city
          )
          AND o.created_at >= ${since}
        ), 0
      )::int AS orders
    FROM therapists t
    WHERE t.service_city IS NOT NULL
    GROUP BY t.service_city
    ORDER BY therapists DESC
    LIMIT 30
  `)) as unknown as Array<{ city: string; therapists: number; orders: number }>;

  const cityWithRatio = citySupplyDemand.map((c) => ({
    city: c.city,
    therapists: c.therapists,
    orders: c.orders,
    demand_per_therapist: c.therapists > 0 ? Number((c.orders / c.therapists).toFixed(2)) : 0,
  }));

  // ③ 技师热度(被浏览次数,基于 analytics_events ref_type=therapist)
  //    若无 events,fallback 用 orders 数量
  const heatRows = (await ctx.db.execute(sql`
    SELECT
      t.user_id AS therapist_user_id,
      u.display_name,
      COALESCE(
        (SELECT COUNT(*) FROM analytics_events e
          WHERE e.ref_type = 'therapist' AND e.ref_id = t.id
            AND e.occurred_at >= ${since}
        ), 0
      )::int AS views,
      COALESCE(
        (SELECT COUNT(*) FROM orders o WHERE o.therapist_user_id = t.user_id AND o.created_at >= ${since}), 0
      )::int AS orders
    FROM therapists t
    JOIN users u ON u.id = t.user_id
    WHERE t.verification_status = 'passed'
    ORDER BY views DESC, orders DESC
    LIMIT 100
  `)) as unknown as Array<{
    therapist_user_id: string;
    display_name: string | null;
    views: number;
    orders: number;
  }>;

  const hot = heatRows.slice(0, 10);
  // 冷门:把 views 升序排在最后一些
  const cold = [...heatRows].sort((a, b) => a.views - b.views || a.orders - b.orders).slice(0, 10);

  // ④ 响应时长(create → paid 间隔的 P50/P95)
  const [rt] = (await ctx.db.execute(sql`
    SELECT
      PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (paid_at - created_at)))::int  AS p50,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (paid_at - created_at)))::int  AS p95,
      COUNT(*)::int                                                                                  AS n
    FROM orders
    WHERE paid_at IS NOT NULL
      AND paid_at >= ${since}
  `)) as unknown as Array<{ p50: number | null; p95: number | null; n: number }>;

  // ⑤ 容量警示(verified 技师的 cooling_status 分布)
  const [cap] = (await ctx.db.execute(sql`
    SELECT
      COUNT(*)::int                                          AS total_verified,
      COUNT(*) FILTER (WHERE cooling_status = 'active')::int AS active,
      COUNT(*) FILTER (WHERE cooling_status = 'cooling')::int AS cooling,
      COUNT(*) FILTER (WHERE cooling_status = 'suspended')::int AS suspended
    FROM therapists
    WHERE verification_status = 'passed'
  `)) as unknown as Array<{ total_verified: number; active: number; cooling: number; suspended: number }>;

  return {
    range_days: days,
    funnel,
    city_supply_demand: cityWithRatio,
    therapist_heat: { hot, cold },
    response_time: {
      p50_seconds: rt?.p50 ?? null,
      p95_seconds: rt?.p95 ?? null,
      sample_size: rt?.n ?? 0,
    },
    capacity: {
      total_verified: cap?.total_verified ?? 0,
      active: cap?.active ?? 0,
      cooling: cap?.cooling ?? 0,
      suspended: cap?.suspended ?? 0,
    },
    generated_at: new Date().toISOString(),
  };
}
