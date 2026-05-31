/* eslint-disable no-console */
/**
 * M06b ② · 拟人回复时机（延迟 + debounce + tick）· 本地验证（无需 LLM）
 *
 * 测：①延迟公式区间&深夜放慢 ②机器人表情校验 ③debounce 一会话一行 ④tick 到点原子领取。
 * 技师设 aiAlterEnabled=0 → tick 内 maybeReplyAsAlter 早退(不调 LLM)，纯测调度机制。
 *
 * 跑法：DATABASE_URL=<本地> bun scripts/verify-m06-reply-timing.mts
 */
import { sql, eq } from 'drizzle-orm';
import { createDb } from '@loverush/db';
import { users, therapists, conversations, aiAlterPendingReply } from '@loverush/db';
import {
  computeReplyDelayMs,
  schedulePendingReply,
  validateOutput,
  AI_ALTER_CONFIG,
} from '../src/services/ai_alter.ts';
import { runAlterPendingReply } from '../src/jobs/ai-alter-pending-reply.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://loverush:loverush_dev@localhost:54399/loverush';
if (!DB_URL.includes('localhost') && !DB_URL.includes('127.0.0.1')) {
  console.error('💥 拒绝运行：DATABASE_URL 非本地');
  process.exit(3);
}
const db = createDb(DB_URL);
const ctx = { db };
const T = 'verify_timing_therapist';
const C = 'verify_timing_customer';

const checks: Array<[string, boolean]> = [];
const expect = (name: string, ok: boolean) => checks.push([name, ok]);

async function cleanup() {
  await db.delete(users).where(eq(users.bip39PubkeyHash, T));
  await db.delete(users).where(eq(users.bip39PubkeyHash, C));
}

async function main() {
  // ── ① 延迟公式 ──
  const c = AI_ALTER_CONFIG;
  const daySamples = Array.from({ length: 50 }, () => computeReplyDelayMs(new Date('2026-06-01T05:00:00Z'))); // UTC+8=13点 非深夜
  const nightSamples = Array.from({ length: 50 }, () => computeReplyDelayMs(new Date('2026-06-01T18:00:00Z'))); // UTC+8=02点 深夜
  expect('白天延迟全在 [min, max]', daySamples.every((d) => d >= c.replyDelayMinMs && d <= c.replyDelayMaxMs));
  expect('所有延迟不超过硬上限', [...daySamples, ...nightSamples].every((d) => d <= c.replyDelayCapMs));
  expect('深夜会放慢(出现 > 白天上限的值)', Math.max(...nightSamples) > c.replyDelayMaxMs);
  expect('延迟有随机抖动(不是固定值)', new Set(daySamples).size > 5);
  console.log(`  白天延迟样例 ${daySamples.slice(0, 3).map((d) => (d / 1000).toFixed(1)).join('/')}s · 深夜 ${nightSamples.slice(0, 3).map((d) => (d / 1000).toFixed(1)).join('/')}s`);

  // ── ② 机器人表情校验 ──
  expect('人脸表情 😏 放行', validateOutput('好呀😏').ok);
  expect('委屈脸 🥺 放行', validateOutput('么么哒🥺').ok);
  expect('机器人表情 ✨ 拦截', validateOutput('好的✨').ok === false);
  expect('机器人表情 🚀 拦截', validateOutput('搞定🚀').ok === false);
  expect('机器人表情 🎉 拦截', validateOutput('恭喜你🎉').ok === false);

  // ── 建数据(技师 disabled，tick 不会调 LLM) ──
  await cleanup();
  const [tu] = await db.insert(users).values({ userType: 'therapist', status: 'active', bip39PubkeyHash: T, displayName: '夜场公主', locale: 'zh' }).returning();
  await db.insert(therapists).values({ userId: tu!.id, aiAlterEnabled: 0, bio: 'x', verificationStatus: 'passed' });
  const [cu] = await db.insert(users).values({ userType: 'customer', status: 'active', bip39PubkeyHash: C, displayName: '客户A', locale: 'zh' }).returning();
  const [conv] = await db.insert(conversations).values({ customerId: cu!.id, therapistUserId: tu!.id }).returning();
  const schedArgs = { conversationId: conv!.id, customerId: cu!.id, therapistUserId: tu!.id, customerLocale: 'zh' };

  // ── ③ debounce：连发只一行 + 按最新消息时间重置 ──
  await schedulePendingReply(ctx, schedArgs);
  const row1 = (await db.execute(sql`SELECT last_customer_msg_at, scheduled_at FROM ai_alter_pending_reply WHERE conversation_id = ${conv!.id}::uuid`)) as unknown as Array<{ last_customer_msg_at: string; scheduled_at: string }>;
  await new Promise((r) => setTimeout(r, 50));
  await schedulePendingReply(ctx, schedArgs); // 第二条 → 应 upsert 同一行、按新消息时间重置
  const rows = (await db.execute(sql`SELECT last_customer_msg_at, scheduled_at FROM ai_alter_pending_reply WHERE conversation_id = ${conv!.id}::uuid`)) as unknown as Array<{ last_customer_msg_at: string; scheduled_at: string }>;
  expect('连发两条只产生一行(debounce)', rows.length === 1);
  // debounce 信号：最新消息时间前移(延迟从最新消息起算；scheduled_at 因随机延迟不保证更晚，故看 msg 时间)
  expect('第二条把 last_customer_msg_at 前移(重置计时)', new Date(rows[0]!.last_customer_msg_at).getTime() > new Date(row1[0]!.last_customer_msg_at).getTime());
  expect('scheduled_at 被重新计算(行已更新)', rows[0]!.scheduled_at !== row1[0]!.scheduled_at);

  // ── ④ tick 到点领取 ──
  // 先把 scheduled_at 设到未来 → tick 不应领取
  await db.execute(sql`UPDATE ai_alter_pending_reply SET scheduled_at = now() + interval '10 minutes' WHERE conversation_id = ${conv!.id}::uuid`);
  const future = await runAlterPendingReply(ctx);
  const stillThere = (await db.execute(sql`SELECT count(*)::int n FROM ai_alter_pending_reply WHERE conversation_id = ${conv!.id}::uuid`)) as unknown as Array<{ n: number }>;
  expect('未到点的行不被领取', future.due === 0 && stillThere[0]!.n === 1);

  // 再把 scheduled_at 设到过去 → tick 应原子领取+删除
  await db.execute(sql`UPDATE ai_alter_pending_reply SET scheduled_at = now() - interval '1 second' WHERE conversation_id = ${conv!.id}::uuid`);
  const due = await runAlterPendingReply(ctx);
  const gone = (await db.execute(sql`SELECT count(*)::int n FROM ai_alter_pending_reply WHERE conversation_id = ${conv!.id}::uuid`)) as unknown as Array<{ n: number }>;
  expect('到点的行被领取(due=1)', due.due === 1);
  expect('领取后行被删除', gone[0]!.n === 0);
  expect('技师 disabled → 不发回复(sent=0，未调 LLM)', due.sent === 0);

  // ── 汇总 ──
  console.log('\n=== 断言 ===');
  let pass = true;
  for (const [n, ok] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${n}`);
    if (!ok) pass = false;
  }
  await cleanup();
  console.log('\n🧹 已清理');
  console.log(`\n===== ${pass ? '✅ 拟人回复时机机制全部跑通' : '❌ 有失败项，看上面'} =====`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 失败:', e);
  process.exit(1);
});
