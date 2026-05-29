/**
 * 技师 AI 风控聚合 · admin · (T4)
 *
 * GET /admin/users/:id/therapist-ai-risk
 *
 * 单技师维度聚合:
 *   - 红线触发(ai_alter_redline_logs)· 30 天统计 + 最近 20 条
 *   - AI 代发(ai_alter_messages)· 30 天 token/cost 统计 + 最近 20 条
 *
 * 权限:admin / cs / auditor / ops · 全角色可见(都是 meta + AI 治理)
 */

import { Hono } from 'hono';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { aiAlterMessages, aiAlterRedlineLogs, users } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

export const adminTherapistAiRiskRoutes = new Hono();
adminTherapistAiRiskRoutes.use('*', requireAuth, requireRole(['admin', 'cs', 'auditor', 'ops']));

adminTherapistAiRiskRoutes.get('/:id/therapist-ai-risk', async (c) => {
  const id = c.req.param('id');
  const db = getDb();

  const u = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: { id: true, userType: true },
  });
  if (!u) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'user not found');
  if (u.userType !== 'therapist') {
    throw HttpError.badRequest(ErrorCode.E0001_INVALID_PARAM, 'not a therapist');
  }

  const since30d = sql`NOW() - INTERVAL '30 days'`;

  // 并行拉
  const [redlineStats, redlineRecent, msgStats, msgRecent] = await Promise.all([
    // 红线 30 天分类计数
    db
      .select({
        flag: aiAlterRedlineLogs.flag,
        action: aiAlterRedlineLogs.action,
        n: sql<number>`count(*)::int`,
      })
      .from(aiAlterRedlineLogs)
      .where(and(eq(aiAlterRedlineLogs.therapistUserId, id), gte(aiAlterRedlineLogs.createdAt, since30d)))
      .groupBy(aiAlterRedlineLogs.flag, aiAlterRedlineLogs.action),
    // 红线最近 20 条
    db
      .select({
        id: aiAlterRedlineLogs.id,
        stage: aiAlterRedlineLogs.stage,
        flag: aiAlterRedlineLogs.flag,
        action: aiAlterRedlineLogs.action,
        confidence: aiAlterRedlineLogs.confidence,
        candidateText: aiAlterRedlineLogs.candidateText,
        rewrittenText: aiAlterRedlineLogs.rewrittenText,
        createdAt: aiAlterRedlineLogs.createdAt,
      })
      .from(aiAlterRedlineLogs)
      .where(eq(aiAlterRedlineLogs.therapistUserId, id))
      .orderBy(desc(aiAlterRedlineLogs.createdAt))
      .limit(20),
    // AI 代发 30 天统计:总条数 + token + cost
    db
      .select({
        total: sql<number>`count(*)::int`,
        totalInputTokens: sql<number>`COALESCE(SUM(input_tokens), 0)::int`,
        totalOutputTokens: sql<number>`COALESCE(SUM(output_tokens), 0)::int`,
        totalCostUsdMicros: sql<number>`COALESCE(SUM(cost_usd_micros), 0)::bigint`,
      })
      .from(aiAlterMessages)
      .where(and(eq(aiAlterMessages.therapistUserId, id), gte(aiAlterMessages.createdAt, since30d))),
    // AI 代发最近 20 条
    db
      .select({
        id: aiAlterMessages.id,
        scenario: aiAlterMessages.scenario,
        provider: aiAlterMessages.provider,
        model: aiAlterMessages.model,
        inputTokens: aiAlterMessages.inputTokens,
        outputTokens: aiAlterMessages.outputTokens,
        costUsdMicros: aiAlterMessages.costUsdMicros,
        simhash: aiAlterMessages.simhash,
        redlineFlags: aiAlterMessages.redlineFlags,
        createdAt: aiAlterMessages.createdAt,
      })
      .from(aiAlterMessages)
      .where(eq(aiAlterMessages.therapistUserId, id))
      .orderBy(desc(aiAlterMessages.createdAt))
      .limit(20),
  ]);

  return c.json({
    data: {
      redline: {
        stats_30d: redlineStats,
        recent: redlineRecent,
      },
      alterMessages: {
        stats_30d: msgStats[0] ?? { total: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsdMicros: 0 },
        recent: msgRecent,
      },
    },
  });
});
