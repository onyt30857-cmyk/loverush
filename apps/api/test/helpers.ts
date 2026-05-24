/**
 * E2E 测试公共工具
 *
 * 依赖：
 *   - DATABASE_URL 指向一个空的 test PG（每次 e2e 跑前 truncate 所有表）
 *   - JWT_SECRET 任意 32+ 字符
 *
 * 启动一个内存 Hono app，用 fetch 调真 handler（不开端口）。
 */

import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import {
  inviteCodes,
  type Database,
} from '@loverush/db';

let appPromise: Promise<Hono> | null = null;

export async function getApp(): Promise<Hono> {
  if (!appPromise) {
    appPromise = import('../src/index').then((m) => m.default);
  }
  return appPromise;
}

export interface JsonResp<T = unknown> {
  status: number;
  body: { data?: T; error?: { code: string; message: string } };
}

export async function call<T = unknown>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<JsonResp<T>> {
  const app = await getApp();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  const req = new Request(`http://test.local${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const res = await app.fetch(req);
  let body: { data?: T; error?: { code: string; message: string } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {}
  return { status: res.status, body };
}

export const api = {
  get: <T>(path: string, token?: string) => call<T>('GET', path, { token }),
  post: <T>(path: string, body?: unknown, token?: string) => call<T>('POST', path, { token, body }),
  put: <T>(path: string, body?: unknown, token?: string) => call<T>('PUT', path, { token, body }),
  delete: <T>(path: string, body?: unknown, token?: string) => call<T>('DELETE', path, { token, body }),
};

// ──────────────── DB 操作 ────────────────

export async function getDb(): Promise<Database> {
  const m = await import('../src/db');
  return m.getDb();
}

export async function truncateAll(): Promise<void> {
  const db = await getDb();
  // 按依赖顺序 cascade truncate 所有业务表
  const TABLES = [
    'ai_alter_redline_logs',
    'ai_alter_messages',
    'simhash_index',
    'message_translations',
    'messages',
    'conversations',
    'translation_cache',
    'glossary_entries',
    'block_list',
    'dispatch_offers',
    'order_chain',
    'orders',
    'tips',
    'shop_orders',
    'therapist_shop_listings',
    'shop_items',
    'withdrawals',
    'therapist_earnings',
    'reviews',
    'reputation_scores',
    'r_code_milestones',
    'r_code_levels',
    'invite_relationships',
    'invite_code_usage',
    'invite_codes',
    'tickets',
    'ticket_messages',
    'penalty_rules',
    'notifications',
    'web_push_subscriptions',
    'user_push_preferences',
    'pin_attempts',
    'privacy_settings',
    'risk_events',
    'ip_blacklist',
    'price_lock_audits',
    'content_audit_records',
    'media_assets',
    'feature_flag_user_overrides',
    'feature_flags',
    'analytics_daily_agg',
    'analytics_events',
    'customer_behavior_profile',
    'customer_session_preferences',
    'customer_assistant_profile',
    'customer_master_preferences',
    'customer_preferences',
    'customer_relationship_profile',
    'encryption_keys',
    'points_transaction',
    'points_account',
    'therapists',
    'device_fingerprints',
    'sessions',
    'users',
  ];
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  // admin_audit_log 是 append-only（BEFORE TRUNCATE 触发器拒绝），但 CASCADE 会从 users 反向触达它
  // 测试环境临时关触发器 · CASCADE 完成后再开启 · 与生产 trigger 仍然生效互不影响
  await db.execute(sql.raw(`ALTER TABLE admin_audit_log DISABLE TRIGGER USER`));
  try {
    await db.execute(sql.raw(`TRUNCATE TABLE ${list}, admin_audit_log RESTART IDENTITY CASCADE`));
  } finally {
    await db.execute(sql.raw(`ALTER TABLE admin_audit_log ENABLE TRIGGER USER`));
  }
}

export async function seedInviteCode(kind: 'A' | 'O' = 'O', targetUserType?: 'customer' | 'therapist'): Promise<string> {
  const db = await getDb();
  const code = `TEST-${kind}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  await db.insert(inviteCodes).values({
    code,
    kind,
    targetUserType,
    maxUses: 100,
  });
  return code;
}

export async function getInviteCodeRow(code: string) {
  const db = await getDb();
  return db.query.inviteCodes.findFirst({ where: eq(inviteCodes.code, code) });
}

// ──────────────── 业务捷径 ────────────────

export interface RegisterResult {
  user: { id: string; userType: 'customer' | 'therapist'; displayName: string | null };
  mnemonic: string;
  access_token: string;
  refresh_token: string;
}

export async function registerNew(userType: 'customer' | 'therapist'): Promise<RegisterResult> {
  const code = await seedInviteCode('O', userType);
  const res = await api.post<RegisterResult>('/auth/register', {
    user_type: userType,
    invite_code: code,
    display_name: `${userType}-${Date.now()}`,
  });
  if (res.status !== 200 || !res.body.data) {
    throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
