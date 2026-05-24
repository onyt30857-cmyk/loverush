/**
 * 邀请关系链 + R 码分成 · M10
 *
 * Phase 1 已建 `invite_codes` + `invite_code_usage` 两张表（基础码）。
 * 本批补充：
 * - invite_relationships：邀请关系链（双向 + 两级上限）
 * - r_code_levels：技师 R 码当前阶梯（决定分成比例 3-10%）
 * - r_code_milestones：R 码里程碑跟踪（晋升 / 降级历史）
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { inviteCodes } from './auth';

/** 邀请关系（最多两级 · 平台反传销） */
export const inviteRelationships = pgTable(
  'invite_relationships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    inviterUserId: uuid('inviter_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    inviteeUserId: uuid('invitee_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    inviteCodeId: uuid('invite_code_id').references(() => inviteCodes.id, { onDelete: 'set null' }),

    // 关系层级（1 = 直接邀请，2 = 二级，> 2 不允许）
    level: integer('level').default(1).notNull(),
    rootInviterUserId: uuid('root_inviter_user_id').references(() => users.id, { onDelete: 'cascade' }),

    // 关系类型：基于邀请码 kind
    relationKind: text('relation_kind').notNull(), // T / A / U / O / R

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxPair: uniqueIndex('uidx_invite_rel_pair').on(t.inviterUserId, t.inviteeUserId),
    idxInvitee: index('idx_invite_rel_invitee').on(t.inviteeUserId),
    idxRoot: index('idx_invite_rel_root').on(t.rootInviterUserId, t.level),
    idxKind: index('idx_invite_rel_kind').on(t.relationKind),
  }),
);

/** R 码当前等级（技师推荐技师 · 决定分成比例） */
export const rCodeLevels = pgTable(
  'r_code_levels',
  {
    therapistUserId: uuid('therapist_user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),

    // 1 = 3%, 2 = 5%, 3 = 7%, 4 = 10%（最高）
    level: integer('level').default(1).notNull(),
    commissionBps: integer('commission_bps').default(300).notNull(), // 3%

    // 累计指标
    invitedTherapistCount: integer('invited_therapist_count').default(0).notNull(),
    activeTherapistCount: integer('active_therapist_count').default(0).notNull(), // 完成首单
    totalCommissionEarnedCents: bigint('total_commission_earned_cents', { mode: 'number' }).default(0).notNull(),

    lastPromotedAt: timestamp('last_promoted_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

/** R 码里程碑（晋升 / 降级历史） */
export const rCodeMilestones = pgTable(
  'r_code_milestones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    therapistUserId: uuid('therapist_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

    eventType: text('event_type').notNull(), // promotion / demotion / commission_earned
    fromLevel: integer('from_level'),
    toLevel: integer('to_level'),
    fromCommissionBps: integer('from_commission_bps'),
    toCommissionBps: integer('to_commission_bps'),

    // 触发原因
    triggerJson: jsonb('trigger').$type<Record<string, unknown>>().default({}),

    // 关联收益（commission_earned 事件用）
    relatedTransactionId: uuid('related_transaction_id'),
    amountCents: bigint('amount_cents', { mode: 'number' }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxTherapist: index('idx_r_milestone_therapist').on(t.therapistUserId, t.createdAt),
    idxEvent: index('idx_r_milestone_event').on(t.eventType),
  }),
);

export type InviteRelationship = typeof inviteRelationships.$inferSelect;
export type NewInviteRelationship = typeof inviteRelationships.$inferInsert;
export type RCodeLevel = typeof rCodeLevels.$inferSelect;
export type RCodeMilestone = typeof rCodeMilestones.$inferSelect;
