/**
 * Feature Flag · Phase 6.1
 *
 * 灰度发布的底座。
 *
 * 评估顺序（短路）：
 * 1. 用户 override（feature_flag_user_overrides）
 * 2. 城市 / 角色 / locale targeting
 * 3. rolloutBps 散列分桶（user_id sha256 → uint32 → mod 10000 < rolloutBps）
 * 4. 默认 enabled / disabled
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
import { users } from './users';

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(),
    description: text('description'),

    // 默认开关 + 灰度
    defaultEnabled: integer('default_enabled').default(0).notNull(),
    rolloutBps: integer('rollout_bps').default(0).notNull(), // 0-10000 (basis points · 0.01%)

    // Targeting（命中即开启 · 在 rollout 之前）
    targetUserType: text('target_user_type'),               // customer / therapist / null
    targetLocales: text('target_locales').array(),          // ["zh","en"]
    targetCities: text('target_cities').array(),            // ["Bangkok","Kuala Lumpur"]
    targetMinAppVersion: text('target_min_app_version'),    // semver

    // 元数据
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    // 生命周期
    enabled: integer('enabled').default(1).notNull(),       // 总开关（强制 off 用）
    archivedAt: timestamp('archived_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxKey: index('idx_flag_key').on(t.key),
    idxEnabled: index('idx_flag_enabled').on(t.enabled),
  }),
);

export const featureFlagUserOverrides = pgTable(
  'feature_flag_user_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    flagKey: text('flag_key').notNull(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    enabled: integer('enabled').notNull(),                  // 强制 1 / 0
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uidxPair: uniqueIndex('uidx_flag_override_pair').on(t.flagKey, t.userId),
    idxUser: index('idx_flag_override_user').on(t.userId),
  }),
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
export type FeatureFlagOverride = typeof featureFlagUserOverrides.$inferSelect;
