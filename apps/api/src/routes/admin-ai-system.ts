/**
 * Admin · AI 分身「系统约束透明」只读接口（M06b 模块①）
 *
 * 把藏在代码里的所有 AI 运行边界/参数，从单一真相源 AI_ALTER_CONFIG 读出来返回，
 * 供后台"约束透明卡"展示——保证"后台显示值 = 实际运行值"，运营无需懂代码。
 * 纯只读，不改任何行为。权限：admin / ops / cs。
 */
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { AI_ALTER_CONFIG } from '../services/ai_alter';
import { getHealthData, recomputeHealthScores } from '../services/ai-health';
import { getDb } from '../db';

export const adminAiSystemRoutes = new Hono();
adminAiSystemRoutes.use('*', requireAuth);
adminAiSystemRoutes.use('*', requireRole(['admin', 'ops', 'cs']));

adminAiSystemRoutes.get('/info', (c) => {
  return c.json({
    data: {
      promptVersion: AI_ALTER_CONFIG.promptVersion,
      // 运行参数（单一真相源，改代码即同步）
      params: {
        offlineThresholdMin: AI_ALTER_CONFIG.offlineThresholdMin,
        historyWindow: AI_ALTER_CONFIG.historyWindow,
        temperature: AI_ALTER_CONFIG.temperature,
        maxTokens: AI_ALTER_CONFIG.maxTokens,
        maxReplyChars: AI_ALTER_CONFIG.maxReplyChars,
        maxRegenerate: AI_ALTER_CONFIG.maxRegenerate,
        simhashHammingThreshold: AI_ALTER_CONFIG.simhashHammingThreshold,
      },
      llm: { tier: AI_ALTER_CONFIG.llmTier, providers: AI_ALTER_CONFIG.providers },
      // 自动质检
      redline: {
        categories: AI_ALTER_CONFIG.redlineCategories,
        hardBlock: ['minor', 'illegal'], // 这两类直接拦截，不重写
      },
      validate: { checks: ['persona_break', 'echoing', 'too_long'] },
      // 后台自动任务启动状态
      // 注：与 apps/api/src/index.ts 的实际 startXxxCron 调用保持一致，改启动时同步此处
      jobs: {
        replyRetry: { enabled: true, intervalMin: 3, desc: '漏消息补偿' },
        recall: { enabled: false, desc: '老客唤回（待授权）' },
        aftercare: { enabled: false, desc: '服务后关怀（待授权）' },
        favorite: { enabled: false, desc: '收藏破冰（待授权）' },
      },
    },
  });
});

// 健康仪表盘数据（概览 + 技师榜，最差在前）。纯只读。
adminAiSystemRoutes.get('/health', async (c) => {
  const data = await getHealthData({ db: getDb() });
  return c.json({ data });
});

// 手动重算所有 passed 技师的健康分。纯读库算分写库，不碰客户，低风险。
// 仅 admin/ops 可触发（cs 只读）。
adminAiSystemRoutes.post('/health/recompute', requireRole(['admin', 'ops']), async (c) => {
  const result = await recomputeHealthScores({ db: getDb() });
  return c.json({ data: result });
});
