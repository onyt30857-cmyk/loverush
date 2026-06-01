/**
 * 预警 Webhook · severity≥80 立即推 Discord/Slack/TG(通用 JSON)
 *
 * 设计:
 *   - 通用 JSON POST · 用户在 Discord/Slack/n8n/Zapier 自己 mapping 格式
 *   - 内存节流:同 fingerprint 1h 内只发 1 次(防错误风暴)
 *   - fire-and-forget · 永不阻塞主调用
 *   - 缺 ALERT_WEBHOOK_URL 时全部 noop
 *
 * Discord 配置示例(server settings → integrations → webhook):
 *   ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/xxx/yyy
 *
 * Slack 配置示例(api.slack.com → incoming webhooks):
 *   ALERT_WEBHOOK_URL=https://hooks.slack.com/services/T0/B0/xxx
 *
 * Telegram 配置示例(BotFather 拿 token → 用 webhook 中转 e.g. zapier):
 *   ALERT_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/xxx
 */

import { loadEnv } from '../env';
import { logger } from './logger';

export interface AlertPayload {
  type: 'system_error' | 'login_anomaly';
  severity: number;
  /** 错误指纹 · 节流 key */
  fingerprint: string;
  errorType?: string;
  errorCode?: string | null;
  httpStatus?: number | null;
  route?: string | null;
  method?: string | null;
  message: string;
  count?: number;
  /** admin 后台直跳 URL */
  admin_url: string;
  /** ISO timestamp */
  occurred_at: string;
}

// 内存节流(进程重启清空 · Railway 单实例)
// Key = fingerprint + ':' + type
const cooldownMap = new Map<string, number>();

function shouldAlert(fingerprint: string, type: string): boolean {
  const env = loadEnv();
  const cooldownMs = env.ALERT_COOLDOWN_SECONDS * 1000;
  const key = `${fingerprint}:${type}`;
  const lastMs = cooldownMap.get(key);
  if (lastMs && Date.now() - lastMs < cooldownMs) return false;
  cooldownMap.set(key, Date.now());
  return true;
}

/**
 * 发送预警 webhook(fire-and-forget · 同时支持 Discord/Slack 通用格式 + Telegram bot 原生协议)
 * 失败只 log · 永不抛错
 */
export async function sendAlertWebhook(payload: AlertPayload): Promise<void> {
  const env = loadEnv();
  const hasGeneric = !!env.ALERT_WEBHOOK_URL;
  const hasTelegram = !!(env.ALERT_TELEGRAM_BOT_TOKEN && env.ALERT_TELEGRAM_CHAT_ID);
  if (!hasGeneric && !hasTelegram) return; // 无任何渠道 · noop

  if (!shouldAlert(payload.fingerprint, payload.type)) {
    return; // 节流期内 · 跳过
  }

  const summary = formatSummary(payload);

  // 通道 1:Discord/Slack 通用 webhook
  if (hasGeneric) {
    const body = {
      content: summary, // Discord
      text: summary,    // Slack
      ...payload,       // 通用 detail(Zap/n8n 用)
    };
    try {
      const res = await fetch(env.ALERT_WEBHOOK_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        logger.error('alert.webhook_failed', {
          status: res.status,
          fingerprint: payload.fingerprint,
        });
      }
    } catch (e) {
      logger.error('alert.webhook_throw', {
        err: e instanceof Error ? e.message : String(e),
        fingerprint: payload.fingerprint,
      });
    }
  }

  // 通道 2:Telegram bot sendMessage(原生协议 · chat_id 必填)
  if (hasTelegram) {
    const url = `https://api.telegram.org/bot${env.ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.ALERT_TELEGRAM_CHAT_ID,
          text: summary,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        logger.error('alert.telegram_failed', {
          status: res.status,
          body: txt.slice(0, 200),
          fingerprint: payload.fingerprint,
        });
      }
    } catch (e) {
      logger.error('alert.telegram_throw', {
        err: e instanceof Error ? e.message : String(e),
        fingerprint: payload.fingerprint,
      });
    }
  }
}

function formatSummary(p: AlertPayload): string {
  const icon = p.severity >= 90 ? '🚨' : p.severity >= 80 ? '⚠️' : '⚡';
  const title = p.type === 'system_error' ? '系统报错' : '登录异常';
  const parts = [
    `${icon} **${title}** · severity=${p.severity}`,
  ];
  if (p.errorCode) parts.push(`code: ${p.errorCode}`);
  if (p.route && p.method) parts.push(`${p.method} ${p.route}`);
  if (p.httpStatus) parts.push(`HTTP ${p.httpStatus}`);
  if (p.count && p.count > 1) parts.push(`× ${p.count}`);
  parts.push(`msg: ${p.message.slice(0, 200)}`);
  parts.push(`查看: ${p.admin_url}`);
  return parts.join('\n');
}

/**
 * V2 邮件预警(Resend API · 无新 npm 依赖 · 纯 fetch)
 * 仅 severity≥90 触发(邮件干扰大于 webhook · 阈值更严)
 * 缺 RESEND_API_KEY / ALERT_EMAIL_TO 时 noop
 */
export async function sendAlertEmail(payload: AlertPayload): Promise<void> {
  const env = loadEnv();
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_TO) return;

  // 节流复用 webhook 的 map · 但 key 加 ":email" 区分
  if (!shouldAlert(payload.fingerprint, `${payload.type}:email`)) return;

  const recipients = env.ALERT_EMAIL_TO.split(',').map((s) => s.trim()).filter(Boolean);
  if (recipients.length === 0) return;

  const subject = `${payload.severity >= 90 ? '🚨' : '⚠️'} [LoveRush ${payload.type === 'system_error' ? '系统报错' : '登录异常'}] sev=${payload.severity} · ${payload.route ?? payload.errorCode ?? 'unknown'}`;
  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="color:#dc2626;margin-top:0;">系统预警 · severity=${payload.severity}</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <tr><td style="padding:4px 8px;color:#6b7280;">类型</td><td style="padding:4px 8px;"><b>${payload.errorType ?? '-'}</b></td></tr>
        ${payload.errorCode ? `<tr><td style="padding:4px 8px;color:#6b7280;">错误码</td><td style="padding:4px 8px;"><code>${payload.errorCode}</code></td></tr>` : ''}
        ${payload.route ? `<tr><td style="padding:4px 8px;color:#6b7280;">路由</td><td style="padding:4px 8px;"><code>${payload.method ?? ''} ${payload.route}</code></td></tr>` : ''}
        ${payload.httpStatus ? `<tr><td style="padding:4px 8px;color:#6b7280;">HTTP</td><td style="padding:4px 8px;">${payload.httpStatus}</td></tr>` : ''}
        ${payload.count && payload.count > 1 ? `<tr><td style="padding:4px 8px;color:#6b7280;">已触发</td><td style="padding:4px 8px;"><b>× ${payload.count}</b></td></tr>` : ''}
      </table>
      <div style="margin:16px 0;padding:12px;background:#fef2f2;border-left:3px solid #dc2626;font-family:monospace;font-size:13px;">
        ${payload.message.slice(0, 500).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c)}
      </div>
      <a href="${payload.admin_url}" style="display:inline-block;padding:10px 20px;background:#dc2626;color:white;text-decoration:none;border-radius:6px;font-weight:600;">打开监管页 →</a>
      <p style="color:#9ca3af;font-size:11px;margin-top:24px;">fingerprint: ${payload.fingerprint.slice(0, 16)} · ${payload.occurred_at}</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.ALERT_EMAIL_FROM,
        to: recipients,
        subject,
        html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      logger.error('alert.email_failed', {
        status: res.status,
        body: txt.slice(0, 200),
        fingerprint: payload.fingerprint,
      });
    }
  } catch (e) {
    logger.error('alert.email_throw', {
      err: e instanceof Error ? e.message : String(e),
      fingerprint: payload.fingerprint,
    });
  }
}
