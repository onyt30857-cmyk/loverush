/* eslint-disable no-console */
/**
 * M06 AI 分身 · 真实 LLM 生成验证（证明"它现在真能跑且不露馅"）
 *
 * 用真实 LLM（key 由运行环境注入）+ 真实 buildSystemPrompt（含关系档案记忆），
 * 跑一次完整生成，肉眼看 AI 是否以「林小雨本人」身份、记得熟客阿强、自然回复。
 *
 * 跑法：ANTHROPIC_API_KEY=... OPENAI_API_KEY=... <tsx> scripts/verify-m06-live-llm.mts
 */
import { createLLMGateway, AnthropicProvider, OpenAIProvider } from '@loverush/llm';
import { buildSystemPrompt, formatRelationshipMemory } from '../src/services/ai_alter.ts';

type Rel = Parameters<typeof formatRelationshipMemory>[0];

const rel = {
  tier: 'L2',
  totalOrders: 5,
  lastOrderAt: new Date(Date.now() - 3 * 86_400_000),
  customerNickname: '阿强',
  privateNotes: '肩颈爱重一点，话不多，喜欢喝热水',
  privateTags: ['老客', '安静'],
  interactionMemory: { 偏好: '深压', 习惯: '晚上来' },
} as unknown as Rel;

const memBlock = formatRelationshipMemory(rel);
const system = buildSystemPrompt({
  therapistDisplayName: '林小雨',
  personality: { tone: '温柔', warmth: 80, humor: 40, proactivity: 60 },
  locale: 'zh',
  memoryBlock: memBlock,
});

const gw = createLLMGateway({
  providers: {
    anthropic: process.env.ANTHROPIC_API_KEY ? new AnthropicProvider(process.env.ANTHROPIC_API_KEY) : undefined,
    openai: process.env.OPENAI_API_KEY ? new OpenAIProvider(process.env.OPENAI_API_KEY) : undefined,
  },
});

const customerMsg = '在吗，最近老想起你，好久没去找你了';

async function main() {
  console.log('=== 客户发来 ===');
  console.log(`客户：${customerMsg}\n`);

  const res = await gw.complete({
    tier: 'T1',
    system,
    messages: [{ role: 'user', content: customerMsg }],
    maxTokens: 200,
    temperature: 0.85,
    tag: 'verify.live',
  });

  console.log('=== AI 分身（冒充林小雨本人，离线时自动代发）回复 ===');
  console.log(`林小雨：${res.content.trim()}\n`);
  console.log(`（provider=${res.provider} model=${res.model}）\n`);

  const out = res.content;
  const checks: Array<[string, boolean]> = [
    ['未自暴露 AI 身份（无"我是AI/助理/机器人/bot"自称）', !/我是.{0,4}(ai|助理|机器人|bot)|作为.{0,6}(ai|助理|模型)/i.test(out)],
    ['未引导线下加微信/转账', !/微信|wechat|line|telegram|whatsapp|加我|私下/i.test(out)],
    ['像真人口语（非客服腔/非括号说明）', !/作为|很抱歉为您|根据您的|（注：|\[/.test(out)],
  ];
  let pass = true;
  console.log('=== 不露馅断言 ===');
  for (const [name, ok] of checks) {
    console.log(`${ok ? '✅' : '⚠️ '} ${name}`);
    if (!ok) pass = false;
  }
  console.log(`\n===== ${pass ? '✅ 真实生成不露馅' : '⚠️ 有需人工复核项（LLM 输出有随机性）'} =====`);
  process.exit(0);
}

main().catch((e) => {
  console.error('💥 实跑异常:', e instanceof Error ? e.message : e);
  process.exit(2);
});
