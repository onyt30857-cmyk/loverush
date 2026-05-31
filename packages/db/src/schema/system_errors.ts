/**
 * 系统错误聚合 · admin 后台监管 + 预警基础
 *
 * 设计:
 *   - 同 fingerprint(type+code+route+method)聚合 · count 累加 · last_seen_at 更新
 *   - resolved_at IS NULL 为活跃 · UI 默认只显未解决
 *   - 严重度 0-100 · severity>=80 触发预警
 *   - 样本字段(sample_user_id/payload)只存 1 个最近样本 · 避免日志爆炸
 *
 * 与 risk_events 区分:
 *   - system_errors: 5xx / 中间件捕获的代码异常 / DB 失败 / 外部 API 失败
 *   - risk_events: 业务安全事件(登录暴力破解 / IP 黑名单命中 / 价格异常 / 多账号设备)
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const systemErrors = pgTable(
  'system_errors',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // 去重 key · md5(type+code+route+method) · 同 key 累加 count
    fingerprint: text('fingerprint').notNull(),

    // 错误分类
    errorType: text('error_type').notNull(), // server / auth / validation / db / external / client
    errorCode: text('error_code'),           // E0001_INVALID_PARAM 等 · null 时是未分类异常
    httpStatus: integer('http_status'),       // 500 / 502 / 401 等

    // 请求上下文
    route: text('route'),                     // /orders / /me 等(已脱去 path param)
    method: text('method'),                   // GET / POST 等

    // 错误细节
    message: text('message').notNull(),       // 脱敏后的信息
    stack: text('stack'),                     // 错误栈 · admin 可见 · 客户端永不返

    // 严重度 + 计数
    severity: integer('severity').default(50).notNull(), // 0-100 · >=80 高危预警
    count: integer('count').default(1).notNull(),

    // 时间窗
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),

    // 样本(1 条最新受影响请求 · 脱敏)
    sampleUserId: uuid('sample_user_id').references(() => users.id, { onDelete: 'set null' }),
    sampleRequestId: text('sample_request_id'),
    samplePayload: jsonb('sample_payload').$type<Record<string, unknown>>().default({}),

    // 处置
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    resolution: text('resolution'),           // fixed / wont_fix / duplicate / external

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // 每个 fingerprint 同时只能有 1 个 active(未 resolved) 行 · upsert 锚
    uniqActiveFingerprint: uniqueIndex('uidx_system_errors_active')
      .on(t.fingerprint)
      .where(sql`resolved_at IS NULL`),
    idxLastSeen: index('idx_system_errors_last_seen').on(t.lastSeenAt),
    idxSeverity: index('idx_system_errors_severity').on(t.severity),
    idxUnresolved: index('idx_system_errors_unresolved').on(t.resolvedAt),
    idxType: index('idx_system_errors_type').on(t.errorType),
  }),
);

export type SystemError = typeof systemErrors.$inferSelect;
export type NewSystemError = typeof systemErrors.$inferInsert;
