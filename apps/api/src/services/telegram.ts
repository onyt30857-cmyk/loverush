/**
 * M17 · Telegram 渠道服务
 *
 * 三块：
 *  1) Bot API 薄封装（answerInlineQuery / sendPhoto / setWebhook）——bot token 走 env，缺则 noop
 *  2) verifyInitData ——Mini App 免密登录核心：验 TG webview 注入的 initData 签名（HMAC-SHA256）
 *  3) therapistToInlinePhoto ——技师 → inline 结果卡映射（纯函数，可单测）
 *
 * 客户向 bot，与 ALERT_TELEGRAM_*（预警 bot）无关。
 */
import { loadEnv } from '../env';
import { logger } from './logger';

const TG_API = 'https://api.telegram.org';

export function tgConfig() {
  const env = loadEnv();
  return {
    token: env.TELEGRAM_BOT_TOKEN,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    miniAppUrl: env.TELEGRAM_MINIAPP_URL,
    botUsername: env.TELEGRAM_BOT_USERNAME,
  };
}

export function isTelegramConfigured(): boolean {
  return Boolean(tgConfig().token);
}

/** 调 Bot API。缺 token 返回 null（noop 降级）。失败只记日志不抛，避免拖垮 webhook 主链。 */
export async function callTelegram(method: string, body: Record<string, unknown>): Promise<unknown> {
  const { token } = tgConfig();
  if (!token) return null;
  try {
    const res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
    if (!json.ok) logger.warn('telegram.api_error', { method, desc: json.description });
    return json.result ?? null;
  } catch (err) {
    logger.warn('telegram.api_fetch_failed', { method, err: String(err) });
    return null;
  }
}

export function answerInlineQuery(params: {
  inline_query_id: string;
  results: unknown[];
  cache_time?: number;
  is_personal?: boolean;
  next_offset?: string;
  button?: unknown;
}): Promise<unknown> {
  return callTelegram('answerInlineQuery', { cache_time: 30, is_personal: true, ...params });
}

export function sendPhoto(params: {
  chat_id: number | string;
  photo: string;
  caption?: string;
  parse_mode?: string;
  reply_markup?: unknown;
}): Promise<unknown> {
  return callTelegram('sendPhoto', params);
}

export function sendMessage(params: {
  chat_id: number | string;
  text: string;
  parse_mode?: string;
  reply_markup?: unknown;
}): Promise<unknown> {
  return callTelegram('sendMessage', params);
}

/** 设置 bot 命令菜单(/start 等)。admin 改 bot.commands 时调,即时生效。 */
export function setMyCommands(commands: Array<{ command: string; description: string }>): Promise<unknown> {
  return callTelegram('setMyCommands', { commands });
}

/** 启动/部署时调一次，把 webhook 指到本服务。allowed_updates 只收我们处理的三类。 */
export function setWebhook(url: string): Promise<unknown> {
  const { webhookSecret } = tgConfig();
  return callTelegram('setWebhook', {
    url,
    secret_token: webhookSecret,
    allowed_updates: ['inline_query', 'chosen_inline_result', 'message'],
  });
}

// ──────────────── initData 验签（Mini App 免密登录） ────────────────

async function hmacSha256(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(msg));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface TgInitUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}

/**
 * 验 Telegram WebApp initData 签名。
 * 算法：secret = HMAC("WebAppData" 为 key, botToken 为 msg)；
 *       hash  = HMAC(secret 为 key, dataCheckString 为 msg)；与 initData.hash 比对。
 * 同时校验 auth_date 新鲜度（默认 24h）防重放。
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 86400,
  now = Date.now(),
): Promise<{ ok: boolean; user?: TgInitUser; reason?: string }> {
  if (!initData || !botToken) return { ok: false, reason: 'missing_input' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no_hash' };
  params.delete('hash');

  // data_check_string：按 key 排序、"key=value" 用 \n 拼接
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => [k, v] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = await hmacSha256(new TextEncoder().encode('WebAppData'), botToken);
  const computed = toHex(await hmacSha256(secret, dataCheckString));
  if (computed !== hash) return { ok: false, reason: 'bad_hash' };

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || now / 1000 - authDate > maxAgeSec) return { ok: false, reason: 'expired' };

  let user: TgInitUser | undefined;
  const userRaw = params.get('user');
  if (userRaw) {
    try {
      user = JSON.parse(userRaw) as TgInitUser;
    } catch {
      return { ok: false, reason: 'bad_user_json' };
    }
  }
  return { ok: true, user };
}

// ──────────────── 技师 → inline 结果卡 ────────────────

interface TherapistLike {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  serviceCity: string | null;
  serviceMode?: 'outcall' | 'incall' | 'both' | null;
  tags: string[] | null;
  basePriceJson: unknown;
  scoreAppearance: number;
  scoreBody: number;
  scoreService: number;
}

/** 法币符号(与 0027 currencies 一致)· 未知币种回退 code */
const CUR_SYMBOL: Record<string, string> = {
  THB: '฿', SGD: 'S$', MYR: 'RM', IDR: 'Rp', USD: '$',
  VND: '₫', PHP: '₱', CNY: '¥', HKD: 'HK$', TWD: 'NT$', JPY: '¥', KRW: '₩',
};

/** 价格标签 · 优先法币(priceFiat+currencyCode),无则回退积分 */
export function priceLabel(basePriceJson: unknown): string {
  const tiers = (Array.isArray(basePriceJson) ? basePriceJson : []) as Array<{
    duration?: number;
    pricePoints?: number;
    priceFiat?: number;
    currencyCode?: string;
  }>;
  const first = tiers[0];
  if (!first) return '';
  if (first.priceFiat != null && first.currencyCode) {
    const sym = CUR_SYMBOL[first.currencyCode] ?? `${first.currencyCode} `;
    return `${sym}${Number(first.priceFiat).toLocaleString('en-US')}`;
  }
  return first.pricePoints != null ? `${first.pricePoints} 积分` : '';
}

/** 服务方式标签 · outcall=上门 / incall=到店 / both=上门或到店 */
export function serviceModeLabel(mode?: string | null): string {
  return mode === 'incall' ? '到店' : mode === 'both' ? '上门或到店' : '上门';
}

function scoreLabel(t: TherapistLike): string {
  // 与首页一致的展示口径
  return ((t.scoreAppearance + t.scoreBody + t.scoreService) / 300).toFixed(1);
}

/**
 * 技师 → InlineQueryResultPhoto。无头像的技师跳过（返回 null，调用方过滤）。
 * deepLinkBase 形如 https://t.me/<botUsername>?start= ；缺则按钮降级用 miniAppUrl。
 */
export function therapistToInlinePhoto(
  t: TherapistLike,
  opts: { botUsername?: string; miniAppUrl?: string },
): Record<string, unknown> | null {
  if (!t.avatarUrl) return null; // inline photo 必须有 https 图
  const name = t.displayName ?? '技师';
  const tag = (t.tags ?? [])[0] ?? '按摩';
  const price = priceLabel(t.basePriceJson);
  const mode = serviceModeLabel(t.serviceMode);
  const desc = [t.serviceCity, tag, mode, price, `★${scoreLabel(t)}`].filter(Boolean).join(' · ');

  const button = opts.botUsername
    ? { text: '打开 / 约 →', url: `https://t.me/${opts.botUsername}?start=t_${t.id}` }
    : opts.miniAppUrl
      ? { text: '打开 / 约 →', web_app: { url: `${opts.miniAppUrl}/therapist/${t.id}` } }
      : undefined;

  return {
    type: 'photo',
    id: t.id,
    photo_url: t.avatarUrl,
    thumbnail_url: t.avatarUrl,
    // 必带宽高:头像源比例杂(横400×267/竖600×899/竖450×800),不声明则 TG 把不同比例
    // 硬塞统一格子 → 变形。统一声明竖版 3:4,客户端按此比例居中裁切(cover),不拉伸,画廊也整齐。
    photo_width: 600,
    photo_height: 800,
    title: name,
    description: desc,
    caption: `${name}${t.serviceCity ? ' · ' + t.serviceCity : ''}\n${[tag, mode, price, `★${scoreLabel(t)}`].filter(Boolean).join(' · ')}`,
    ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
  };
}
