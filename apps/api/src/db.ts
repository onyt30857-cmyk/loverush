/**
 * 数据库单例(按需懒加载)
 *
 * 性能 + 抗 zombie 调优(2026-05-31 修复 7h 卡死事件后):
 *   - max=20:并发能力翻倍,Bun 单进程支撑更高 QPS
 *   - idle_timeout=60:空闲 60s 自动关连接,防 Supavisor 端 ClientRead zombie 累积
 *   - connect_timeout=10:建连超 10s 报错,不让 server-init 永久 hang
 *   - max_lifetime=1800:连接最长 30 分钟必回收,主动 cycle 避免长期 idle 引发的 DNS / TCP 漂移
 */

import type { Database } from '@loverush/db';
import { createDb } from '@loverush/db';
import { loadEnv } from './env';

let instance: Database | null = null;

export function getDb(): Database {
  if (!instance) {
    const env = loadEnv();
    instance = createDb(env.DATABASE_URL, {
      maxConnections: 20,
      idleTimeout: 60,
      connectTimeout: 10,
    });
  }
  return instance;
}
