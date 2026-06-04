/**
 * M04 · AI 智能匹配监控 · admin
 *
 * GET /admin/match/stats
 *   - 匹配调用量 + llm/rule 降级率(analytics_events · match_conversational · 近 30d)
 *   - 技师 persona 覆盖 / 客户画像覆盖 / onboarding 破冰完成
 *
 * 注意:这是「AI 语义匹配」监控,区别于 /admin/matching-health(订单派单 dispatch)
 * 权限:admin / cs / auditor / ops
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';

export const adminMatchRoutes = new Hono();
adminMatchRoutes.use('*', requireAuth, requireRole(['admin', 'cs', 'auditor', 'ops']));

adminMatchRoutes.get('/stats', async (c) => {
  const db = getDb();

  const byMode = (await db.execute(sql`
    SELECT properties->>'mode' AS mode, count(*)::int AS n
    FROM analytics_events
    WHERE event_name = 'match_conversational' AND occurred_at > now() - interval '30 days'
    GROUP BY properties->>'mode'
  `)) as unknown as Array<{ mode: string | null; n: number }>;

  const personaRows = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE match_persona IS NOT NULL)::int AS with_persona,
      count(*) FILTER (WHERE verification_status = 'passed')::int AS passed
    FROM therapists
  `)) as unknown as Array<{ with_persona: number; passed: number }>;

  const profileRows = (await db.execute(sql`
    SELECT count(*)::int AS n FROM customer_master_preferences
  `)) as unknown as Array<{ n: number }>;

  const custRows = (await db.execute(sql`
    SELECT count(*)::int AS n FROM users WHERE user_type = 'customer'
  `)) as unknown as Array<{ n: number }>;

  const onbRows = (await db.execute(sql`
    SELECT count(*) FILTER (WHERE (facts->>'onboarding_complete') = 'true')::int AS completed
    FROM customer_saved_memory
  `)) as unknown as Array<{ completed: number }>;

  const modeMap: Record<string, number> = {};
  let totalCalls = 0;
  for (const r of byMode) {
    modeMap[r.mode ?? 'unknown'] = r.n;
    totalCalls += r.n;
  }
  const persona = personaRows[0] ?? { with_persona: 0, passed: 0 };
  const customers = custRows[0]?.n ?? 0;

  return c.json({
    data: {
      window: '30d',
      matchCalls: {
        total: totalCalls,
        llm: modeMap.llm ?? 0,
        rule: modeMap.rule ?? 0,
        empty: modeMap.empty ?? 0,
        llmRate: totalCalls ? Math.round(((modeMap.llm ?? 0) / totalCalls) * 100) : 0,
      },
      personaCoverage: { withPersona: persona.with_persona, passed: persona.passed },
      profileCoverage: { withMasterPref: profileRows[0]?.n ?? 0, customers },
      onboarding: { completed: onbRows[0]?.completed ?? 0, customers },
    },
  });
});
