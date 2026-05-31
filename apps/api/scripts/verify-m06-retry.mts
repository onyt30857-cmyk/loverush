/* eslint-disable no-console */
/**
 * M06 分身回复兜底补偿 · 端到端验证（本地库 + 真实 LLM，跑完自清理）
 *
 * 模拟 sam×Tina 的故障：客户 6 分钟前发了消息、分身没回（fire-and-forget 丢失）
 * → 跑 runAlterReplyRetry → 应自动补发回复。
 *
 * 跑法：DATABASE_URL=<本地> JWT_SECRET=.. ANTHROPIC_API_KEY=.. OPENAI_API_KEY=.. <tsx> scripts/verify-m06-retry.mts
 */
import { createDb } from '@loverush/db';
import { users, therapists, conversations, messages } from '@loverush/db';
import { eq, and, desc } from 'drizzle-orm';
import { runAlterReplyRetry } from '../src/jobs/ai-alter-reply-retry.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://loverush:loverush_dev@localhost:54399/loverush';
if (!DB_URL.includes('localhost') && !DB_URL.includes('127.0.0.1')) {
  console.error('💥 拒绝运行：DATABASE_URL 非本地');
  process.exit(3);
}
const db = createDb(DB_URL);
const ctx = { db };
const T = 'verify_retry_therapist';
const C = 'verify_retry_customer';

async function cleanup() {
  await db.delete(users).where(eq(users.bip39PubkeyHash, T));
  await db.delete(users).where(eq(users.bip39PubkeyHash, C));
}

async function main() {
  await cleanup();
  const [tu] = await db
    .insert(users)
    .values({ userType: 'therapist', status: 'active', bip39PubkeyHash: T, displayName: '林小雨', locale: 'zh' })
    .returning();
  const [th] = await db
    .insert(therapists)
    .values({ userId: tu!.id, aiAlterEnabled: 1, bio: '专业泰式 8 年', verificationStatus: 'passed' }) // lastOnlineAt=null → 离线
    .returning();
  void th;
  const [cu] = await db
    .insert(users)
    .values({ userType: 'customer', status: 'active', bip39PubkeyHash: C, displayName: '客户A', locale: 'zh' })
    .returning();
  const [conv] = await db
    .insert(conversations)
    .values({ customerId: cu!.id, therapistUserId: tu!.id })
    .returning();
  // 客户 6 分钟前发消息、分身没回（模拟 fire-and-forget 丢失）
  const sixMinAgo = new Date(Date.now() - 6 * 60_000);
  await db.insert(messages).values({
    conversationId: conv!.id,
    senderUserId: cu!.id,
    type: 'text',
    contentOriginal: '我去找你吧，几点有空',
    contentLanguage: 'zh',
    sentAt: sixMinAgo,
  });

  console.log('=== 模拟：客户 6 分钟前发"我去找你吧"，分身没回（fire-and-forget 丢失）===');
  console.log('=== 跑兜底补偿 job ===');
  const res = await runAlterReplyRetry(ctx);
  console.log(`补偿结果: candidates=${res.candidates} sent=${res.sent}`);

  const therapistMsgs = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conv!.id), eq(messages.senderUserId, tu!.id)))
    .orderBy(desc(messages.sentAt));
  const reply = therapistMsgs[0];
  console.log(`\n分身补发：${reply?.contentOriginal ?? '(无)'}\n`);

  console.log('=== 断言 ===');
  const checks: Array<[string, boolean]> = [
    ['补偿 job 扫到了未回会话', res.candidates >= 1],
    ['分身补发了回复（技师身份 · isAiAlter）', !!reply && reply.isAiAlter === 1],
    ['回复非空', !!reply?.contentOriginal],
  ];
  let pass = true;
  for (const [n, ok] of checks) {
    console.log(`${ok ? '✅' : '⚠️ '} ${n}`);
    if (!ok) pass = false;
  }
  await cleanup();
  console.log('\n🧹 已清理');
  console.log(`\n===== ${pass ? '✅ 兜底补偿跑通：丢失的回复被自动补回' : '⚠️ 看上面'} =====`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 验证异常:', e instanceof Error ? e.message : e);
  process.exit(2);
});
