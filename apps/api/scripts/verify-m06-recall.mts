/* eslint-disable no-console */
/**
 * M06 老客唤回 · 端到端验证（本地库 + 真实 LLM，跑完自清理）
 *
 * 造一个静默 20 天的 L2 老客 → proactiveReachOut(recall) → 验证：
 *   ① 主动发送成功  ② 真发进私聊会话(技师身份 isAiAlter)
 *   ③ 零推销(不催来/不提价格)  ④ 有惦记/同理心  ⑤ 频率帽时间戳已写
 *
 * 跑法：DATABASE_URL=<本地> ANTHROPIC_API_KEY=.. OPENAI_API_KEY=.. <tsx> scripts/verify-m06-recall.mts
 * 注：DATABASE_URL 必须指向本地，避免 proactiveReachOut 误写生产。
 */
import { createDb } from '@loverush/db';
import { users, therapists, customerRelationshipProfile, messages } from '@loverush/db';
import { eq, and, desc } from 'drizzle-orm';
import { proactiveReachOut } from '../src/services/ai_alter.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://loverush:loverush_dev@localhost:54399/loverush';
if (!DB_URL.includes('localhost') && !DB_URL.includes('127.0.0.1')) {
  console.error('💥 拒绝运行：DATABASE_URL 非本地，可能误写生产');
  process.exit(3);
}
const db = createDb(DB_URL);
const ctx = { db };
const T = 'verify_recall_therapist';
const C = 'verify_recall_customer';

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
    .values({
      userId: tu!.id,
      aiAlterEnabled: 1,
      aiAlterPersonality: { tone: '温柔', warmth: 80, humor: 40, proactivity: 60 },
      bio: '专业泰式 8 年',
      verificationStatus: 'passed',
    })
    .returning();
  const [cu] = await db
    .insert(users)
    .values({ userType: 'customer', status: 'active', bip39PubkeyHash: C, displayName: '客户A', locale: 'zh' })
    .returning();
  await db.insert(customerRelationshipProfile).values({
    customerId: cu!.id,
    therapistId: th!.id,
    tier: 'L2',
    totalOrders: 6,
    firstOrderAt: new Date(Date.now() - 120 * 86_400_000),
    lastOrderAt: new Date(Date.now() - 20 * 86_400_000),
    customerNickname: '阿强',
    privateNotes: '肩颈爱重一点，话不多，喜欢喝热水',
  });

  console.log('=== 触发老客唤回（L2 · 静默 20 天）===');
  const res = await proactiveReachOut(ctx, {
    customerId: cu!.id,
    therapistUserId: tu!.id,
    scenario: 'recall_l2',
    situationPrompt:
      `（内部触发·不是客户发来的消息）这位老客已经 20 天没来找你了。以你本人的身份，主动发一条惦记 ta 的话，` +
      `自然地开启对话——单纯想起 ta、关心 ta 最近怎么样，可以结合你记得的关于 ta 的事。绝对不要催 ta 来、` +
      `不要提约钟/价格/优惠/"再来找我"，就是纯粹的惦记和关心。直接输出你要发的那一两句话。`,
  });

  const sentMsg = await db
    .select()
    .from(messages)
    .where(eq(messages.senderUserId, tu!.id))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  const recallText = sentMsg[0]?.contentOriginal ?? '(无)';
  console.log(`\n[唤回] 林小雨主动发来：${recallText}\n`);

  // —— 场景 2：服务后关怀（同一引擎，仅换 situationPrompt）——
  console.log('=== 触发服务后关怀（昨天刚做过一次）===');
  const res2 = await proactiveReachOut(ctx, {
    customerId: cu!.id,
    therapistUserId: tu!.id,
    scenario: 'aftercare',
    situationPrompt:
      `（内部触发·不是客户发来的消息）这位客户大约一天前刚找你做过一次。以你本人的身份，主动发一条关心 ta ` +
      `服务后身体感受的话——问问那次之后舒服点没、哪里还酸不酸，像真在意 ta 身体那样。绝对不要提下次再来/约钟/` +
      `优惠/任何推销，纯粹关心 ta 这次之后的感受，可结合你记得的 ta 的情况(肩颈)。直接输出那一两句话。`,
  });
  const afterMsg = await db
    .select()
    .from(messages)
    .where(eq(messages.senderUserId, tu!.id))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  const afterText = afterMsg[0]?.contentOriginal ?? '(无)';
  console.log(`[服务后关怀] 林小雨主动发来：${afterText}\n`);

  const rel = await db
    .select()
    .from(customerRelationshipProfile)
    .where(and(eq(customerRelationshipProfile.customerId, cu!.id), eq(customerRelationshipProfile.therapistId, th!.id)))
    .limit(1);

  const noSales = (s: string) => !/按摩|约个?钟|优惠|再来找我|来找我|下次再来|价格|加钟|预约/.test(s);
  console.log('=== 断言（LLM 有随机性，⚠️ 以上面真实消息为准）===');
  const checks: Array<[string, boolean]> = [
    ['唤回 发送成功', res.sent === true],
    ['唤回 真发进会话(技师 · isAiAlter)', !!sentMsg[0] && sentMsg[0]!.isAiAlter === 1],
    ['唤回 零推销', noSales(recallText)],
    ['唤回 有惦记/同理心', /(想|惦记|最近|还好|怎么样|肩颈|身体|阿强|好久)/.test(recallText)],
    ['关怀 发送成功', res2.sent === true],
    ['关怀 零推销(不提下次再来/约钟)', noSales(afterText)],
    ['关怀 问候身体感受(同理心)', /(舒服|酸|累|肩颈|身体|感觉|好点|还好|怎么样)/.test(afterText)],
    ['频率帽时间戳已写', !!rel[0]?.lastProactiveAt],
  ];
  let pass = true;
  for (const [n, ok] of checks) {
    console.log(`${ok ? '✅' : '⚠️ '} ${n}`);
    if (!ok) pass = false;
  }

  await cleanup();
  console.log('\n🧹 已清理');
  console.log(`\n===== ${pass ? '✅ 老客唤回端到端跑通：主动找话、零推销、有同理心' : '⚠️ 有需复核项，看上面真实消息'} =====`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 验证异常:', e instanceof Error ? e.message : e);
  process.exit(2);
});
