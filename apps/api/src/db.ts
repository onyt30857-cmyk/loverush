/**
 * 数据库单例（按需懒加载）
 */

import { createDb, Database } from '@loverush/db';
import { loadEnv } from './env';

let instance: Database | null = null;

export function getDb(): Database {
  if (!instance) {
    const env = loadEnv();
    instance = createDb(env.DATABASE_URL);
  }
  return instance;
}
