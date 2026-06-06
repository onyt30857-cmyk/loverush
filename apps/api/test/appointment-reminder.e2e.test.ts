/**
 * 预约前两档提醒 cron e2e
 *
 * 注册 customer+therapist → 建一单 status=LOCKED + scheduled_at ~45 分钟后（落 1h 档）
 *   跑 cron → 客户+技师各收到 appointment_reminder 通知；reminder_1h_sent_at 落库
 *   再跑一次 → 不重复（去重）
 *
 * 跑:
 *   cd apps/api
 *   TEST_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed 's#/loverush$#/loverush_test#')
 *   DATABASE_URL="$TEST_URL" pnpm exec vitest run test/appointment-reminder.e2e.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { therapists } from '@loverush/db';
import { runAppointmentReminder } from '../src/jobs/appointment-reminder';
import { api, getDb, registerNew, truncateAll } from './helpers';

describe('appointment-reminder cron · 1h 档', () => {
  let customerId = '';
  let therapistUserId = '';
  let therapistId = '';
  let orderId = '';

  beforeAll(async () => {
    await truncateAll();

    const c = await registerNew('customer');
    const t = await registerNew('therapist');
    customerId = c.user.id;
    therapistUserId = t.user.id;

    // registerNew('therapist') 只建 users 行，therapists 行需要调 PUT /therapists/me
    await api.put('/therapists/me', {
      bio: '专业按摩 8 年',
      serviceCity: 'bangkok',
      serviceCountry: 'TH',
      skillsJson: [{ skill: '泰式', level: 5 }],
      basePriceJson: [{ duration: 60, pricePoints: 200 }],
    }, t.access_token);

    const db = await getDb();

    // 拿 therapist 行 id，并确保 service_country/service_city 已设（cron JOIN 需要）
    const therapistRow = await db.query.therapists.findFirst({
      where: eq(therapists.userId, therapistUserId),
    });
    if (!therapistRow) throw new Error('therapists row not found after PUT /therapists/me');
    therapistId = therapistRow.id;

    await db
      .update(therapists)
      .set({ serviceCountry: 'TH', serviceCity: 'bangkok', verificationStatus: 'passed' })
      .where(eq(therapists.id, therapistId));

    // 建一单：status=LOCKED，scheduled_at ~45 分钟后（落在 cron 1h 档）
    // NOT NULL 必填：order_no、service_snapshot、price_points
    //
    // scheduled_at 存「墙上时间装 UTC」：技师 service_city='bangkok'（Asia/Bangkok，UTC+7，固定偏移）。
    // realEpoch 会把墙上 UTC 值减去 +420min 还原真实 epoch。
    // 要让真实时刻 = now+45min，墙上 UTC 值需 = now + 45min + 7h。
    const scheduledIso = new Date(Date.now() + 45 * 60_000 + 7 * 60 * 60_000).toISOString();

    const orows = (await db.execute(sql`
      INSERT INTO orders (
        order_no,
        customer_id,
        therapist_id,
        therapist_user_id,
        status,
        scheduled_at,
        service_snapshot,
        price_points
      )
      VALUES (
        ${'APPT-REMIND-1H-' + Date.now()},
        ${customerId},
        ${therapistId},
        ${therapistUserId},
        'LOCKED',
        ${scheduledIso}::timestamptz,
        ${'{"skills":["泰式"],"durationMin":60,"pricePoints":200}'}::jsonb,
        ${200}
      )
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    orderId = orows[0]!.id;
  }, 30_000);

  it('1h 档：客户+技师各收到提醒 + reminder_1h_sent_at 落库', async () => {
    const db = await getDb();
    const res = await runAppointmentReminder({ db });
    expect(res.fired1h).toBeGreaterThanOrEqual(1);

    // 客户和技师都应收到 appointment_reminder 通知（按目标订单精确查）
    const notifs = (await db.execute(sql`
      SELECT recipient_user_id FROM notifications
      WHERE category = 'appointment_reminder'
        AND recipient_user_id IN (${customerId}, ${therapistUserId})
    `)) as unknown as Array<{ recipient_user_id: string }>;

    const recipients = new Set(notifs.map((n) => n.recipient_user_id));
    expect(recipients.has(customerId)).toBe(true);
    expect(recipients.has(therapistUserId)).toBe(true);

    // orders.reminder_1h_sent_at 应已落库
    const ord = (await db.execute(sql`
      SELECT reminder_1h_sent_at FROM orders WHERE id = ${orderId}
    `)) as unknown as Array<{ reminder_1h_sent_at: string | null }>;
    expect(ord[0]!.reminder_1h_sent_at).not.toBeNull();
  });

  it('二次扫：不重复推（去重）', async () => {
    const db = await getDb();
    const before = (await db.execute(sql`
      SELECT count(*)::int AS n FROM notifications WHERE category = 'appointment_reminder'
    `)) as unknown as Array<{ n: number }>;

    const res = await runAppointmentReminder({ db });
    // 已标记 reminder_1h_sent_at，cron 不应再次触发 1h 档
    expect(res.fired1h).toBe(0);

    const after = (await db.execute(sql`
      SELECT count(*)::int AS n FROM notifications WHERE category = 'appointment_reminder'
    `)) as unknown as Array<{ n: number }>;
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});

describe('appointment-reminder cron · 10m 档', () => {
  let customerId = '';
  let therapistUserId = '';
  let therapistId = '';
  let orderId = '';

  beforeAll(async () => {
    await truncateAll();

    const c = await registerNew('customer');
    const t = await registerNew('therapist');
    customerId = c.user.id;
    therapistUserId = t.user.id;

    await api.put('/therapists/me', {
      bio: '专业按摩 8 年',
      serviceCity: 'bangkok',
      serviceCountry: 'TH',
      skillsJson: [{ skill: '泰式', level: 5 }],
      basePriceJson: [{ duration: 60, pricePoints: 200 }],
    }, t.access_token);

    const db = await getDb();

    const therapistRow = await db.query.therapists.findFirst({
      where: eq(therapists.userId, therapistUserId),
    });
    if (!therapistRow) throw new Error('therapists row not found after PUT /therapists/me');
    therapistId = therapistRow.id;

    await db
      .update(therapists)
      .set({ serviceCountry: 'TH', serviceCity: 'bangkok', verificationStatus: 'passed' })
      .where(eq(therapists.id, therapistId));

    // 建一单：status=LOCKED，scheduled_at 真实还有 ~5 分钟（落在 cron 10m 档）
    // realEpoch 把墙上 UTC 减去 +7h 还原真实 epoch。
    // 要让真实时刻 = now+5min，墙上 UTC 值需 = now + 5min + 7h。
    const ten = new Date(Date.now() + 5 * 60_000 + 7 * 60 * 60_000).toISOString();

    const orows = (await db.execute(sql`
      INSERT INTO orders (
        order_no,
        customer_id,
        therapist_id,
        therapist_user_id,
        status,
        scheduled_at,
        service_snapshot,
        price_points
      )
      VALUES (
        ${'APPT-REMIND-10M-' + Date.now()},
        ${customerId},
        ${therapistId},
        ${therapistUserId},
        'LOCKED',
        ${ten}::timestamptz,
        ${'{"skills":["泰式"],"durationMin":60,"pricePoints":200}'}::jsonb,
        ${200}
      )
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    orderId = orows[0]!.id;
  }, 30_000);

  it('10m 档：客户+技师各收到提醒 + reminder_10m_sent_at 落库', async () => {
    const db = await getDb();
    const res = await runAppointmentReminder({ db });
    expect(res.fired10m).toBeGreaterThanOrEqual(1);

    // 按目标订单精确断言：客户和技师都收到 appointment_reminder（category 含"马上见面"文案）
    const notifs = (await db.execute(sql`
      SELECT recipient_user_id, title FROM notifications
      WHERE category = 'appointment_reminder'
        AND recipient_user_id IN (${customerId}, ${therapistUserId})
    `)) as unknown as Array<{ recipient_user_id: string; title: string }>;

    const recipients = new Set(notifs.map((n) => n.recipient_user_id));
    expect(recipients.has(customerId)).toBe(true);
    expect(recipients.has(therapistUserId)).toBe(true);

    // 10m 档 title 是"马上见面啦"
    const titles = notifs.map((n) => n.title);
    expect(titles.some((t) => t.includes('马上见面'))).toBe(true);

    // orders.reminder_10m_sent_at 应已落库
    const ord = (await db.execute(sql`
      SELECT reminder_10m_sent_at FROM orders WHERE id = ${orderId}
    `)) as unknown as Array<{ reminder_10m_sent_at: string | null }>;
    expect(ord[0]!.reminder_10m_sent_at).not.toBeNull();
  });

  it('10m 档二次扫：不重复推（去重）', async () => {
    const db = await getDb();
    const before = (await db.execute(sql`
      SELECT count(*)::int AS n FROM notifications WHERE category = 'appointment_reminder'
    `)) as unknown as Array<{ n: number }>;

    const res = await runAppointmentReminder({ db });
    // 已标记 reminder_10m_sent_at，cron 不应再次触发 10m 档
    expect(res.fired10m).toBe(0);

    const after = (await db.execute(sql`
      SELECT count(*)::int AS n FROM notifications WHERE category = 'appointment_reminder'
    `)) as unknown as Array<{ n: number }>;
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
