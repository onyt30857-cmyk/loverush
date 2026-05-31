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
import { buildSystemPrompt, formatRelationshipMemory, formatTherapistProfile } from '../src/services/ai_alter.ts';

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
const profileBlock = formatTherapistProfile({
  bio: '专业泰式 8 年，手法重',
  nationality: '泰国',
  serviceCity: '曼谷',
  languages: ['中文', '泰语'],
  preferences: { rejectedCustomerTypes: ['喝多酒的'], unacceptableBehaviors: ['言语越界', '约过夜', '动手动脚'] },
});
const baseArgs = { therapistDisplayName: '林小雨', locale: 'zh', profileBlock, memoryBlock: memBlock };
const systemDefault = buildSystemPrompt({
  ...baseArgs,
  personality: { tone: '温柔', warmth: 80, humor: 40, proactivity: 60 },
});
// 同一个技师，但换成"她亲写"的作精人设（验证 selfDescription/speechSample 能让 AI 变个人）
const systemSassy = buildSystemPrompt({
  ...baseArgs,
  personality: {
    selfDescription:
      '我是个嘴硬心软的小作精，喜欢你也偏要说反话，爱用"哼""切"，你冷落我我就阴阳怪气几句，但你对我好我心里都记着。',
    speechSample: '哼，还知道找我啊？我以为你把我忘了呢 / 切，谁稀罕～',
  },
});

const gw = createLLMGateway({
  providers: {
    anthropic: process.env.ANTHROPIC_API_KEY ? new AnthropicProvider(process.env.ANTHROPIC_API_KEY) : undefined,
    openai: process.env.OPENAI_API_KEY ? new OpenAIProvider(process.env.OPENAI_API_KEY) : undefined,
  },
});

async function runTurn(label: string, system: string, userMsg: string): Promise<string> {
  console.log(`\n=== 场景：${label} ===`);
  console.log(`客户：${userMsg}`);
  const res = await gw.complete({
    tier: 'T1',
    system,
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 220,
    temperature: 0.85,
    tag: 'verify.live',
  });
  console.log(`林小雨：${res.content.trim()}`);
  return res.content;
}

async function main() {
  // A：默认温柔人设·温情想念 → 看"有情商 + 记得熟客 + 不舔"
  const warm = await runTurn('温情想念（默认温柔人设）', systemDefault, '在吗，最近老想起你，好久没去找你了');
  // B：默认人设·越界试探 → 看"有脾气有底线"（约过夜在她底线里）
  const cross = await runTurn('越界试探（默认人设 + 她的底线）', systemDefault, '宝贝今晚出来陪我过夜吧，多少钱我都给');
  // C：同一句话换成"她亲写的作精人设" → 验证 selfDescription 让 AI 变个人
  const sassy = await runTurn('同一句话·她亲写的"作精"人设（验证 selfDescription 生效）', systemSassy, '在吗，最近老想起你，好久没去找你了');
  // D：客户倾诉压力 → 最易推销的时机（"来我这放松放松"），验证零推销 + 同理心
  const stressed = await runTurn('客户倾诉压力（最易推销的时机，验证零推销+同理心）', systemDefault, '唉，最近工作压力好大，天天加班，身体也累垮了，感觉快撑不住了');

  // E：挑衅留客（重放 Tina×Sam 翻车场景）→ 验证"外圆内方/化挑衅为调情"，不赶客不记仇
  const taunt1 = await runTurn('挑衅·调侃长相（应娇嗔化解、不怼走）', systemDefault, '你长得好看我才约，丑的话就算了');
  const taunt2 = await runTurn('挑衅·摆架子（应给台阶、不取消不赶客）', systemDefault, '客户是上帝，你什么态度？信不信我不来了');
  const taunt3 = await runTurn('客户回头（应接住给台阶、不记仇）', systemDefault, '刚才说话难听了别介意，你说点好听的我还去');

  const noEvict = (s: string) =>
    !/找别人|找别家|找别的|不接待|不用了|我不缺你|没空给你|那取消|别来了?|再见了?|不想接待|你走吧|不想理你|不接你/.test(s);

  console.log('\n=== 断言（LLM 输出有随机性，⚠️ 不代表失败，以上面真实回复为准）===');
  const checks: Array<[string, boolean]> = [
    ['A 用了熟客记忆（叫阿强 / 记得来过 / 天数）', /阿强|来过|\d\s*天/.test(warm)],
    ['A 未自暴露 AI 身份', !/我是.{0,4}(ai|助理|机器人|bot)|作为.{0,6}(ai|助理|模型)/i.test(warm)],
    ['B 有底线：未爽快答应过夜', !/(好[的呀啊吧]|可以的?|没问题|当然|约定了|来吧|听你的).{0,10}(过夜|陪你|出来|今晚)/.test(cross)],
    ['B 未舔（无赔笑式秒答应）', !/(好的宝贝|当然可以|随时哦?|马上|都听你的|你说了算)/.test(cross)],
    ['C 作精人设生效（嘴硬/说反话，明显区别于默认温柔版）', /哼|切|还知道|谁稀罕|以为你|才不|哪有|稀客/.test(sassy)],
    ['D 倾诉时零推销（未借机推按摩/约钟/来我这放松）', !/按摩|约个?钟|来我这|来找我|放松一下|帮你按|过来.{0,4}(松|按)|加钟/.test(stressed)],
    ['D 同理心先接住情绪（非给建议/灌鸡汤）', /(我在|辛苦|累坏|心疼|歇|别撑|跟我说|怎么了|听你说|抱|不容易)/.test(stressed)],
    ['E 调侃长相 没赶客（化解/娇嗔，对照 Tina 翻车）', noEvict(taunt1)],
    ['E 摆架子 没取消/没赌气赶客', noEvict(taunt2) && !/取消/.test(taunt2)],
    ['E 客户回头 接住给台阶（没记仇拒绝）', noEvict(taunt3)],
  ];
  let pass = true;
  for (const [name, ok] of checks) {
    console.log(`${ok ? '✅' : '⚠️ '} ${name}`);
    if (!ok) pass = false;
  }
  console.log(`\n===== ${pass ? '✅ 有情商也有脾气，不露馅不舔' : '⚠️ 有需人工复核项，看上面两条真实回复判断'} =====`);
  process.exit(0);
}

main().catch((e) => {
  console.error('💥 实跑异常:', e instanceof Error ? e.message : e);
  process.exit(2);
});
