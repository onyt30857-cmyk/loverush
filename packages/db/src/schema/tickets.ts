/**
 * 客服工单 · M12
 *
 * - tickets：工单主体（状态机 + AI 分类 + 仲裁动作）
 * - ticket_messages：沟通历史（客户 ↔ 客服 ↔ AI 一线 ↔ 仲裁员）
 * - penalty_rules：处罚规则（仲裁裁决的可选模板）
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { orders } from './orders';

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketNo: text('ticket_no').notNull().unique(),

    reporterUserId: uuid('reporter_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    relatedOrderId: uuid('related_order_id').references(() => orders.id, { onDelete: 'set null' }),

    // 分类（AI 初判 + 人工修正）
    category: text('category').notNull(), // refund_request / harassment / fraud / kyc_dispute / tech_issue / other
    subcategory: text('subcategory'),
    priority: integer('priority').default(50).notNull(), // 0-100
    aiCategoryConfidence: integer('ai_category_confidence'),

    // 状态机
    status: text('status').default('open').notNull(),
    // open / triage / assigned / waiting_user / in_review / resolved / closed / escalated

    // 标题 + 描述（用户视角）
    title: text('title').notNull(),
    description: text('description').notNull(),

    // 处置（裁决结果）
    resolutionType: text('resolution_type'), // refund / warn_target / suspend_target / ban_target / dismiss / no_action
    resolutionNote: text('resolution_note'),
    refundPoints: integer('refund_points'),

    // 处理人
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),

    // SLA
    slaDeadlineAt: timestamp('sla_deadline_at', { withTimezone: true }),

    // 元数据
    evidence: jsonb('evidence').$type<Record<string, unknown>>().default({}),
    aiSummary: text('ai_summary'),

    openedAt: timestamp('opened_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxReporter: index('idx_ticket_reporter').on(t.reporterUserId, t.openedAt),
    idxTarget: index('idx_ticket_target').on(t.targetUserId, t.status),
    idxStatus: index('idx_ticket_status').on(t.status, t.priority),
    idxAssignee: index('idx_ticket_assignee').on(t.assigneeUserId),
    idxOrder: index('idx_ticket_order').on(t.relatedOrderId),
  }),
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
    senderUserId: uuid('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
    senderRole: text('sender_role').notNull(), // reporter / target / cs_human / cs_ai / system / admin

    content: text('content').notNull(),
    attachments: jsonb('attachments').$type<Array<{ mediaId: string; url: string }>>().default([]),

    isInternal: integer('is_internal').default(0).notNull(), // 内部备注，不展示给用户

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxTicket: index('idx_ticket_msg_ticket').on(t.ticketId, t.createdAt),
  }),
);

export const penaltyRules = pgTable(
  'penalty_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ruleKey: text('rule_key').notNull().unique(),
    title: text('title').notNull(),
    description: text('description'),

    appliesTo: text('applies_to').notNull(), // therapist / customer / any
    severity: text('severity').notNull(),    // warning / fine / suspend / ban
    fineCents: integer('fine_cents'),
    suspendDays: integer('suspend_days'),

    isActive: integer('is_active').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
);

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type TicketMessage = typeof ticketMessages.$inferSelect;
export type PenaltyRule = typeof penaltyRules.$inferSelect;
