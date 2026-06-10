/**
 * AI 分身可调参数（aiTunables）
 *
 * 8 个安全数值参数：从 app_config(scope='ai_config') 读覆盖值，
 * merge 到常量默认值，返回有效值对象。60s 内存缓存，改配置后自然过期或主动清缓存。
 *
 * 安全第一：读失败 / 无覆盖 → 全用 default 常量兜底，绝不影响分身回复主链。
 */

import type { Database } from '@loverush/db';
import { appConfig } from '@loverush/db';
import { eq, inArray } from 'drizzle-orm';

// ──────────── Tunable 参数 catalog ────────────

export interface TunableDef {
  key: string;
  label: string;
  group: '节奏触发' | '记忆' | '输出与稳定' | '质检';
  default: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  isFloat: boolean;
}

export const AI_TUNABLES: TunableDef[] = [
  {
    key: 'offlineThresholdMin',
    label: '离线阈值',
    group: '节奏触发',
    default: 5,
    min: 3,
    max: 15,
    step: 1,
    unit: '分钟',
    isFloat: false,
  },
  {
    key: 'replyDelayMinMs',
    label: '回复延迟下限',
    group: '节奏触发',
    default: 3000,
    min: 1000,
    max: 5000,
    step: 500,
    unit: 'ms',
    isFloat: false,
  },
  {
    key: 'replyDelayMaxMs',
    label: '回复延迟上限',
    group: '节奏触发',
    default: 9000,
    min: 5000,
    max: 15000,
    step: 500,
    unit: 'ms',
    isFloat: false,
  },
  {
    key: 'historyWindow',
    label: '短期记忆窗口',
    group: '记忆',
    default: 8,
    min: 4,
    max: 12,
    step: 1,
    unit: '条',
    isFloat: false,
  },
  {
    key: 'maxReplyChars',
    label: '最大回复字数',
    group: '输出与稳定',
    default: 55,
    min: 30,
    max: 100,
    step: 5,
    unit: '字',
    isFloat: false,
  },
  {
    key: 'maxTokens',
    label: '最大 Token 数',
    group: '输出与稳定',
    default: 120,
    min: 80,
    max: 200,
    step: 10,
    unit: 'token',
    isFloat: false,
  },
  {
    key: 'temperature',
    label: '采样温度',
    group: '输出与稳定',
    default: 0.6,
    min: 0.3,
    max: 0.9,
    step: 0.05,
    unit: '-',
    isFloat: true,
  },
  {
    key: 'maxRegenerate',
    label: '质检重生成次数',
    group: '质检',
    default: 2,
    min: 1,
    max: 5,
    step: 1,
    unit: '次',
    isFloat: false,
  },
];

/** 从 catalog 构建默认值 Record */
export const AI_TUNABLES_DEFAULTS: Record<string, number> = Object.fromEntries(
  AI_TUNABLES.map((d) => [d.key, d.default]),
);

// ──────────── app_config key 命名 ────────────

/** app_config 表的 key 命名规则：ai_config.<param> */
export function tunableConfigKey(param: string): string {
  return `ai_config.${param}`;
}

// ──────────── 60s 内存缓存 ────────────

interface CacheEntry {
  at: number;
  values: Record<string, number>;
}

let _cache: CacheEntry | null = null;
const CACHE_TTL_MS = 60_000;

export function clearAiTunablesCache(): void {
  _cache = null;
}

// ──────────── 主函数 ────────────

/**
 * 从 app_config 读 scope='ai_config' 覆盖值，merge 到默认常量上。
 * 60s 缓存；任何失败 → 全用 default 兜底（绝不阻断回复管线）。
 */
export async function loadAiTunables(db: Database): Promise<Record<string, number>> {
  // 1. 命中缓存直接返回
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return _cache.values;
  }

  // 2. 全用默认值作兜底基础
  const result: Record<string, number> = { ...AI_TUNABLES_DEFAULTS };

  try {
    // 3. 读所有 ai_config.* key
    const keys = AI_TUNABLES.map((d) => tunableConfigKey(d.key));
    const rows = await db
      .select({ key: appConfig.key, value: appConfig.value, enabled: appConfig.enabled })
      .from(appConfig)
      .where(inArray(appConfig.key, keys));

    for (const row of rows) {
      if (!row.enabled) continue; // 禁用的覆盖不生效
      // value 结构：{ value: number }
      const rawValue = (row.value as Record<string, unknown>)?.value;
      if (typeof rawValue !== 'number' || isNaN(rawValue)) continue;

      // 反查 param key
      const paramKey = row.key.replace(/^ai_config\./, '');
      const def = AI_TUNABLES.find((d) => d.key === paramKey);
      if (!def) continue;

      // 范围校验：只应用范围内的值（范围外视为损坏配置，用 default）
      if (rawValue >= def.min && rawValue <= def.max) {
        result[paramKey] = rawValue;
      }
    }
  } catch {
    // 读失败：直接返回全 default，不写缓存（下次仍然重试）
    return { ...AI_TUNABLES_DEFAULTS };
  }

  // 4. 写缓存
  _cache = { at: Date.now(), values: result };
  return result;
}
