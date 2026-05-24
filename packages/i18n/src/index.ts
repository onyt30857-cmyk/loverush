/**
 * @loverush/i18n · 6 语种文案管理
 *
 * 支持语种：zh / en / th / vi / ms / id
 *
 * 用法：
 *   import { t } from '@loverush/i18n';
 *   t('order.status.PAID', 'zh')                    // → "已支付"
 *   t('paywall.confirm', 'zh', { points: 100 })     // → "确认消耗 100 积分"
 *
 * 未命中 key → 返回 key 本身（前端友好降级）；
 * locale 未加载 → 回退到 zh。
 */

import zh from './locales/zh.json';
import en from './locales/en.json';
import th from './locales/th.json';
import vi from './locales/vi.json';
import ms from './locales/ms.json';
import id from './locales/id.json';

export const SUPPORTED_LOCALES = ['zh', 'en', 'th', 'vi', 'ms', 'id'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const SupportedLocales = {
  ZH: 'zh',
  EN: 'en',
  TH: 'th',
  VI: 'vi',
  MS: 'ms',
  ID: 'id',
} as const;

export type LocaleValue = (typeof SupportedLocales)[keyof typeof SupportedLocales];

export const DEFAULT_LOCALE: SupportedLocale = 'zh';

export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  zh: '简体中文',
  en: 'English',
  th: 'ภาษาไทย',
  vi: 'Tiếng Việt',
  ms: 'Bahasa Melayu',
  id: 'Bahasa Indonesia',
};

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

// ──────────────── 文案 bundles ────────────────

type Bundle = typeof zh;
const BUNDLES: Partial<Record<SupportedLocale, Bundle>> = {
  zh: zh as Bundle,
  en: en as Bundle,
  th: th as Bundle,
  vi: vi as Bundle,
  ms: ms as Bundle,
  id: id as Bundle,
};

function lookup(bundle: Bundle | undefined, key: string): string | undefined {
  if (!bundle) return undefined;
  const parts = key.split('.');
  let cur: unknown = bundle;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const v = params[key];
    return v == null ? `{{${key}}}` : String(v);
  });
}

/**
 * 翻译函数。命中失败时按 zh fallback；再失败返回 key。
 */
export function t(
  key: string,
  locale: SupportedLocale = DEFAULT_LOCALE,
  params?: Record<string, string | number>,
): string {
  const direct = lookup(BUNDLES[locale], key);
  if (direct !== undefined) return interpolate(direct, params);

  const fallback = lookup(BUNDLES[DEFAULT_LOCALE], key);
  if (fallback !== undefined) return interpolate(fallback, params);

  return key;
}

/** 一次性返回 namespace 下的所有 key（前端 hydration 用） */
export function getNamespace(namespace: string, locale: SupportedLocale = DEFAULT_LOCALE): Record<string, unknown> {
  const bundle = BUNDLES[locale] ?? BUNDLES[DEFAULT_LOCALE];
  if (!bundle) return {};
  const parts = namespace.split('.');
  let cur: unknown = bundle;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) return {};
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'object' && cur !== null ? (cur as Record<string, unknown>) : {};
}

export { BUNDLES };
