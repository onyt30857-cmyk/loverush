/**
 * AI 助理 · 客户详情聚合 · admin
 *
 * GET /admin/users/:id/assistant
 *
 * 聚合一个客户名下所有 AI 助理数据(8 张表 + 新增 chat log):
 *   1. 助理身份 profile(customer_assistant_profile)
 *   2. L1+L2 Saved Memory(customer_saved_memory)
 *   3. L3 Rotating / L4 Relation / L5 Diff(customer_reference_memory)
 *   4. 兴趣簇(customer_interest_clusters)
 *   5. 当前 session 状态(customer_session_preferences)
 *   6. 行为画像(customer_behavior_profile)
 *   7. Outreach 配置(customer_outreach_state)
 *   8. 会话历史(customer_assistant_sessions · count + 最近 5)
 *   9. 对话日志(assistant_chat_log · count + 最近 5,A1 已上)
 *
 * 权限:admin / cs / auditor 可见;ops 仅 metadata(facts/snippet/content 全 null)
 * 用途:admin 客户详情页 '助理记忆' tab,客服看问题时一目了然
 */

import { Hono } from 'hono';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  customerAssistantProfile,
  customerSavedMemory,
  customerReferenceMemory,
  customerInterestClusters,
  customerSessionPreferences,
  customerBehaviorProfile,
  customerOutreachState,
  customerAssistantSessions,
  assistantChatLog,
  users,
} from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';

export const adminCustomerAssistantRoutes = new Hono();
adminCustomerAssistantRoutes.use('*', requireAuth, requireRole(['admin', 'cs', 'auditor', 'ops']));

function canSeeContent(roles: string[]): boolean {
  return roles.some((r) => r === 'admin' || r === 'cs' || r === 'auditor');
}

adminCustomerAssistantRoutes.get('/:id/assistant', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const roles = (c.get('userRoles' as never) as string[] | undefined) ?? [];
  const showContent = canSeeContent(roles);

  // 验证用户存在
  const u = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: { id: true, displayName: true, userType: true, locale: true, createdAt: true },
  });
  if (!u) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'user not found');

  // 并行拉所有
  const [
    profile,
    savedMem,
    refRotating,
    refRelation,
    refDiff,
    clusters,
    sessionPref,
    behavior,
    outreach,
    sessionsRecent,
    sessionsCount,
    chatLogRecent,
    chatLogCount,
  ] = await Promise.all([
    db.query.customerAssistantProfile.findFirst({
      where: eq(customerAssistantProfile.userId, id),
    }),
    db.query.customerSavedMemory.findFirst({
      where: eq(customerSavedMemory.userId, id),
    }),
    db.query.customerReferenceMemory.findMany({
      where: and(eq(customerReferenceMemory.userId, id), eq(customerReferenceMemory.memoryType, 'rotating')),
      orderBy: [desc(customerReferenceMemory.recordedAt)],
      limit: 10,
    }),
    db.query.customerReferenceMemory.findMany({
      where: and(eq(customerReferenceMemory.userId, id), eq(customerReferenceMemory.memoryType, 'relation')),
      orderBy: [desc(customerReferenceMemory.importance), desc(customerReferenceMemory.recordedAt)],
      limit: 10,
    }),
    db.query.customerReferenceMemory.findMany({
      where: and(eq(customerReferenceMemory.userId, id), eq(customerReferenceMemory.memoryType, 'diff')),
      orderBy: [desc(customerReferenceMemory.recordedAt)],
      limit: 5,
    }),
    db.query.customerInterestClusters.findMany({
      where: eq(customerInterestClusters.userId, id),
      orderBy: [customerInterestClusters.clusterIdx],
    }),
    db.query.customerSessionPreferences.findFirst({
      where: eq(customerSessionPreferences.userId, id),
    }),
    db.query.customerBehaviorProfile.findFirst({
      where: eq(customerBehaviorProfile.userId, id),
    }),
    db.query.customerOutreachState.findFirst({
      where: eq(customerOutreachState.userId, id),
    }),
    db.query.customerAssistantSessions.findMany({
      where: eq(customerAssistantSessions.userId, id),
      orderBy: [desc(customerAssistantSessions.updatedAt)],
      limit: 5,
    }),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(customerAssistantSessions)
      .where(eq(customerAssistantSessions.userId, id))
      .then((r) => r[0]?.c ?? 0),
    // assistant_chat_log:0008 migration 未 apply 时表不存在,catch 兜底
    db.query.assistantChatLog
      .findMany({
        where: eq(assistantChatLog.userId, id),
        orderBy: [desc(assistantChatLog.createdAt)],
        limit: 5,
      })
      .catch(() => [] as never[]),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(assistantChatLog)
      .where(eq(assistantChatLog.userId, id))
      .then((r) => r[0]?.c ?? 0)
      .catch(() => 0),
  ]);

  // 序列化 reference memory(根据权限是否包含 content)
  const refMap = (rows: typeof refRotating) =>
    rows.map((r) => ({
      id: r.id,
      memoryType: r.memoryType,
      importance: r.importance,
      content: showContent ? r.content : null,
      entities: r.entities,
      clusterId: r.clusterId,
      validFrom: r.validFrom,
      validTo: r.validTo,
      recordedAt: r.recordedAt,
    }));

  // chat log 列表里也做权限隔离
  const chatLogClean = chatLogRecent.map((t) => ({
    id: t.id,
    sessionId: t.sessionId,
    turnIdx: t.turnIdx,
    scenario: t.scenario,
    jokeLevel: t.jokeLevel,
    locale: t.locale,
    llmProvider: t.llmProvider,
    llmModel: t.llmModel,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    costUsdMicros: t.costUsdMicros,
    filterAttempts: t.filterAttempts,
    latencyMs: t.latencyMs,
    createdAt: t.createdAt,
    userInputPreview: showContent && t.userInput ? t.userInput.slice(0, 80) : null,
    finalContentPreview: showContent && t.finalContent ? t.finalContent.slice(0, 80) : null,
  }));

  return c.json({
    data: {
      user: u,
      profile: profile
        ? {
            id: profile.id,
            assistantName: profile.assistantName,
            assistantAvatar: profile.assistantAvatar,
            personalityProfile: profile.personalityProfile,
            systemPromptOverride: showContent ? profile.systemPromptOverride : null,
            memoryWindowDays: profile.memoryWindowDays,
            longTermMemory: profile.longTermMemory,
            proactiveGreetingEnabled: profile.proactiveGreetingEnabled,
            learningEnabled: profile.learningEnabled,
            updatedAt: profile.updatedAt,
          }
        : null,
      savedMemory: savedMem
        ? {
            facts: showContent ? savedMem.facts : null,
            stablePrefs: showContent ? savedMem.stablePrefs : null,
            shameSafePrefs: showContent ? savedMem.shameSafePrefs : null,
            tabooZones: showContent ? savedMem.tabooZones : null,
            exportedAt: savedMem.exportedAt,
            deletionScheduledAt: savedMem.deletionScheduledAt,
            updatedAt: savedMem.updatedAt,
          }
        : null,
      referenceMemory: {
        rotating: refMap(refRotating),
        relation: refMap(refRelation),
        diff: refMap(refDiff),
      },
      interestClusters: clusters.map((c) => ({
        clusterIdx: c.clusterIdx,
        label: c.label,
        sampleSize: c.sampleSize,
        topEntities: showContent ? c.topEntities : null,
        weight: c.weight,
        updatedAt: c.updatedAt,
      })),
      sessionPreferences: sessionPref
        ? {
            currentMood: sessionPref.currentMood,
            currentIntent: sessionPref.currentIntent,
            contextSummary: showContent ? sessionPref.contextSummary : null,
            lastNTurns: showContent ? sessionPref.lastNTurns : null,
            expiresAt: sessionPref.expiresAt,
            updatedAt: sessionPref.updatedAt,
          }
        : null,
      behavior: behavior
        ? {
            behaviorMode: behavior.behaviorMode,
            modeConfidence: behavior.modeConfidence,
            totalOrders: behavior.totalOrders,
            repeatRate: behavior.repeatRate,
            updatedAt: behavior.updatedAt,
          }
        : null,
      outreach: outreach
        ? {
            proactiveEnabled: outreach.proactiveEnabled,
            silentRecallEnabled: outreach.silentRecallEnabled,
            weeklyPushCount: outreach.weeklyPushCount,
            monthlyRecallCount: outreach.monthlyRecallCount,
            lastPushAt: outreach.lastPushAt,
            lastRecallAt: outreach.lastRecallAt,
            regularTimeSlot: outreach.regularTimeSlot,
            updatedAt: outreach.updatedAt,
          }
        : null,
      sessions: {
        count: sessionsCount,
        recent: sessionsRecent.map((s) => ({
          id: s.id,
          preview: showContent ? s.preview : null,
          turnsCount: s.turnsCount,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      },
      chatLog: {
        count: chatLogCount,
        recent: chatLogClean,
      },
    },
    meta: { contentMasked: !showContent },
  });
});
