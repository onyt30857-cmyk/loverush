/**
 * M06 Phase 2 · AI 健康度评分日级 snapshot
 *
 * 每日 02:00 UTC cron 跑 · 给每个 verification_status='passed' 技师算 0-100 综合分
 *
 * 算法(7 天滑窗):
 *   - redlineFreqScore   0-40: max(0, 40 - redlineCount × 4)
 *   - simhashRepeatScore 0-25: max(0, 25 - repeatRate × 50)
 *   - negativeFeedback   0-20: 综合 reviews 低分 + blocks
 *   - volumeScore        0-15: clip(代发量/合理区间)
 *
 * 4 维子分透明 admin 可见 · 算法可后续调整
 */

import {
  pgTable,
  uuid,
  integer,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const aiHealthScores = pgTable(
  'ai_health_scores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    scoreDate: date('score_date').notNull(), // YYYY-MM-DD

    overallScore: integer('overall_score').notNull(), // 0-100

    // 4 维子分(透明 · admin 看怎么扣的)
    redlineFreqScore: integer('redline_freq_score').notNull(),       // 0-40
    simhashRepeatScore: integer('simhash_repeat_score').notNull(),   // 0-25
    negativeFeedbackScore: integer('negative_feedback_score').notNull(), // 0-20
    volumeScore: integer('volume_score').notNull(),                  // 0-15

    // 计算窗口
    windowDays: integer('window_days').notNull().default(7),

    // 原始指标(给 admin 看明细)
    metrics: jsonb('metrics')
      .$type<{
        redlineCount: number;
        simhashRepeatCount: number;
        blockCount: number;
        reviewLowScoreCount: number;
        alterMessageCount: number;
      }>()
      .notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxTherapistDate: index('idx_ai_health_therapist_date').on(t.therapistUserId, t.scoreDate),
    uqTherapistDate: uniqueIndex('uq_ai_health_therapist_date').on(t.therapistUserId, t.scoreDate),
    idxScoreDate: index('idx_ai_health_score_date').on(t.scoreDate, t.overallScore),
  }),
);

export type AiHealthScore = typeof aiHealthScores.$inferSelect;
export type NewAiHealthScore = typeof aiHealthScores.$inferInsert;
