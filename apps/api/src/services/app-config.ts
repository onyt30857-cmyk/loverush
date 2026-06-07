/**
 * 小程序运营配置读取(app_config) · 内存缓存 60s
 * bot/home/nav 三域配置统一 KV 读;带 fallback,缺配置/查询失败回退调用方默认值。
 */
import { appConfig } from '@loverush/db';
import { getDb } from '../db';
import { logger } from './logger';

let cache: { at: number; map: Record<string, unknown> } | null = null;
const TTL_MS = 60_000;

async function loadAll(): Promise<Record<string, unknown>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  const map: Record<string, unknown> = {};
  try {
    const rows = await getDb().query.appConfig.findMany();
    for (const r of rows) if (r.enabled) map[r.key] = r.value;
  } catch (err) {
    logger.warn('app_config.load_failed', { err: String(err) });
    return cache?.map ?? {};
  }
  cache = { at: Date.now(), map };
  return map;
}

/** 取某 key 配置;缺则返回 fallback(永不假装数据) */
export async function getAppConfig<T>(key: string, fallback: T): Promise<T> {
  const map = await loadAll();
  return (map[key] as T | undefined) ?? fallback;
}

/** 取一组 key(用于 C 端只读端点) */
export async function getAppConfigMany(keys: string[]): Promise<Record<string, unknown>> {
  const map = await loadAll();
  const out: Record<string, unknown> = {};
  for (const k of keys) if (map[k] !== undefined) out[k] = map[k];
  return out;
}

export function clearAppConfigCache(): void {
  cache = null;
}
