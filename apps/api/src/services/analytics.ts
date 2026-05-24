/**
 * 埋点服务 · M14
 *
 * track(event)：写入 analytics_events
 * aggregateDaily：按 (bucketDate, eventName, dimension?) 预聚合（cron 调）
 * query：按多维度查计数
 */

import { eq, and, gte, lte, sql } from 'drizzle-orm';
import {
  Database,
  analyticsEvents,
  analyticsDailyAgg,
} from '@loverush/db';

export interface AnalyticsContext {
  db: Database;
}

export interface TrackArgs {
  eventName: string;
  eventCategory: string;
  actorUserId?: string;
  actorRole?: 'customer' | 'therapist' | 'system' | 'admin';
  refType?: string;
  refId?: string;
  properties?: Record<string, unknown>;
  locale?: string;
  ipHash?: string;
  deviceFingerprintHash?: string;
  occurredAt?: Date;
}

export async function track(ctx: AnalyticsContext, args: TrackArgs): Promise<void> {
  await ctx.db.insert(analyticsEvents).values({
    eventName: args.eventName,
    eventCategory: args.eventCategory,
    actorUserId: args.actorUserId,
    actorRole: args.actorRole,
    refType: args.refType,
    refId: args.refId,
    properties: args.properties ?? {},
    locale: args.locale,
    ipHash: args.ipHash,
    deviceFingerprintHash: args.deviceFingerprintHash,
    occurredAt: args.occurredAt ?? new Date(),
  });
}

export interface QueryArgs {
  eventName?: string;
  eventCategory?: string;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;
}

export async function queryDailyAgg(ctx: AnalyticsContext, q: QueryArgs) {
  const conds = [];
  if (q.eventName) conds.push(eq(analyticsDailyAgg.eventName, q.eventName));
  if (q.fromDate) conds.push(gte(analyticsDailyAgg.bucketDate, q.fromDate));
  if (q.toDate) conds.push(lte(analyticsDailyAgg.bucketDate, q.toDate));
  return ctx.db.query.analyticsDailyAgg.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: [analyticsDailyAgg.bucketDate],
    limit: 1000,
  });
}

/** 按天聚合昨日数据（cron 调） */
export async function aggregateYesterday(ctx: AnalyticsContext): Promise<number> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const yesterdayStart = new Date(today.getTime() - 24 * 3600 * 1000);
  const yesterdayEnd = today;
  const bucketDate = yesterdayStart.toISOString().slice(0, 10);

  // 简单按 eventName 计数
  const rows = await ctx.db.execute(sql`
    SELECT event_name, COUNT(*)::int AS cnt, COUNT(DISTINCT actor_user_id)::int AS u
    FROM analytics_events
    WHERE occurred_at >= ${yesterdayStart} AND occurred_at < ${yesterdayEnd}
    GROUP BY event_name
  `);

  let inserted = 0;
  for (const r of rows as unknown as Array<{ event_name: string; cnt: number; u: number }>) {
    await ctx.db
      .insert(analyticsDailyAgg)
      .values({
        bucketDate,
        eventName: r.event_name,
        countTotal: r.cnt,
        countUnique: r.u,
      })
      .onConflictDoNothing();
    inserted++;
  }
  return inserted;
}
