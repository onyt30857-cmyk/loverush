/**
 * Prometheus metrics 端点 · Phase 20.3
 *
 * GET /metrics
 *   返回 Prometheus 文本格式
 *   - 不走 auth 中间件（让 Prometheus 抓）
 *   - 但建议在 nginx 加 IP 白名单（仅监控机可访问）
 *
 * 暴露指标：
 *   - loverush_users_total{user_type=...}
 *   - loverush_orders_total{status=...}
 *   - loverush_active_offers           pending 派单
 *   - loverush_audit_pending           待审队列
 *   - loverush_tickets_open            未关工单
 *   - loverush_risk_unresolved         未处置风控事件
 *   - loverush_withdrawals_pending     待审提现
 *   - loverush_gmv_points_24h          24h GMV
 *   - loverush_dau_estimate            24h 活跃用户数（估算）
 *   - loverush_audit_events_24h{actor_role,action}   24h 内审计事件计数（多维）
 *   - loverush_audit_high_freq_actors_24h            24h 操作 ≥ 30 次的 admin 数
 *   - loverush_audit_targets_multi_actor_24h         24h 被 ≥ 2 个 admin 操作的目标数
 *   - loverush_audit_insert_failed_total             审计写库失败计数（进程级 counter）
 *
 * 注：每次抓取实时 SQL · 不缓存。Prometheus 抓取间隔建议 ≥ 30s 避免 DB 压力。
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { logger } from '../services/logger';
import { getAuditInsertFailedCount } from '../services/audit';

export const metricsRoutes = new Hono();

interface Metric {
  name: string;
  help: string;
  type: 'gauge' | 'counter';
  rows: Array<{ labels?: Record<string, string>; value: number }>;
}

function render(metrics: Metric[]): string {
  const lines: string[] = [];
  for (const m of metrics) {
    lines.push(`# HELP ${m.name} ${m.help}`);
    lines.push(`# TYPE ${m.name} ${m.type}`);
    for (const r of m.rows) {
      const labelStr = r.labels
        ? `{${Object.entries(r.labels)
            .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`)
            .join(',')}}`
        : '';
      lines.push(`${m.name}${labelStr} ${r.value}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function collect(): Promise<Metric[]> {
  const db = getDb();

  // 多个查询并发（同一 DB connection pool · postgres-js 自动多路复用）
  const [
    usersByType,
    ordersByStatus,
    pendingOffers,
    pendingAudit,
    openTickets,
    unresolvedRisk,
    pendingWithdraws,
    gmv24h,
    dau24h,
    auditEvents24h,
    auditHighFreqActors24h,
    auditTargetsMultiActor24h,
  ] = await Promise.all([
    db.execute(sql`SELECT user_type, COUNT(*)::int AS n FROM users GROUP BY user_type`),
    db.execute(sql`SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status`),
    db.execute(sql`SELECT COUNT(*)::int AS n FROM dispatch_offers WHERE status='pending' AND expires_at > NOW()`),
    db.execute(sql`SELECT COUNT(*)::int AS n FROM content_audit_records WHERE status='pending'`),
    db.execute(sql`SELECT COUNT(*)::int AS n FROM tickets WHERE status NOT IN ('resolved','closed')`),
    db.execute(sql`SELECT COUNT(*)::int AS n FROM risk_events WHERE resolved_at IS NULL`),
    db.execute(sql`SELECT COUNT(*)::int AS n FROM withdrawals WHERE status='pending'`),
    db.execute(sql`
      SELECT COALESCE(SUM(price_points), 0)::bigint AS gmv
      FROM orders
      WHERE status IN ('PAID','IN_SERVICE','COMPLETED','REVIEWED','REFUNDED')
        AND paid_at >= NOW() - INTERVAL '24 hours'
    `),
    db.execute(sql`
      SELECT COUNT(DISTINCT actor_user_id)::int AS n
      FROM analytics_events
      WHERE occurred_at >= NOW() - INTERVAL '24 hours'
    `),
    db.execute(sql`
      SELECT actor_role, action, COUNT(*)::int AS n
      FROM admin_audit_log
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY actor_role, action
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS n FROM (
        SELECT actor_user_id
        FROM admin_audit_log
        WHERE created_at >= NOW() - INTERVAL '24 hours'
          AND actor_user_id IS NOT NULL
        GROUP BY actor_user_id
        HAVING COUNT(*) >= 30
      ) t
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS n FROM (
        SELECT target_type, target_id
        FROM admin_audit_log
        WHERE created_at >= NOW() - INTERVAL '24 hours'
          AND target_id IS NOT NULL
        GROUP BY target_type, target_id
        HAVING COUNT(DISTINCT actor_user_id) >= 2
      ) t
    `),
  ]);

  return [
    {
      name: 'loverush_users_total',
      help: 'Total users by type',
      type: 'gauge',
      rows: (usersByType as unknown as Array<{ user_type: string; n: number }>).map((r) => ({
        labels: { user_type: r.user_type },
        value: r.n,
      })),
    },
    {
      name: 'loverush_orders_total',
      help: 'Total orders by status (lifetime)',
      type: 'gauge',
      rows: (ordersByStatus as unknown as Array<{ status: string; n: number }>).map((r) => ({
        labels: { status: r.status },
        value: r.n,
      })),
    },
    {
      name: 'loverush_active_offers',
      help: 'Pending dispatch offers (not expired)',
      type: 'gauge',
      rows: [{ value: (pendingOffers[0] as { n: number } | undefined)?.n ?? 0 }],
    },
    {
      name: 'loverush_audit_pending',
      help: 'Pending audit records',
      type: 'gauge',
      rows: [{ value: (pendingAudit[0] as { n: number } | undefined)?.n ?? 0 }],
    },
    {
      name: 'loverush_tickets_open',
      help: 'Open tickets (not resolved/closed)',
      type: 'gauge',
      rows: [{ value: (openTickets[0] as { n: number } | undefined)?.n ?? 0 }],
    },
    {
      name: 'loverush_risk_unresolved',
      help: 'Unresolved risk events',
      type: 'gauge',
      rows: [{ value: (unresolvedRisk[0] as { n: number } | undefined)?.n ?? 0 }],
    },
    {
      name: 'loverush_withdrawals_pending',
      help: 'Pending withdrawal requests',
      type: 'gauge',
      rows: [{ value: (pendingWithdraws[0] as { n: number } | undefined)?.n ?? 0 }],
    },
    {
      name: 'loverush_gmv_points_24h',
      help: 'GMV in points (paid orders) over last 24h',
      type: 'gauge',
      rows: [{ value: Number((gmv24h[0] as { gmv: string } | undefined)?.gmv ?? 0) }],
    },
    {
      name: 'loverush_dau_24h',
      help: 'Distinct active users over last 24h (from analytics_events)',
      type: 'gauge',
      rows: [{ value: (dau24h[0] as { n: number } | undefined)?.n ?? 0 }],
    },
    {
      name: 'loverush_audit_events_24h',
      help: 'Admin audit events in last 24h, broken down by actor_role and action',
      type: 'gauge',
      rows: (auditEvents24h as unknown as Array<{ actor_role: string; action: string; n: number }>).map(
        (r) => ({ labels: { actor_role: r.actor_role, action: r.action }, value: r.n }),
      ),
    },
    {
      name: 'loverush_audit_high_freq_actors_24h',
      help: 'Number of admin actors with >= 30 audit events in last 24h (potential anomaly)',
      type: 'gauge',
      rows: [{ value: (auditHighFreqActors24h[0] as { n: number } | undefined)?.n ?? 0 }],
    },
    {
      name: 'loverush_audit_targets_multi_actor_24h',
      help: 'Number of (target_type, target_id) touched by >= 2 distinct admins in last 24h',
      type: 'gauge',
      rows: [{ value: (auditTargetsMultiActor24h[0] as { n: number } | undefined)?.n ?? 0 }],
    },
    {
      name: 'loverush_audit_insert_failed_total',
      help: 'Process-level counter of failed audit row inserts (db write failed)',
      type: 'counter',
      rows: [{ value: getAuditInsertFailedCount() }],
    },
  ];
}

metricsRoutes.get('/', async (c) => {
  try {
    const metrics = await collect();
    const body = render(metrics);
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
    });
  } catch (err) {
    logger.error('metrics collect failed', { err });
    return new Response(`# error collecting metrics\nloverush_metrics_error 1\n`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
});
