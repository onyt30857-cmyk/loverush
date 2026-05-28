/**
 * 端云分层 · 脱敏 token 化 · PRD §3.5 + §8.1
 *
 * 客户端先把姓名 / 地址 / 电话 → token 再上云,云侧 LLM 拿不到原文。
 *
 * 服务端这一层做:
 * 1. **入口防线**:接收的 message / content 再扫一次正则,把漏掉的真人数据替换为 token
 * 2. **endpoint 标记**:shameSafePrefs 类字段标记 endpoint='edge',云侧 LLM 不读
 * 3. **token 映射不在云侧存**(只在客户端 SQLite),云侧拿到的永远是 token
 */

const NAME_TOKEN_PREFIX = '⟦NAME_';
const ADDR_TOKEN_PREFIX = '⟦ADDR_';
const PHONE_TOKEN_PREFIX = '⟦PHONE_';
const EMAIL_TOKEN_PREFIX = '⟦EMAIL_';
const TOKEN_SUFFIX = '⟧';

// 手机号(覆盖 CN / SG / MY / TH / VN / ID 6 国常见格式)
const PHONE_RE = /(\+?\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// 简化地址识别(更长的地址 NER 在抽取层做)
const ADDR_HINTS = /([东南西北中]?(路|街|大道|巷|号|楼|公寓|酒店|大厦|小区))/g;
// 微信/Telegram 账号(钓鱼私聊离站常见)
const SOCIAL_RE = /(wechat|wx|微信|telegram|tg|line|whatsapp)[:：\s]*[a-zA-Z0-9_-]{3,}/gi;

let counter = 0;
function nextTokenId(): string {
  counter = (counter + 1) % 100000;
  return String(counter).padStart(4, '0');
}

export interface RedactResult {
  cleaned: string;
  hits: {
    phones: number;
    emails: number;
    addresses: number;
    socials: number;
  };
}

/**
 * 服务端兜底脱敏 · 把漏网的真人数据替换为 token
 *
 * 注:正常路径下客户端已经替换好;这一层防止 H5 端 bug / 直接 API 调用绕过端侧。
 */
export function redact(text: string): RedactResult {
  if (!text) return { cleaned: '', hits: { phones: 0, emails: 0, addresses: 0, socials: 0 } };
  let cleaned = text;
  const hits = { phones: 0, emails: 0, addresses: 0, socials: 0 };

  cleaned = cleaned.replace(EMAIL_RE, () => {
    hits.emails++;
    return `${EMAIL_TOKEN_PREFIX}${nextTokenId()}${TOKEN_SUFFIX}`;
  });
  cleaned = cleaned.replace(PHONE_RE, () => {
    hits.phones++;
    return `${PHONE_TOKEN_PREFIX}${nextTokenId()}${TOKEN_SUFFIX}`;
  });
  cleaned = cleaned.replace(SOCIAL_RE, () => {
    hits.socials++;
    return `${PHONE_TOKEN_PREFIX}${nextTokenId()}${TOKEN_SUFFIX}`;
  });
  cleaned = cleaned.replace(ADDR_HINTS, () => {
    hits.addresses++;
    return `${ADDR_TOKEN_PREFIX}${nextTokenId()}${TOKEN_SUFFIX}`;
  });

  return { cleaned, hits };
}

/**
 * 判断字段是否属于 shame_safe(只能端侧)
 */
export function isShameSafeKey(key: string): boolean {
  const k = key.toLowerCase();
  return /(shame|secret|private|kink|fetish|porn|sexual|libido|preference_intimate)/.test(k);
}

/**
 * 把客户端传来的 prefs payload 拆成 cloud vs edge 两份
 */
export function splitEndpoints<T extends Record<string, unknown>>(
  payload: T,
): { cloud: Partial<T>; edge: Partial<T> } {
  const cloud: Record<string, unknown> = {};
  const edge: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (isShameSafeKey(k)) {
      edge[k] = v;
    } else {
      cloud[k] = v;
    }
  }
  return { cloud: cloud as Partial<T>, edge: edge as Partial<T> };
}
