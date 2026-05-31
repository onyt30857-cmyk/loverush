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

export interface JobsContext {
  db: Database;
}

export function startAllAssistantJobs(ctx: JobsContext): void {
  startArchiveRotatingCron(ctx);
  startClustererCron(ctx);
  startSilentRecallCron(ctx);
  startProactivePushCron(ctx);
  startAlterRecallCron(ctx); // M06 技师分身老客唤回
}

export {
  runArchiveRotating,
  runClusterer,
  runDiffForUser,
  runSilentRecall,
  runProactivePush,
  runAlterRecall,
};
