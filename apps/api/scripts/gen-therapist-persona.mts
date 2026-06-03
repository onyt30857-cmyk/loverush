/**
 * M04 · 技师匹配语义画像(match_persona)一次性生成
 *
 * 读 passed 技师的 bio / tags / skills / 国籍语言 / 喜爱字段,调 LLM(T2)
 * 提炼出"适合什么样的客户"的语义画像,写回 therapists.match_persona。
 * 这是 LLM 语义匹配的供给侧画像 —— 不是身高体重这类硬属性。
 *
 * 用法(需 railway run 注入 DATABASE_URL + ANTHROPIC_API_KEY · 从 code/ 跑):
 *   dry-run:  railway run -s loverush -- bun apps/api/scripts/gen-therapist-persona.mts
 *   执行:     ...同上... --execute
 *   覆盖已有: 加 --force(默认跳过已有 match_persona 的)
 */
import { createDb, therapists } from '@loverush/db';
import { eq } from 'drizzle-orm';
import { createLLMGateway, AnthropicProvider } from '@loverush/llm';

const EXECUTE = process.argv.includes('--execute');
const FORCE = process.argv.includes('--force');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL 未注入(请用 railway run -s loverush -- ...)');
  process.exit(1);
}
const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (!anthropicKey) {
  console.error('ERROR: ANTHROPIC_API_KEY 未注入(本地无 key 会崩 · 必须 railway run)');
  process.exit(1);
}

const db = createDb(url, { maxConnections: 5 });
const gw = createLLMGateway({ providers: { anthropic: new AnthropicProvider(anthropicKey) } });

const SYSTEM_PROMPT = `你在为一个高端上门按摩 / 陪伴平台,给技师生成"适合什么样的客户"的匹配画像。
平台卖的是情绪价值和陪伴体验,不是标准化服务。客户常说不清自己要什么,所以你要从技师的自我介绍、标签、技能里,提炼出"她适合服务什么样的客户、能给什么情绪价值、调性如何"。

只输出严格 JSON(不要 markdown 代码块包裹),字段:
- suitableFor: string[] 2-4 个 · 适合什么状态/诉求的客户(如"想安静放松的""第一次来会紧张的""喜欢有人陪聊的")
- toneTags: string[] 2-4 个 · 她的调性人设(如"温柔""耐心""成熟姐姐感""活泼健谈")
- emotionalValue: string[] 1-3 个 · 她擅长给的情绪价值(如"倾听""解压陪伴""被照顾感""轻松氛围")
- notFor: string[] 0-2 个 · 明显不适合的客户类型(谨慎 · 只在有明确依据时写,否则给空数组)

要求:
- 中文、口语化、像朋友介绍人,绝不用 AI 腔 / 营销词(禁用"专业""优质""贴心服务""一流"这类)
- 只基于给定信息合理推断 · 信息少就少写 · 绝不编造具体经历或没提到的技能
- 每个标签要短(≤8 字)`;

function buildUserContent(r: typeof therapists.$inferSelect): string {
  const bioZh = r.bio ?? (r.bioTranslations?.zh ?? '');
  const skills = Array.isArray(r.skillsJson) ? r.skillsJson.map((s) => s.skill).filter(Boolean) : [];
  const pref = r.preferencesJson ?? {};
  const lines = [
    `自我介绍: ${bioZh || '(无)'}`,
    `标签: ${(r.tags ?? []).join('、') || '(无)'}`,
    `技能: ${skills.join('、') || '(无)'}`,
    `国籍: ${r.nationality || '(无)'} · 语言: ${(r.languages ?? []).join('、') || '(无)'}`,
    `偏好的客户类型: ${(pref.preferredCustomerTypes ?? []).join('、') || '(无)'}`,
    `不接受的客户类型: ${(pref.rejectedCustomerTypes ?? []).join('、') || '(无)'}`,
  ];
  return lines.join('\n');
}

interface Persona {
  suitableFor: string[];
  toneTags: string[];
  emotionalValue: string[];
  notFor: string[];
}

function parsePersona(content: string): Persona | null {
  const jsonStr = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const p = JSON.parse(jsonStr) as Record<string, unknown>;
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
    const out: Persona = {
      suitableFor: arr(p.suitableFor),
      toneTags: arr(p.toneTags),
      emotionalValue: arr(p.emotionalValue),
      notFor: arr(p.notFor),
    };
    if (!out.suitableFor.length && !out.toneTags.length) return null; // 全空视为失败
    return out;
  } catch {
    return null;
  }
}

const rows = await db.query.therapists.findMany({
  where: (t, { eq: e }) => e(t.verificationStatus, 'passed'),
});

const targets = rows.filter((r) => FORCE || !r.matchPersona);
console.log(
  `passed 技师 ${rows.length} 个 · 待生成 ${targets.length} 个(已有 persona ${rows.length - targets.length} 个${FORCE ? ' · --force 覆盖' : ' 跳过'})`,
);
console.log(`模式: ${EXECUTE ? '执行(--execute · 写库)' : 'DRY-RUN(仅预览)'}\n`);

let ok = 0;
let fail = 0;
for (const r of targets) {
  const label = `${r.nationality || '?'} / ${(r.tags ?? []).slice(0, 2).join(',') || '无标签'}`;
  try {
    const res = await gw.complete({
      tier: 'T2',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserContent(r) }],
      temperature: 0.4,
      maxTokens: 400,
      tag: 'match.persona_gen',
    });
    const persona = parsePersona(res.content);
    if (!persona) {
      fail++;
      console.log(`✗ ${label}  userId=${r.userId}  解析失败 · 原文: ${res.content.slice(0, 120)}\n`);
      continue;
    }
    const payload = { ...persona, source: 'llm_v1' as const, updatedAt: new Date().toISOString() };
    console.log(`▶ ${label}  userId=${r.userId}`);
    console.log(`   适合: ${persona.suitableFor.join(' / ')}`);
    console.log(`   调性: ${persona.toneTags.join(' / ')}  情绪价值: ${persona.emotionalValue.join(' / ')}`);
    if (persona.notFor.length) console.log(`   不适合: ${persona.notFor.join(' / ')}`);

    if (EXECUTE) {
      await db.update(therapists).set({ matchPersona: payload }).where(eq(therapists.id, r.id));
      console.log('   ✓ 已写入 match_persona');
    }
    console.log('');
    ok++;
  } catch (err) {
    fail++;
    console.log(`✗ ${label}  userId=${r.userId}  LLM 调用异常: ${(err as Error).message}\n`);
  }
}

console.log(`\n完成: 成功 ${ok} · 失败 ${fail}${EXECUTE ? ' · 已写库' : ' · DRY-RUN 未写库'}`);
process.exit(0);
