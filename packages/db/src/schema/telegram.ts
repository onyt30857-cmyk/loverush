/**
 * M17 · Telegram 渠道 · TG 用户 ↔ loverush 账号绑定
 *
 * inline 搜索/浏览匿名无需账号；进 Mini App 下单/聊天时用 initData 识别 TG 用户，
 * 查这张表：已绑定→登录该 loverush 账号；未绑定→静默建号并绑定。
 */
import { pgTable, uuid, bigint, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

export const tgUserBinding = pgTable(
  'tg_user_binding',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tgUserId: bigint('tg_user_id', { mode: 'number' }).notNull(), // Telegram 用户 ID
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // 绑定的 loverush 账号(未绑定前可空)
    tgUsername: text('tg_username'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    boundAt: timestamp('bound_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  },
  (t) => ({
    uqTgUser: uniqueIndex('uq_tg_user_binding_tg_user').on(t.tgUserId),
  }),
);

export type TgUserBinding = typeof tgUserBinding.$inferSelect;
