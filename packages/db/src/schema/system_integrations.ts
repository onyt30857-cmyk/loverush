/**
 * 第三方服务清单(管理后台)
 * 平台用到的外部服务元数据:用途、关联 env 变量、关键性、启用开关、非密钥参数。
 * 密钥本身不入库(走 env);"已配置?"状态由后端实时读 process.env 计算后返回。
 */
import { pgTable, uuid, text, integer, jsonb, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const systemIntegrations = pgTable('system_integrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** 稳定 slug,如 'openai' / 'r2' */
  key: text('key').notNull(),
  displayName: text('display_name').notNull(),
  /** llm/voice/storage/push/payment/monitoring/geo/messaging/alert/email/fx/other */
  category: text('category').notNull().default('other'),
  /** 该服务在平台用于干什么(明细) */
  purpose: text('purpose').notNull().default(''),
  /** 该服务读取的 env 变量名(第一个视为主凭证,用于判定"已配置") */
  envVars: text('env_vars').array().notNull().default([]),
  /** critical/important/optional */
  criticality: text('criticality').notNull().default('optional'),
  docsUrl: text('docs_url'),
  /** 非密钥可配参数(模型名、TTS 配置等) */
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  notes: text('notes'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uqKey: uniqueIndex('uq_system_integrations_key').on(t.key),
  idxSort: index('idx_system_integrations_sort').on(t.sortOrder),
}));
