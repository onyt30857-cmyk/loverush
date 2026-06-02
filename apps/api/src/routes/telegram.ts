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
} from '../services/telegram';
import { listTherapists, getTherapistView } from '../services/therapists';

export const telegramRoutes = new Hono();

const INLINE_PAGE = 20;

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
    } else if (update.message?.text?.startsWith('/start')) {
      await handleStart(update.message);
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
  const search = q.query?.trim() || undefined;
  const { data } = await listTherapists({ db: getDb() }, { search, limit: INLINE_PAGE, offset });
  const { botUsername, miniAppUrl } = tgConfig();
  const results = data
    .map((t) => therapistToInlinePhoto(t, { botUsername, miniAppUrl }))
    .filter((r): r is Record<string, unknown> => r !== null);

  await answerInlineQuery({
    inline_query_id: q.id,
    results,
    next_offset: data.length < INLINE_PAGE ? '' : String(offset + INLINE_PAGE),
    ...(miniAppUrl ? { button: { text: '打开 App 浏览全部', web_app: { url: miniAppUrl } } } : {}),
  });
}

async function handleStart(message: TgMessage): Promise<void> {
  const chatId = message.chat.id;
  const payload = (message.text ?? '').split(/\s+/)[1]?.trim() ?? '';
  const { miniAppUrl } = tgConfig();

  if (payload.startsWith('t_')) {
    const therapistId = payload.slice(2);
    try {
      const t = await getTherapistView({ db: getDb() }, { therapistId });
      const tag = (t.tags ?? [])[0] ?? '按摩';
      const caption = `${t.displayName ?? '技师'}${t.serviceCity ? ' · ' + t.serviceCity : ''}\n${tag}`;
      const button = miniAppUrl
        ? { text: '在 App 内约 →', web_app: { url: `${miniAppUrl}/therapist/${therapistId}` } }
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
      await sendMessage({ chat_id: chatId, text: '没找到这位技师，换一个试试～' });
    }
    return;
  }

  // 普通 /start：欢迎 + 打开 App
  await sendMessage({
    chat_id: chatId,
    text: '想找放松一下？点下面打开看看吧～',
    ...(miniAppUrl ? { reply_markup: { inline_keyboard: [[{ text: '打开 App', web_app: { url: miniAppUrl } }]] } } : {}),
  });
}

// ──────────────── 最小 update 类型（只取我们用到的字段） ────────────────
interface TgUpdate {
  inline_query?: TgInlineQuery;
  message?: TgMessage;
  chosen_inline_result?: { result_id: string; from?: { id: number } };
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
