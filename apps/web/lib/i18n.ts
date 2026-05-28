/**
 * 前端 i18n 薄壳（M03 客户 AI 助理预留 · 中文优先）
 *
 * 策略：
 *  - v1 中文优先，文案直接传 zh 字面量做 fallback（key 缺失就显字面量）
 *  - 同时挂上 `@loverush/i18n` 共享 BUNDLES：key 命中后用包内翻译，缺时回 fallback
 *  - SSR 安全：locale 读取 navigator 时退 zh
 *
 * 用法：
 *   import { t } from '@/lib/i18n';
 *   t('assistant.fab.aria', '小助理')   // 命中 → "小助理 · 客户 AI 助理"
 *   t('assistant.fab.aria')              // 未命中 → "assistant.fab.aria"
 */

import {
  t as tCore,
  DEFAULT_LOCALE,
  isSupportedLocale,
  type SupportedLocale,
} from '@loverush/i18n';

function detectLocale(): SupportedLocale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const raw = (navigator.language || 'zh').slice(0, 2).toLowerCase();
  return isSupportedLocale(raw) ? raw : DEFAULT_LOCALE;
}

/** 翻译 + 字面量 fallback。缺 key 直接显示 fallback（中文优先策略） */
export function t(key: string, fallback?: string, params?: Record<string, string | number>): string {
  const locale = detectLocale();
  const v = tCore(key, locale, params);
  // tCore 缺 key 时返回 key 本身，这时用 fallback
  if (v === key && fallback !== undefined) return fallback;
  return v;
}
