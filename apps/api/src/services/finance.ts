/**
 * 资金看板 service · 运营总监视角
 *
 * 聚合源:
 * - points_account:积分大盘(总流通/冻结/账户数/活跃数)
 * - points_transaction:各类流水(充值/小费/橱窗/解锁/陪聊/批发/代理售卖/提现/退款)1/7/30 天
 * - withdrawals:待审批提现
 * - agent_wholesale_orders:待确认 USDT 批发
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';

export interface FinanceContext {
  db: Database;
}

export interface FlowRow {
  type: string;
  d1_count: number;
  d1_amount: number;
  d7_count: number;
  d7_amount: number;
  d30_count: number;
  d30_amount: number;
}

export interface FinanceOverview {
  points_circulation: {
    total_accounts: number;
    total_balance: number;
    total_frozen: number;
    avg_balance: number;
    active_accounts_30d: number;
  };
  flows: FlowRow[];
  pending: {
    withdrawals_count: number;
    withdrawals_amount_cents: number;
    wholesale_count: number;
    wholesale_points: number;
    wholesale_usdt_cents: number;
  };
  generated_at: string;
}

export async function getFinanceOverview(ctx: FinanceContext): Promise<FinanceOverview> {
  // ① 积分大盘
  const circ = (await ctx.db.execute(sql`
    SELECT
      COUNT(*)::int                                AS total_accounts,
      COALESCE(SUM(balance), 0)::bigint            AS total_balance,
      COALESCE(SUM(frozen), 0)::bigint             AS total_frozen,
      COALESCE(ROUND(AVG(balance)), 0)::bigint     AS avg_balance
    FROM points_account
  `)) as Array<{ total_accounts: number; total_balance: string; total_frozen: string; avg_balance: string }>;

  const active = (await ctx.db.execute(sql`
    SELECT COUNT(DISTINCT user_id)::int AS active_30d
    FROM points_transaction
    WHERE created_at >= NOW() - INTERVAL '30 days'
  `)) as Array<{ active_30d: number }>;

  // ② 各类型 1/7/30 天聚合(一次性 GROUP BY 全拿)
  const flows = (await ctx.db.execute(sql`
    SELECT type,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int                    AS d1_count,
      COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day'), 0)::bigint  AS d1_amount,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int                   AS d7_count,
      COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)::bigint AS d7_amount,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int                  AS d30_count,
      COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0)::bigint AS d30_amount
    FROM points_transaction
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY type
    ORDER BY d30_amount DESC
  `)) as Array<{
    type: string;
    d1_count: number;
    d1_amount: string;
    d7_count: number;
    d7_amount: string;
    d30_count: number;
    d30_amount: string;
  }>;

  // ③ 待处理(提现 + 批发)
  const pendingWith = (await ctx.db.execute(sql`
    SELECT COUNT(*)::int AS cnt, COALESCE(SUM(amount_cents), 0)::bigint AS amount
    FROM withdrawals
    WHERE status = 'pending'
  `)) as Array<{ cnt: number; amount: string }>;

  const pendingWS = (await ctx.db.execute(sql`
    SELECT
      COUNT(*)::int                                    AS cnt,
      COALESCE(SUM(points), 0)::bigint                 AS pts,
      COALESCE(SUM(usdt_amount_cents), 0)::bigint      AS usdt
    FROM agent_wholesale_orders
    WHERE status = 'pending'
  `)) as Array<{ cnt: number; pts: string; usdt: string }>;

  const c = circ[0];
  return {
    points_circulation: {
      total_accounts: c?.total_accounts ?? 0,
      total_balance: parseInt(c?.total_balance ?? '0', 10),
      total_frozen: parseInt(c?.total_frozen ?? '0', 10),
      avg_balance: parseInt(c?.avg_balance ?? '0', 10),
      active_accounts_30d: active[0]?.active_30d ?? 0,
    },
    flows: flows.map((f) => ({
      type: f.type,
      d1_count: f.d1_count,
      d1_amount: parseInt(f.d1_amount, 10),
      d7_count: f.d7_count,
      d7_amount: parseInt(f.d7_amount, 10),
      d30_count: f.d30_count,
      d30_amount: parseInt(f.d30_amount, 10),
    })),
    pending: {
      withdrawals_count: pendingWith[0]?.cnt ?? 0,
      withdrawals_amount_cents: parseInt(pendingWith[0]?.amount ?? '0', 10),
      wholesale_count: pendingWS[0]?.cnt ?? 0,
      wholesale_points: parseInt(pendingWS[0]?.pts ?? '0', 10),
      wholesale_usdt_cents: parseInt(pendingWS[0]?.usdt ?? '0', 10),
    },
    generated_at: new Date().toISOString(),
  };
}
