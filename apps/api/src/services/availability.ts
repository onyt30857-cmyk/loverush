/**
 * M07 · 技师可约时段算法
 *
 * 输入:therapistUserId + date(YYYY-MM-DD,技师所在时区)+ duration(可选,默认 60)
 * 输出:Array<{ start: 'HH:MM', end: 'HH:MM', available: boolean, reason?: string }>
 *
 * 算法:
 *   1. 拿当天 weekday 的 working_hours · 无 → 全天 unavailable
 *   2. 按 slot_minutes 切片(默认 30 min)
 *   3. 减去:
 *      - 已下单的 orders.scheduled_at(占用 duration + buffer)
 *      - therapist_unavailable_period 跟当天 overlap 的
 *
 * 时区策略 v1:全部按 UTC 计算 · 客户端 / 技师端按 service_city 默认时区显示。
 * 后续 P1 可拆 service_city → IANA tz 字符串。
 */

import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import {
  therapists,
  therapistWorkingHours,
  therapistUnavailablePeriod,
  orders,
} from '@loverush/db';

export interface AvailabilitySlot {
  /** UTC ISO · 'YYYY-MM-DDTHH:MM:00Z' */
  startAt: string;
  endAt: string;
  /** 该 slot 是否可约 */
  available: boolean;
  /** 不可约原因:'booked' / 'closed' / 'time_off' */
  reason?: 'booked' | 'closed' | 'time_off';
}

export interface ComputeAvailabilityArgs {
  /** 技师 user_id(不是 therapist.id) */
  therapistUserId: string;
  /** 当地日期 YYYY-MM-DD · 用 service_city 时区(v1 当 UTC) */
  date: string;
  /** 服务时长(分钟)· 默认 60 · 用于占用 + 末尾 slot 跨界判断 */
  durationMinutes?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 解析 HH:MM:SS 或 HH:MM 为 (hour, minute)
 */
function parseTime(s: string): { h: number; m: number } {
  const m = /^(\d{2}):(\d{2})/.exec(s);
  if (!m) return { h: 0, m: 0 };
  return { h: parseInt(m[1]!, 10), m: parseInt(m[2]!, 10) };
}

/**
 * 把 date(YYYY-MM-DD) + 时间(HH:MM)拼成 UTC Date
 * (v1 当作 UTC · v2 接入 city → tz 换 zonedTimeToUtc)
 */
function dateAtTime(date: string, h: number, m: number): Date {
  return new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
}

/**
 * 两区间是否 overlap(开闭半开同 SQL OVERLAPS 语义)
 */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export async function computeAvailability(
  db: Database,
  args: ComputeAvailabilityArgs,
): Promise<AvailabilitySlot[]> {
  const { therapistUserId, date } = args;
  const duration = args.durationMinutes ?? 60;

  // 1. 技师配置 · slot_minutes / buffer_minutes
  const t = await db.query.therapists.findFirst({
    where: eq(therapists.userId, therapistUserId),
    columns: { slotMinutes: true, bufferMinutes: true },
  });
  if (!t) return [];
  const slotMin = t.slotMinutes ?? 30;
  const buffer = t.bufferMinutes ?? 15;

  // 2. 该日 weekday 的 working_hours
  const dayStart = new Date(`${date}T00:00:00Z`);
  if (isNaN(dayStart.getTime())) return [];
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const weekday = dayStart.getUTCDay(); // 0=Sun ... 6=Sat

  const wh = await db.query.therapistWorkingHours.findFirst({
    where: and(
      eq(therapistWorkingHours.therapistUserId, therapistUserId),
      eq(therapistWorkingHours.weekday, weekday),
    ),
  });
  if (!wh || !wh.isActive) {
    // 全天不接单
    return [];
  }

  // 3. 当天已下单 · 排除 cancelled
  const bookings = await db
    .select({
      scheduledAt: orders.scheduledAt,
      // durationMin 嵌在 service_snapshot jsonb · 用 SQL 解析
      durationMin: sql<number | null>`(${orders.serviceSnapshot}->>'durationMin')::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.therapistUserId, therapistUserId),
        gte(orders.scheduledAt, dayStart),
        lt(orders.scheduledAt, new Date(dayEnd.getTime() + DAY_MS)), // 跨日订单也算
        sql`${orders.status} NOT IN ('CANCELLED', 'CLOSED')`,
      ),
    );

  // 4. 当天 unavailable 期间
  const offs = await db
    .select()
    .from(therapistUnavailablePeriod)
    .where(
      and(
        eq(therapistUnavailablePeriod.therapistUserId, therapistUserId),
        lt(therapistUnavailablePeriod.startAt, dayEnd),
        sql`${therapistUnavailablePeriod.endAt} > ${dayStart.toISOString()}`,
      ),
    );

  // 5. 生成 slots
  const { h: startH, m: startM } = parseTime(wh.startTime);
  const { h: endH, m: endM } = parseTime(wh.endTime);
  const workStart = dateAtTime(date, startH, startM);
  const workEnd = dateAtTime(date, endH, endM);

  const slots: AvailabilitySlot[] = [];
  for (
    let cur = workStart.getTime();
    cur + duration * 60_000 <= workEnd.getTime();
    cur += slotMin * 60_000
  ) {
    const slotStart = new Date(cur);
    const slotEnd = new Date(cur + duration * 60_000);

    // 是否被已 booked 单占用(占用 = scheduled_at ~ scheduled_at + duration + buffer)
    let conflict: AvailabilitySlot['reason'] | undefined;
    for (const b of bookings) {
      if (!b.scheduledAt) continue;
      const bStart = b.scheduledAt;
      const bDur = b.durationMin ?? 60;
      const bEnd = new Date(bStart.getTime() + (bDur + buffer) * 60_000);
      if (overlaps(slotStart, slotEnd, bStart, bEnd)) {
        conflict = 'booked';
        break;
      }
    }

    if (!conflict) {
      for (const off of offs) {
        if (overlaps(slotStart, slotEnd, off.startAt, off.endAt)) {
          conflict = 'time_off';
          break;
        }
      }
    }

    slots.push({
      startAt: slotStart.toISOString(),
      endAt: slotEnd.toISOString(),
      available: !conflict,
      ...(conflict ? { reason: conflict } : {}),
    });
  }

  return slots;
}

/**
 * 给定下单时刻 + 时长 · 校验是否冲突
 * createOrder / confirmOrder 调用 · 返冲突的具体原因
 */
export async function checkBookingConflict(
  db: Database,
  args: {
    therapistUserId: string;
    scheduledAt: Date;
    durationMin: number;
  },
): Promise<{ ok: true } | { ok: false; reason: 'booked' | 'closed' | 'time_off' | 'past' }> {
  const { therapistUserId, scheduledAt, durationMin } = args;

  // 过去 reject
  if (scheduledAt.getTime() < Date.now() - 60_000) {
    return { ok: false, reason: 'past' };
  }

  // 拿技师配置
  const t = await db.query.therapists.findFirst({
    where: eq(therapists.userId, therapistUserId),
    columns: { bufferMinutes: true },
  });
  const buffer = t?.bufferMinutes ?? 15;

  const slotStart = scheduledAt;
  const slotEnd = new Date(slotStart.getTime() + (durationMin + buffer) * 60_000);
  const weekday = slotStart.getUTCDay();

  // working_hours 校验
  const wh = await db.query.therapistWorkingHours.findFirst({
    where: and(
      eq(therapistWorkingHours.therapistUserId, therapistUserId),
      eq(therapistWorkingHours.weekday, weekday),
    ),
  });
  if (!wh || !wh.isActive) return { ok: false, reason: 'closed' };

  // 时段需全落在 working_hours 内
  const { h: startH, m: startM } = parseTime(wh.startTime);
  const { h: endH, m: endM } = parseTime(wh.endTime);
  const date = slotStart.toISOString().slice(0, 10);
  const workStart = dateAtTime(date, startH, startM);
  const workEnd = dateAtTime(date, endH, endM);
  if (slotStart < workStart || slotEnd > workEnd) {
    return { ok: false, reason: 'closed' };
  }

  // 已 booked 冲突
  const bookings = await db
    .select({
      scheduledAt: orders.scheduledAt,
      // durationMin 嵌在 service_snapshot jsonb · 用 SQL 解析
      durationMin: sql<number | null>`(${orders.serviceSnapshot}->>'durationMin')::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.therapistUserId, therapistUserId),
        gte(orders.scheduledAt, new Date(slotStart.getTime() - DAY_MS)),
        lt(orders.scheduledAt, new Date(slotEnd.getTime() + DAY_MS)),
        sql`${orders.status} NOT IN ('CANCELLED', 'CLOSED')`,
      ),
    );
  for (const b of bookings) {
    if (!b.scheduledAt) continue;
    const bStart = b.scheduledAt;
    const bDur = b.durationMin ?? 60;
    const bEnd = new Date(bStart.getTime() + (bDur + buffer) * 60_000);
    if (overlaps(slotStart, slotEnd, bStart, bEnd)) {
      return { ok: false, reason: 'booked' };
    }
  }

  // unavailable 期间
  const offs = await db
    .select()
    .from(therapistUnavailablePeriod)
    .where(
      and(
        eq(therapistUnavailablePeriod.therapistUserId, therapistUserId),
        lt(therapistUnavailablePeriod.startAt, slotEnd),
        sql`${therapistUnavailablePeriod.endAt} > ${slotStart.toISOString()}`,
      ),
    );
  if (offs.length > 0) return { ok: false, reason: 'time_off' };

  return { ok: true };
}
