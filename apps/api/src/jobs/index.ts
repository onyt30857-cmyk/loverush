/**
 * 后台 jobs 汇总
 *
 * 启动入口示例:
 *   import { startAllAssistantJobs } from './jobs';
 *   startAllAssistantJobs({ db: getDb() });
 *
 * 全部按 PRD §13 用 setInterval(非 BullMQ);千-万用户够用。
 */

import type { Database } from '@loverush/db';
import {
  startArchiveRotatingCron,
  runArchiveRotating,
} from './assistant-archive-rotating';
import { startClustererCron, runClusterer } from './assistant-clusterer';
import { runDiffForUser } from './assistant-diff';
import {
  startSilentRecallCron,
  runSilentRecall,
} from './assistant-silent-recall';
import {
  startProactivePushCron,
  runProactivePush,
} from './assistant-proactive-push';
import { startAlterRecallCron, runAlterRecall } from './ai-alter-recall';
import { startAlterAftercareCron, runAlterAftercare } from './ai-alter-aftercare';
import { startAlterFavoriteCron, runAlterFavorite } from './ai-alter-favorite';
import { startAlterReplyRetryCron, runAlterReplyRetry } from './ai-alter-reply-retry';

export interface JobsContext {
  db: Database;
}

export function startAllAssistantJobs(ctx: JobsContext): void {
  // ──────── v4 砍 M03 死 jobs (2026-06-01 [[loverush_m03_audit_2026_06_01]]) ────────
  // archive-rotating · clusterer (KMeans) · silent-recall · proactive-push
  // 真数据 0 行 / 0 触发 / 0 push 发出 · 不再启动 cron
  // 函数 export 保留 (运维手动调试可用) · 自动 cron 完全停
  //
  // startArchiveRotatingCron(ctx);  // 砍 · L3-L5 reference_memory 0 行 archive
  // startClustererCron(ctx);        // 砍 · interest_clusters 0 行
  // startSilentRecallCron(ctx);     // 砍 · outreach_state 0 行
  // startProactivePushCron(ctx);    // 砍 · 累计 push 0

  // ──── M06 技师 AI 分身 (真在用 25/25 激活 · 留 [[loverush_m06_status]]) ────
  startAlterRecallCron(ctx); // M06 技师分身老客唤回
  startAlterAftercareCron(ctx); // M06 技师分身服务后关怀
  startAlterFavoriteCron(ctx); // M06 技师分身收藏破冰
  startAlterReplyRetryCron(ctx); // M06 分身回复兜底补偿
}

export {
  runArchiveRotating,
  runClusterer,
  runDiffForUser,
  runSilentRecall,
  runProactivePush,
  runAlterRecall,
  runAlterAftercare,
  runAlterFavorite,
  runAlterReplyRetry,
};
