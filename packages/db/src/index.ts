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
}

export function createDb(databaseUrl: string, opts: DbOptions = {}) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const client = postgres(databaseUrl, {
    max: opts.maxConnections ?? 10,
    idle_timeout: opts.idleTimeout ?? 20,
    connect_timeout: opts.connectTimeout ?? 10,
  });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
export { schema };
export * from './schema/index';
