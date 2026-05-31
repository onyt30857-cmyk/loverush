/**
 * @loverush/db · 数据库实例工厂
 *
 * 使用方式：
 *   import { createDb } from '@loverush/db';
 *   const db = createDb(env.DATABASE_URL);
 *
 * 工厂模式：便于测试注入 + Cloudflare Workers 多环境
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export interface DbOptions {
  maxConnections?: number;
  idleTimeout?: number;
  connectTimeout?: number;
  /** 连接最长生命周期(秒) · 主动 cycle 避免长 idle 引发 DNS/TCP 漂移 */
  maxLifetime?: number;
}

export function createDb(databaseUrl: string, opts: DbOptions = {}) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  // Supabase / pgBouncer transaction-mode pooler 不支持 prepared statements;
  // host 含 "pooler" 或 port 6543 → 关 prepare,避免并发 query hang
  const isTxnPooler = /\bpooler\b|:6543\b/i.test(databaseUrl);
  const client = postgres(databaseUrl, {
    max: opts.maxConnections ?? 10,
    idle_timeout: opts.idleTimeout ?? 20,
    connect_timeout: opts.connectTimeout ?? 10,
    max_lifetime: opts.maxLifetime ?? 1800, // 30 min · 防 zombie 卡死(对齐 2026-05-31 事故修复)
    prepare: !isTxnPooler,
  });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
export { schema };
export * from './schema/index';
