/**
 * 小程序运营配置(app_config) · KV 表
 * 承载可后台配置的前端内容:bot 文案/命令、首页运营内容、底部导航。
 * key 唯一(如 'bot.texts'/'home.promise'/'nav.customer');value 为 jsonb 配置体。
 * 前端读取带硬编码 fallback;bot.* 仅服务端读,不下发 C 端接口。
 */
import { pgTable, uuid, text, jsonb, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const appConfig = pgTable('app_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: text('key').notNull(),
  /** 分组:bot/home/nav */
  scope: text('scope').notNull().default('general'),
  /** admin 显示用人类可读名 */
  label: text('label'),
  value: jsonb('value').$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uqKey: uniqueIndex('uq_app_config_key').on(t.key),
  idxScope: index('idx_app_config_scope').on(t.scope),
}));
