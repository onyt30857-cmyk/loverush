/**
 * Job · 预约前两档提醒（1 小时 / 10 分钟）
 * 扫 LOCKED/PAID 未开始订单 → 按技师时区还原真实时刻判档 →
 *   1h 档:系统推送给客户+技师
 *   10m 档:系统推送 + 触发技师分身"快到啦"暖意消息
 * 去重:orders.reminder_1h_sent_at / reminder_10m_sent_at
 *
 * 时区来源：service_country / service_city 在 therapists 表，需 JOIN 取得。
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { enqueue } from '../services/notifications';
import { proactiveReachOut } from '../services/ai_alter';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

/** 纯函数:给定距预约真实分钟数 + 两档已发标记,判定本轮该触发哪些档 */
export function classifyReminder(
  minutesUntil: number,
  sent1h: boolean,
  sent10m: boolean,
): { fire1h: boolean; fire10m: boolean } {
  if (minutesUntil <= 0) return { fire1h: false, fire10m: false };
  if (minutesUntil <= 10) {
    return { fire1h: false, fire10m: !sent10m };
  }
  if (minutesUntil <= 60) {
    return { fire1h: !sent1h, fire10m: false };
  }
  return { fire1h: false, fire10m: false };
}

interface DueRow {
  id: string;
  order_no: string | null;
  customer_id: string;
  therapist_user_id: string;
  scheduled_at: string;
  service_country: string | null;
  service_city: string | null;
  reminder_1h_sent_at: string | null;
  reminder_10m_sent_at: string | null;
}

export async function runAppointmentReminder(
  ctx: JobContext,
): Promise<{ scanned: number; fired1h: number; fired10m: number }> {
  const rows = (await ctx.db.execute(sql`
    SELECT o.id, o.order_no, o.customer_id, o.therapist_user_id, o.scheduled_at,
           t.service_country, t.service_city,
           o.reminder_1h_sent_at, o.reminder_10m_sent_at
    FROM orders o
    JOIN therapists t ON t.id = o.therapist_id
    WHERE o.status IN ('LOCKED','PAID')
      AND o.scheduled_at IS NOT NULL
      AND o.scheduled_at > now() - INTERVAL '15 minutes'
      AND o.scheduled_at < now() + INTERVAL '90 minutes'
    ORDER BY o.scheduled_at
    LIMIT 200
  `)) as unknown as DueRow[];

  let fired1h = 0;
  let fired10m = 0;
  const now = Date.now();

  for (const r of rows) {
    try {
      const minutesUntil = (new Date(r.scheduled_at).getTime() - now) / 60_000;
      const { fire1h, fire10m } = classifyReminder(
        minutesUntil,
        r.reminder_1h_sent_at != null,
        r.reminder_10m_sent_at != null,
      );

      if (fire1h) {
        await enqueue({ db: ctx.db }, {
          recipientUserId: r.customer_id,
          level: 'important',
          category: 'appointment_reminder',
          title: '预约提醒',
          body: '您预约的服务还有约 1 小时开始，点击查看详情',
          deepLink: `/order/${r.id}`,
        });
        await enqueue({ db: ctx.db }, {
          recipientUserId: r.therapist_user_id,
          level: 'important',
          category: 'appointment_reminder',
          title: '预约提醒',
          body: '您有一个预约还有约 1 小时开始，点击查看详情',
          deepLink: `/t/orders/${r.id}`,
        });
        await ctx.db.execute(sql`UPDATE orders SET reminder_1h_sent_at = now() WHERE id = ${r.id}`);
        fired1h++;
      }

      if (fire10m) {
        await enqueue({ db: ctx.db }, {
          recipientUserId: r.customer_id,
          level: 'important',
          category: 'appointment_reminder',
          title: '马上见面啦',
          body: '您预约的服务还有约 10 分钟就开始，点击查看详情',
          deepLink: `/order/${r.id}`,
        });
        await enqueue({ db: ctx.db }, {
          recipientUserId: r.therapist_user_id,
          level: 'important',
          category: 'appointment_reminder',
          title: '马上见面啦',
          body: '您有一个预约还有约 10 分钟就开始，点击查看详情',
          deepLink: `/t/orders/${r.id}`,
        });
        try {
          await proactiveReachOut({ db: ctx.db }, {
            customerId: r.customer_id,
            therapistUserId: r.therapist_user_id,
            scenario: 'pre_appointment_10min',
            situationPrompt:
              `（内部触发·不是客户发来的消息）你和这位客户的预约马上就到了（大约十分钟内就见面）。` +
              `以你本人的身份,主动发一句"我已经准备好啦、马上见到你好期待"那种又暖又雀跃的话。` +
              `绝不提钱/不催/不报价/不加项/不推销,也不要重新承诺或改时间地点。短,像真人发微信。直接输出那一两句话。`,
          });
        } catch (err) {
          logger.error('appointment_reminder.alter_failed', { orderId: r.id, err: String(err) });
        }
        await ctx.db.execute(sql`UPDATE orders SET reminder_10m_sent_at = now() WHERE id = ${r.id}`);
        fired10m++;
      }
    } catch (err) {
      logger.error('appointment_reminder.row_failed', { orderId: r.id, err: String(err) });
    }
  }

  if (fired1h > 0 || fired10m > 0) {
    logger.info('appointment_reminder.done', { scanned: rows.length, fired1h, fired10m });
  }
  return { scanned: rows.length, fired1h, fired10m };
}

let timer: NodeJS.Timeout | null = null;

export function startAppointmentReminderCron(ctx: JobContext, intervalMs = 2 * 60 * 1000): void {
  if (timer) return;
  void runAppointmentReminder(ctx).catch((err) =>
    logger.error('appointment_reminder.bootstrap_failed', { err: String(err) }),
  );
  timer = setInterval(() => {
    runAppointmentReminder(ctx).catch((err) =>
      logger.error('appointment_reminder.tick_failed', { err: String(err) }),
    );
  }, intervalMs);
}
