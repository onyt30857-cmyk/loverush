/**
 * i18n 中间件
 *
 * 从请求中解析 locale 并挂到 c.set('locale')，
 * 优先级：?lang= > Accept-Language 头 > 用户 profile > zh 默认
 */

import { Context, MiddlewareHandler, Next } from 'hono';
import { SUPPORTED_LOCALES, SupportedLocale } from '@loverush/i18n';

function pickFromAcceptLanguage(header: string | undefined): SupportedLocale | null {
  if (!header) return null;
  const langs = header
    .split(',')
    .map((s) => s.trim().split(';')[0]!.toLowerCase().split('-')[0]!)
    .filter(Boolean);
  for (const code of langs) {
    if ((SUPPORTED_LOCALES as readonly string[]).includes(code)) {
      return code as SupportedLocale;
    }
  }
  return null;
}

export const i18nMiddleware: MiddlewareHandler = async (c: Context, next: Next) => {
  const queryLang = c.req.query('lang');
  if (queryLang && (SUPPORTED_LOCALES as readonly string[]).includes(queryLang)) {
    c.set('locale', queryLang as SupportedLocale);
  } else {
    const fromHeader = pickFromAcceptLanguage(c.req.header('accept-language'));
    c.set('locale', (fromHeader ?? 'zh') as SupportedLocale);
  }
  await next();
};
