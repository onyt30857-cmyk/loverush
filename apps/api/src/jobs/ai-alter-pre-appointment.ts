/**
 * Job · 技师分身「临近预约·期待话」· 每 30min 扫一次（Phase C2）
 *
 * 流程：
 *   1. 扫 orders：未开始(待确认/已锁定/已付) + 有 scheduled_at + 技师 ai_alter_enabled=1 + 未拉黑
 *      + 频率帽未近触达（crp.last_proactive_at NULL 或 < NOW()-4h，复用现有时间戳·无需新列）。
 *   2. JS 按技师时区算「真实预约时刻」(scheduled_at 是 UTC 墙上时间),只在真实预约前 2.5h 内触达。
 *   3. proactiveReachOut(pre_appointment)：以技师本人身份发一句又暖又期待的话——「快见面啦,我准备好啦」,
 *      把等待做成期待峰值(Peak)。纯情绪价值零推销;事实边界护栏防越权承诺(不改时间/价格)。
 *
 * 时区:scheduled_at 是 UTC 容器墙上时间(T19:00:00Z 即技师眼中 19:00),需按技师时区还原真实时刻。
 * 单实例假设(同其它 setInterval job);last_proactive_at 防重 + 真实时刻窗口 → 每单只触达一次。
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { proactiveReachOut } from '../services/ai_alter';
import { resolveTz } from '../services/therapist_facts';
import { logger } from '../services/logger';

export interface JobContext {
  db: Database;
}

interface Row {
  customer_id: string;
  therapist_user_id: string;
  scheduled_at: string | Date;
  service_country: string | null;
  service_city: string | null;
}

/** tz 在某时刻的偏移分钟(local - utc) */
function tzOffsetMin(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  let hh = get('hour');
  if (hh === 24) hh = 0;
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), hh, get('minute'), get('second'));
  return Math.round((asUTC - at.getTime()) / 60_000);
}
/** UTC 墙上时间 → 真实 epoch ms(按技师时区还原) */
export function realEpoch(scheduledAt: string | Date, tz: string): number {
  const wall = new Date(scheduledAt).getTime();
  return wall - tzOffsetMin(tz, new Date(wall)) * 60_000;
}

export async function runPreAppointmentReminder(ctx: JobContext): Promise<{ candidates: number; sent: number }> {
  const rows = (await ctx.db.execute(sql`
    SELECT o.customer_id, o.therapist_user_id, o.scheduled_at,
           t.service_country, t.service_city
    FROM orders o
    JOIN therapists t ON t.id = o.therapist_id
    LEFT JOIN customer_relationship_profile crp
      ON crp.customer_id = o.customer_id AND crp.therapist_id = o.therapist_id
    WHERE o.status IN ('PENDING_CONFIRM','CONFIRMED','LOCKED','PAID')
      AND o.scheduled_at IS NOT NULL
      AND o.scheduled_at > NOW() - INTERVAL '4 hours'
      AND o.scheduled_at < NOW() + INTERVAL '14 hours'
      AND t.ai_alter_enabled = 1
      AND (crp.is_blocked IS NULL OR crp.is_blocked = 0)
      AND (crp.last_proactive_at IS NULL OR crp.last_proactive_at < NOW() - INTERVAL '4 hours')
    LIMIT 200
  `)) as unknown as Row[];

  const now = Date.now();
  let sent = 0;
  for (const r of rows) {
    try {
      const tz = resolveTz({ serviceCountry: r.service_country, serviceCity: r.service_city });
      const ms = realEpoch(r.scheduled_at, tz) - now;
      if (ms <= 0 || ms > 2.5 * 3_600_000) continue; // 只在真实预约时刻 2.5h 内(且未到点)
      const res = await proactiveReachOut(
        { db: ctx.db },
        {
          customerId: r.customer_id,
          therapistUserId: r.therapist_user_id,
          scenario: 'pre_appointment',
          situationPrompt:
            `（内部触发·不是客户发来的消息）你和这位客户的预约快到了(就在两三小时内)。以你本人的身份,` +
            `主动发一句又暖又带期待的话——让 ta 感觉到你也在期待这次见面、你这边都准备好了、有点小雀跃。` +
            `就像真的要见一个在意的人那样。绝不提钱/不催/不报价/不加项/不推销,也不要重新承诺或改动时间地点,` +
            `就是纯粹的期待和暖意。短,像真人发微信。直接输出你要发的那一两句话。`,
        },
      );
      if (res.sent) sent++;
    } catch (err) {
      logger.warn('ai_alter.pre_appointment.user_failed', { customerId: r.customer_id, err: String(err) });
    }
  }
  logger.info('ai_alter.pre_appointment.done', { candidates: rows.length, sent });
  return { candidates: rows.length, sent };
}

let timer: NodeJS.Timeout | null = null;
export function startPreAppointmentReminderCron(ctx: JobContext, intervalMs = 30 * 60 * 1000): void {
  if (timer) return;
  timer = setInterval(() => {
    runPreAppointmentReminder(ctx).catch((err) => {
      logger.error('ai_alter.pre_appointment.tick_failed', { err: String(err) });
    });
  }, intervalMs);
}
export function stopPreAppointmentReminderCron(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
