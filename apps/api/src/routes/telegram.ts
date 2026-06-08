/**
 * M17 · Telegram 渠道 webhook · POST /webhooks/telegram
 *
 * 不走 auth；用 setWebhook 时设的 secret_token（X-Telegram-Bot-Api-Secret-Token header）校验来源。
 * 分流三类 update：
 *  - inline_query        : 接现有技师搜索 → answerInlineQuery 出技师卡（截图那个功能）
 *  - message(/start ...) : deeplink t_<id> → 回技师详情卡；无 payload → 欢迎 + 打开 App
 *  - chosen_inline_result: 埋点（用户真正点中哪张卡）
 *
 * 缺 TELEGRAM_BOT_TOKEN 时整体 noop（返回 200 但不处理），不影响主服务。
 */
import { Hono } from 'hono';
import { getDb } from '../db';
import { logger } from '../services/logger';
import {
  tgConfig,
  isTelegramConfigured,
  answerInlineQuery,
  sendPhoto,
  sendMessage,
  therapistToInlinePhoto,
  priceLabel,
  serviceModeLabel,
  answerCallbackQuery,
  editMessageText,
} from '../services/telegram';
import { listTherapists, getTherapistView } from '../services/therapists';
import { getAppConfig } from '../services/app-config';
import { buildCityMenu, buildTherapistList, parseCallback } from '../services/telegram-directory';

export const telegramRoutes = new Hono();

const INLINE_PAGE = 20;

// Bot 文案 · 后台 app_config(bot.texts)可改 · 缺配置回退硬编码(永不假装数据)
interface BotTexts {
  welcomeMessage: string;
  startButton: string;
  inlineButton: string;
  bookButton: string;
  notFound: string;
  // 持久快捷栏(reply keyboard)三个按钮文案 · emoji 随文字一起渲染
  quickDiscover: string;
  quickRecharge: string;
  quickProfile: string;
}
const BOT_TEXTS_FALLBACK: BotTexts = {
  welcomeMessage: '想找放松一下？点下面打开看看吧～',
  startButton: '打开 App',
  inlineButton: '打开 App 浏览全部',
  bookButton: '在 App 内约 →',
  notFound: '没找到这位技师，换一个试试～',
  quickDiscover: '💆 选技师',
  quickRecharge: '💰 充值',
  quickProfile: '👤 我的',
};
// 合并 fallback:DB 里的 bot.texts 是旧配置、可能缺新增字段(如 quick*),
// getAppConfig 不做字段级合并 → 缺的字段会是 undefined → reply keyboard 按钮丢 text 被 TG 拒。
// 用 fallback 兜底每个字段,保证永远完整(未来给 BotTexts 加字段也不会再踩这坑)。
const botTexts = async (): Promise<BotTexts> => ({
  ...BOT_TEXTS_FALLBACK,
  ...(await getAppConfig<Partial<BotTexts>>('bot.texts', {})),
});

telegramRoutes.post('/', async (c) => {
  // 来源校验：配了 secret 就必须匹配，否则拒
  const { webhookSecret } = tgConfig();
  if (webhookSecret && c.req.header('X-Telegram-Bot-Api-Secret-Token') !== webhookSecret) {
    return c.json({ ok: false }, 401);
  }
  if (!isTelegramConfigured()) return c.json({ ok: true }); // 未配置 → noop

  let update: TgUpdate;
  try {
    update = (await c.req.json()) as TgUpdate;
  } catch {
    return c.json({ ok: true });
  }

  try {
    if (update.inline_query) {
      await handleInline(update.inline_query);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message?.text?.startsWith('/start')) {
      await handleStart(update.message);
    } else if (update.message?.text?.startsWith('/browse')) {
      await handleBrowse(update.message.chat.id);
    } else if (update.chosen_inline_result) {
      logger.info('telegram.chosen_inline', {
        therapistId: update.chosen_inline_result.result_id,
        tgUserId: update.chosen_inline_result.from?.id,
      });
    }
  } catch (err) {
    logger.warn('telegram.update_failed', { err: err instanceof Error ? err.message : String(err) });
  }
  // 无论如何回 200，避免 TG 重投
  return c.json({ ok: true });
});

async function handleInline(q: TgInlineQuery): Promise<void> {
  const offset = Number(q.offset || 0) || 0;
  const ctx = { db: getDb() };
  const query = q.query?.trim();
  // inline 查询多为地名 → 先按城市精确匹配；空则回退按名字模糊；空查询给默认列表
  let data: Awaited<ReturnType<typeof listTherapists>>['data'] = [];
  if (!query) {
    data = (await listTherapists(ctx, { limit: INLINE_PAGE, offset })).data;
  } else {
    data = (await listTherapists(ctx, { city: query, limit: INLINE_PAGE, offset })).data;
    if (data.length === 0) {
      data = (await listTherapists(ctx, { search: query, limit: INLINE_PAGE, offset })).data;
    }
  }
  const { botUsername, miniAppUrl } = tgConfig();
  const tx = await botTexts();
  const results = data
    .map((t) => therapistToInlinePhoto(t, { botUsername, miniAppUrl }))
    .filter((r): r is Record<string, unknown> => r !== null);

  await answerInlineQuery({
    inline_query_id: q.id,
    results,
    next_offset: data.length < INLINE_PAGE ? '' : String(offset + INLINE_PAGE),
    ...(miniAppUrl ? { button: { text: tx.inlineButton, web_app: { url: miniAppUrl } } } : {}),
  });
}

// 城市目录:新发一条消息(/browse 命令 / /start browse 深链)
async function handleBrowse(chatId: number): Promise<void> {
  const menu = await buildCityMenu({ db: getDb() });
  await sendMessage({ chat_id: chatId, text: menu.text, reply_markup: menu.reply_markup });
}

// 目录翻页/进城市:就地编辑同一条消息(callback_query)
async function handleCallback(cb: TgCallbackQuery): Promise<void> {
  const nav = parseCallback(cb.data);
  const msg = cb.message;
  if (!nav || !msg) {
    await answerCallbackQuery({ callback_query_id: cb.id });
    return;
  }
  const ctx = { db: getDb() };
  const menu = nav.type === 'root' ? await buildCityMenu(ctx) : await buildTherapistList(ctx, nav.idx, nav.page);
  await editMessageText({
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    text: menu.text,
    reply_markup: menu.reply_markup,
  });
  await answerCallbackQuery({ callback_query_id: cb.id });
}

async function handleStart(message: TgMessage): Promise<void> {
  const chatId = message.chat.id;
  const payload = (message.text ?? '').split(/\s+/)[1]?.trim() ?? '';
  const { miniAppUrl } = tgConfig();
  const tx = await botTexts();

  // 深链 ?start=browse → 直接出城市目录(供频道置顶分享)
  if (payload === 'browse') {
    await handleBrowse(chatId);
    return;
  }

  if (payload.startsWith('t_')) {
    const therapistId = payload.slice(2);
    try {
      const t = await getTherapistView({ db: getDb() }, { therapistId });
      const tag = (t.tags ?? [])[0] ?? '按摩';
      const price = priceLabel(t.basePriceJson);
      const mode = serviceModeLabel(t.serviceMode);
      const caption = `${t.displayName ?? '技师'}${t.serviceCity ? ' · ' + t.serviceCity : ''}\n${[tag, mode, price].filter(Boolean).join(' · ')}`;
      const button = miniAppUrl
        ? { text: tx.bookButton, web_app: { url: `${miniAppUrl}/therapist/${therapistId}` } }
        : undefined;
      if (t.avatarUrl) {
        await sendPhoto({
          chat_id: chatId,
          photo: t.avatarUrl,
          caption,
          ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
        });
      } else {
        await sendMessage({
          chat_id: chatId,
          text: caption,
          ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
        });
      }
    } catch {
      await sendMessage({ chat_id: chatId, text: tx.notFound });
    }
    return;
  }

  // 普通 /start：① 欢迎语 + 持久快捷栏(首页/帮助/我的) ② 浏览技师目录入口
  // reply keyboard 不支持 callback_data,浏览目录靠 callback 翻页 → 两者无法共存一条消息,拆两条发
  if (miniAppUrl) {
    await sendMessage({
      chat_id: chatId,
      text: tx.welcomeMessage,
      reply_markup: {
        keyboard: [
          [
            { text: tx.quickDiscover, web_app: { url: `${miniAppUrl}/discover` } },
            { text: tx.quickRecharge, web_app: { url: `${miniAppUrl}/me/recharge` } },
            { text: tx.quickProfile, web_app: { url: `${miniAppUrl}/me` } },
          ],
        ],
        resize_keyboard: true,
        is_persistent: true,
      },
    });
  }
  await sendMessage({
    chat_id: chatId,
    text: miniAppUrl ? '想直接挑技师？👇' : tx.welcomeMessage,
    reply_markup: { inline_keyboard: [[{ text: '🏙 浏览技师目录', callback_data: 'root' }]] },
  });
}

// ──────────────── 最小 update 类型（只取我们用到的字段） ────────────────
interface TgUpdate {
  inline_query?: TgInlineQuery;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  chosen_inline_result?: { result_id: string; from?: { id: number } };
}
interface TgCallbackQuery {
  id: string;
  data?: string;
  from?: { id: number };
  message?: { chat: { id: number }; message_id: number };
}
interface TgInlineQuery {
  id: string;
  from?: { id: number };
  query?: string;
  offset?: string;
}
interface TgMessage {
  chat: { id: number };
  text?: string;
}
