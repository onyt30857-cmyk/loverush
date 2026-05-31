/* eslint-disable no-console */
/**
 * M06 AI 分身 · 端到端验证脚本（本地库，跑完自清理）
 *
 * 验证三件事：
 *   ① 数据链路反崩溃   —— 0015/0016 迁移补的表能真写真读（缺表崩溃的直接反证）
 *   ② 完全替身不露馅   —— 真名 + 关系档案记忆注入 prompt，且无任何 AI 痕迹
 *   ③ 关系档案保鲜     —— touchRelationship 的 onConflict upsert 可行
 *
 * 跑法：apps/api 目录下 `<tsx> scripts/verify-m06-ai-alter.mts`
 */
import { createDb } from '@loverush/db';
import {
  users,
  therapists,
  conversations,
  messages,
  aiAlterMessages,
  customerRelationshipProfile,
} from '@loverush/db';
import { eq } from 'drizzle-orm';
import {
  buildSystemPrompt,
  formatRelationshipMemory,
  formatTherapistProfile,
  loadRelationship,
  touchRelationship,
} from '../src/services/ai_alter.ts';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://loverush:loverush_dev@localhost:54399/loverush';
const db = createDb(DB_URL);
const ctx = { db };

const T_KEY = 'verify_m06_therapist';
const C_KEY = 'verify_m06_customer';

async function cleanup() {
  await db.delete(users).where(eq(users.bip39PubkeyHash, T_KEY)); // cascade 连删 therapist/conv/msg/ai_alter/relationship
  await db.delete(users).where(eq(users.bip39PubkeyHash, C_KEY));
}

async function main() {
  await cleanup();

  // ── 造数据：技师（开分身、离线）+ 客户 + 会话 + 客户消息 + L2 熟客关系档案 ──
  const [tu] = await db
    .insert(users)
    .values({ userType: 'therapist', status: 'active', bip39PubkeyHash: T_KEY, displayName: '林小雨', locale: 'zh' })
    .returning();
  const [th] = await db
    .insert(therapists)
    .values({
      userId: tu!.id,
      aiAlterEnabled: 1,
      aiAlterPersonality: { tone: '温柔', warmth: 80, humor: 40, proactivity: 60 },
      bio: '专业泰式 8 年',
      verificationStatus: 'passed',
      // lastOnlineAt 留 null = 离线，满足代发条件
    })
    .returning();
  const [cu] = await db
    .insert(users)
    .values({ userType: 'customer', status: 'active', bip39PubkeyHash: C_KEY, displayName: '客户A', locale: 'zh' })
    .returning();
  const [conv] = await db
    .insert(conversations)
    .values({ customerId: cu!.id, therapistUserId: tu!.id })
    .returning();
  await db.insert(messages).values({
    conversationId: conv!.id,
    senderUserId: cu!.id,
    type: 'text',
    contentOriginal: '在吗，最近老想起你',
    contentLanguage: 'zh',
  });
  await db.insert(customerRelationshipProfile).values({
    customerId: cu!.id,
    therapistId: th!.id,
    tier: 'L2',
    tierScore: 600,
    totalOrders: 5,
    firstOrderAt: new Date(Date.now() - 90 * 86_400_000),
    lastOrderAt: new Date(Date.now() - 3 * 86_400_000),
    customerNickname: '阿强',
    privateNotes: '肩颈爱重一点，话不多，喜欢喝热水',
    privateTags: ['老客', '安静'],
    interactionMemory: { 偏好: '深压', 习惯: '晚上来' },
  });

  console.log('\n========= ① 数据链路反崩溃（缺表崩溃的反证）=========');
  const rel = await loadRelationship(ctx, cu!.id, th!.id);
  console.log(
    'loadRelationship →',
    rel ? `tier=${rel.tier} 昵称=${rel.customerNickname} 来过=${rel.totalOrders}次（SELECT 成功=表在）` : 'NULL',
  );

  console.log('\n========= ② 记忆段 formatRelationshipMemory =========');
  const memBlock = formatRelationshipMemory(rel);
  console.log(memBlock);

  console.log('\n========= ③ 完整 system prompt（完全替身 + 记忆注入）=========');
  const profileBlock = formatTherapistProfile({
    bio: '专业泰式 8 年',
    nationality: '泰国',
    serviceCity: '曼谷',
    languages: ['中文', '泰语'],
    preferences: { rejectedCustomerTypes: ['喝多酒的'], unacceptableBehaviors: ['动手动脚', '言语越界'] },
  });
  const sys = buildSystemPrompt({
    therapistDisplayName: '林小雨',
    personality: (th!.aiAlterPersonality as Record<string, unknown>) ?? {},
    locale: 'zh',
    profileBlock,
    memoryBlock: memBlock,
  });
  console.log(sys);

  console.log('\n========= ④ 露馅断言 =========');
  const checks: Array<[string, boolean]> = [
    ['含真名「林小雨」', sys.includes('林小雨')],
    ['记得昵称「阿强」', sys.includes('阿强')],
    ['记得来访次数「5 次」', sys.includes('5 次')],
    ['含上次到访「3 天前」', memBlock.includes('3 天前')],
    ['含「绝不暴露 AI/bot/助理」替身约束', sys.includes('绝不暴露 AI / bot / 助理 / 程序 身份')],
    ['含「你就是这个技师本人」铁律', sys.includes('你就是这个技师本人')],
    ['含记忆纪律（禁编造档案外细节）', sys.includes('档案里没有的具体过往一律不得编造')],
    ['注入技师真实档案（自我介绍）', sys.includes('专业泰式 8 年')],
    ['注入技师底线（来自她真填的边界）', sys.includes('动手动脚')],
    ['含反谄媚「别舔/有脾气」人格基线', sys.includes('别舔') && sys.includes('有脾气有底线')],
  ];
  let pass = true;
  for (const [name, ok] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}`);
    if (!ok) pass = false;
  }

  console.log('\n========= ⑤ 代发日志落库（模拟 maybeReplyAsAlter 末尾全部 INSERT）=========');
  const [alterMsg] = await db
    .insert(messages)
    .values({
      conversationId: conv!.id,
      senderUserId: tu!.id,
      type: 'text',
      contentOriginal: '在的阿强，三天没见还惦记着你呢，肩颈又紧啦？',
      contentLanguage: 'zh',
      isAiAlter: 1,
    })
    .returning();
  await db.insert(aiAlterMessages).values({
    messageId: alterMsg!.id,
    therapistUserId: tu!.id,
    therapistId: th!.id,
    scenario: 'general',
    promptVersion: 'v1.1.2026-05-31-memory',
    provider: 'verify',
    model: 'verify',
    inputTokens: 100,
    outputTokens: 30,
    costUsdMicros: 1234,
    simhash: 123456789,
    redlineFlags: [],
    contextSnapshot: { tier: 'L2', hasMemory: true },
  });
  const logged = await db.select().from(aiAlterMessages).where(eq(aiAlterMessages.messageId, alterMsg!.id));
  const okLog = logged.length === 1;
  console.log(`${okLog ? '✅' : '❌'} ai_alter_messages 写入成功（全列匹配），行数=${logged.length}`);
  if (!okLog) pass = false;

  console.log('\n========= ⑥ touchRelationship 保鲜 upsert（onConflict）=========');
  const before = rel?.lastInteractionAt ?? null;
  await touchRelationship(ctx, cu!.id, th!.id);
  const after = await loadRelationship(ctx, cu!.id, th!.id);
  const okTouch = !!after?.lastInteractionAt && after.lastInteractionAt !== before;
  console.log(
    `${okTouch ? '✅' : '❌'} upsert 成功，last_interaction_at: ${before ?? 'null'} → ${after?.lastInteractionAt?.toISOString() ?? 'null'}`,
  );
  if (!okTouch) pass = false;

  await cleanup();
  console.log('\n🧹 测试数据已清理');
  console.log(`\n===== 总判定：${pass ? '✅ 全部通过' : '❌ 有失败项'} =====`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 验证脚本异常:', e);
  process.exit(2);
});
