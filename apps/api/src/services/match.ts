/**
 * M04 · 对话式意图匹配引擎
 *
 * 流程(规则护栏 + LLM 语义 + 可解释):
 *   1. 召回:复用 recommend.recallCandidates(passed + 城市 + 排除拉黑/cold,Top30)
 *   2. 取客户画像:master_preferences(含 M04 emotional_needs / intent_summary)
 *   3. LLM(T2)语义重排:客户画像/本次意图 × 技师 match_persona → 契合分 + 可解释理由
 *   4. 降级:无 LLM key / 无任何画像信号 / LLM 失败 → 退回 recommend.scoreCandidates 规则打分
 *
 * 守 M03 红线:无 embedding / 无向量 / 无 KMeans / 无 cron · 单次 T2 调用 · 失败有兜底。
 */

import { eq } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { customerMasterPreferences, therapists, type Therapist } from '@loverush/db';
import { createLLMGateway, AnthropicProvider, type LLMGateway } from '@loverush/llm';
import { loadEnv } from '../env';
import { recallCandidates, scoreCandidates } from './recommend';
import { fireAndForget } from './logger';
import { track } from './analytics';

let cachedGateway: LLMGateway | null = null;
function gateway(): LLMGateway | null {
  if (cachedGateway) return cachedGateway;
  const env = loadEnv();
  if (!env.ANTHROPIC_API_KEY) return null;
  cachedGateway = createLLMGateway({
    providers: { anthropic: new AnthropicProvider(env.ANTHROPIC_API_KEY) },
  });
  return cachedGateway;
}

export interface MatchContext {
  db: Database;
}
export interface MatchParams {
  customerId: string;
  intentText?: string;
  city?: string;
  topN?: number;
}
export interface MatchResult {
  therapist: Therapist;
  score: number;
  reasons: string[];
}

const LLM_CANDIDATE_LIMIT = 15; // 控 token · 召回已按 rating 排序,取前 15 给 LLM
const DEFAULT_TOP_N = 3;

const RERANK_SYSTEM = `你在帮一位客户从候选技师里挑最合适的几位。平台是高端上门按摩/陪伴,卖的是体验和情绪价值。
给你:这位客户此刻想要的 + 长期偏好,以及每个候选技师"适合什么样的客户"(persona)。
为每个候选打契合分(0-100),并给 1-2 条理由说明 TA 为什么适合这位客户。

要求:
- 理由用中文、口语化,像朋友帮你推荐人,不要 AI 腔 / 营销词(禁用"专业""优质""贴心服务""一流")
- 理由要具体连到「这位客户的需求」和「这个技师的特点」的契合点,不要空泛夸
- 只用给定信息,绝不编造技师没有的经历/技能
- 客户偏好信息少时,就按技师本身适合的人群合理推荐,分数别拉太开`;

const RERANK_SCHEMA_HINT = `严格输出 JSON 数组(不要 markdown 代码块):
[{ "i": 候选编号(整数), "score": 0-100, "reasons": ["理由1", "理由2"] }]
按契合度从高到低,只返回最合适的前 5 个。`;

function buildProfileSummary(
  master: typeof customerMasterPreferences.$inferSelect | undefined,
  intentText?: string,
): string {
  const parts: string[] = [];
  if (intentText) parts.push(`【此刻想要】${intentText}`);
  if (master?.intentSummary) parts.push(`【长期画像】${master.intentSummary}`);
  if (master?.emotionalNeeds?.length) parts.push(`【情绪需求】${master.emotionalNeeds.join('、')}`);
  if (master?.serviceStylePrefs?.length) parts.push(`【偏好风格】${master.serviceStylePrefs.join('、')}`);
  if (master?.bodyTypePrefs?.length) parts.push(`【外形偏好】${master.bodyTypePrefs.join('、')}`);
  if (master?.communicationStyle) parts.push(`【沟通偏好】${master.communicationStyle}`);
  return parts.join('\n') || '(这位客户暂无明确偏好记录)';
}

interface RerankItem {
  i: number;
  score: number;
  reasons: string[];
}

function parseRerank(content: string): RerankItem[] {
  const jsonStr = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const arr = JSON.parse(jsonStr) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x): RerankItem | null => {
        if (typeof x !== 'object' || x === null) return null;
        const o = x as Record<string, unknown>;
        if (typeof o.i !== 'number' || typeof o.score !== 'number') return null;
        const reasons = Array.isArray(o.reasons)
          ? o.reasons.filter((r): r is string => typeof r === 'string' && r.length > 0).slice(0, 2)
          : [];
        return { i: o.i, score: Math.max(0, Math.min(100, o.score)), reasons };
      })
      .filter((x): x is RerankItem => x !== null);
  } catch {
    return [];
  }
}

async function llmRerank(
  gw: LLMGateway,
  master: typeof customerMasterPreferences.$inferSelect | undefined,
  intentText: string | undefined,
  candidates: Therapist[],
  customerId: string,
): Promise<MatchResult[]> {
  const profile = buildProfileSummary(master, intentText);
  const lines = candidates.map((t, i) => {
    const p = t.matchPersona ?? null;
    const personaStr = p
      ? `适合=${(p.suitableFor ?? []).join('/')} 调性=${(p.toneTags ?? []).join('/')} 情绪价值=${(p.emotionalValue ?? []).join('/')}${(p.notFor ?? []).length ? ` 不适合=${(p.notFor ?? []).join('/')}` : ''}`
      : '(无 persona)';
    return `[${i}] ${personaStr} 标签=${(t.tags ?? []).join('、')} 简介=${(t.bio ?? '').slice(0, 60)}`;
  });
  const userContent = `客户画像:\n${profile}\n\n候选技师(共 ${candidates.length} 位):\n${lines.join('\n')}\n\n${RERANK_SCHEMA_HINT}`;

  const res = await gw.complete({
    tier: 'T2',
    system: RERANK_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
    temperature: 0.4,
    maxTokens: 700,
    userId: customerId,
    tag: 'match.rerank',
  });

  const parsed = parseRerank(res.content);
  const byIdx = new Map(candidates.map((t, i) => [i, t]));
  return parsed
    .filter((r) => byIdx.has(r.i))
    .map((r) => ({ therapist: byIdx.get(r.i)!, score: r.score, reasons: r.reasons }))
    .sort((a, b) => b.score - a.score);
}

export async function matchConversational(
  ctx: MatchContext,
  p: MatchParams,
): Promise<{ results: MatchResult[]; mode: 'llm' | 'rule' }> {
  // M04 监控埋点 · 记每次匹配的 mode(llm/rule 降级)+ 候选数(异步不阻塞)
  const emit = (mode: string, count: number) =>
    fireAndForget(
      track(
        { db: ctx.db },
        {
          eventName: 'match_conversational',
          eventCategory: 'match',
          actorUserId: p.customerId,
          actorRole: 'customer',
          properties: { mode, candidates: count, hasIntent: !!p.intentText },
        },
      ),
      'match.track_failed',
    );
  const recCtx = { db: ctx.db };
  const recParams = { customerId: p.customerId, city: p.city };
  const candidates = await recallCandidates(recCtx, recParams);
  if (!candidates.length) {
    emit('empty', 0);
    return { results: [], mode: 'rule' };
  }

  const master = await ctx.db.query.customerMasterPreferences.findFirst({
    where: eq(customerMasterPreferences.userId, p.customerId),
  });

  const gw = gateway();
  const hasSignal = !!(
    p.intentText ||
    master?.intentSummary ||
    master?.emotionalNeeds?.length ||
    master?.serviceStylePrefs?.length ||
    master?.bodyTypePrefs?.length
  );

  if (gw && hasSignal) {
    try {
      const llmResults = await llmRerank(
        gw,
        master ?? undefined,
        p.intentText,
        candidates.slice(0, LLM_CANDIDATE_LIMIT),
        p.customerId,
      );
      if (llmResults.length) {
        emit('llm', llmResults.length);
        return { results: llmResults.slice(0, p.topN ?? DEFAULT_TOP_N), mode: 'llm' };
      }
    } catch (err) {
      console.error('[match.rerank] LLM 失败 · 降级规则打分', (err as Error).message);
    }
  }

  // 降级:规则打分(无 LLM / 无信号 / LLM 失败)
  const scored = await scoreCandidates(recCtx, recParams, candidates);
  emit('rule', scored.length);
  return {
    results: scored.slice(0, p.topN ?? DEFAULT_TOP_N).map((c) => ({
      therapist: c.therapist,
      score: c.score,
      reasons: ruleReasons(c.factors),
    })),
    mode: 'rule',
  };
}

/** 降级(规则打分)时从打分因子拼兜底理由 · 避免核心"为什么推荐"在无 LLM 时塌成空白 */
function ruleReasons(f: Record<string, number>): string[] {
  const r: string[] = [];
  if ((f.relationship ?? 0) > 0) r.push('你来找过她,算熟人了');
  if ((f.preferenceHit ?? 0) > 0) r.push('风格符合你的偏好');
  if ((f.online ?? 0) > 0) r.push('现在在线,可以马上约');
  if (r.length < 2 && (f.rating ?? 0) >= 80) r.push('评分很高,回头客多');
  if (!r.length) r.push('综合口碑不错,值得试试');
  return r.slice(0, 2);
}

// ──────── M04 · 技师 match_persona 生成(admin 重新生成 + 脚本共用) ────────

const PERSONA_GEN_SYSTEM = `你在为一个高端上门按摩 / 陪伴平台,给技师生成"适合什么样的客户"的匹配画像。
平台卖的是情绪价值和陪伴体验,不是标准化服务。从技师的自我介绍、标签、技能里,提炼"她适合服务什么样的客户、能给什么情绪价值、调性如何"。

只输出严格 JSON(不要 markdown 代码块),字段:
- suitableFor: string[] 2-4 个 · 适合什么状态/诉求的客户
- toneTags: string[] 2-4 个 · 调性人设
- emotionalValue: string[] 1-3 个 · 擅长的情绪价值
- notFor: string[] 0-2 个 · 明显不适合的客户类型(谨慎)

要求:中文口语、像朋友介绍人,不要 AI 腔/营销词("专业""优质"禁用);只基于给定信息,信息少就少写,绝不编造;每个标签≤8字。`;

function buildPersonaContent(t: Therapist): string {
  const bioZh = t.bio ?? t.bioTranslations?.zh ?? '';
  const skills = Array.isArray(t.skillsJson) ? t.skillsJson.map((s) => s.skill).filter(Boolean) : [];
  const pref = t.preferencesJson ?? {};
  return [
    `自我介绍: ${bioZh || '(无)'}`,
    `标签: ${(t.tags ?? []).join('、') || '(无)'}`,
    `技能: ${skills.join('、') || '(无)'}`,
    `国籍: ${t.nationality || '(无)'} · 语言: ${(t.languages ?? []).join('、') || '(无)'}`,
    `偏好客户: ${(pref.preferredCustomerTypes ?? []).join('、') || '(无)'}`,
    `不接受客户: ${(pref.rejectedCustomerTypes ?? []).join('、') || '(无)'}`,
  ].join('\n');
}

export interface MatchPersona {
  suitableFor: string[];
  toneTags: string[];
  emotionalValue: string[];
  notFor: string[];
  source: 'llm_v1' | 'therapist_edited';
  updatedAt: string;
}

function parsePersonaJson(content: string): Omit<MatchPersona, 'source' | 'updatedAt'> | null {
  const jsonStr = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const p = JSON.parse(jsonStr) as Record<string, unknown>;
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
    const out = {
      suitableFor: arr(p.suitableFor),
      toneTags: arr(p.toneTags),
      emotionalValue: arr(p.emotionalValue),
      notFor: arr(p.notFor),
    };
    if (!out.suitableFor.length && !out.toneTags.length) return null;
    return out;
  } catch {
    return null;
  }
}

/** admin / 脚本 · 用 LLM 从技师 bio/tags/skills 重新生成 match_persona 并写库 · 失败返回 null */
export async function generateMatchPersona(
  ctx: MatchContext,
  therapistId: string,
): Promise<MatchPersona | null> {
  const gw = gateway();
  if (!gw) return null;
  const t = await ctx.db.query.therapists.findFirst({ where: eq(therapists.id, therapistId) });
  if (!t) return null;
  const res = await gw.complete({
    tier: 'T2',
    system: PERSONA_GEN_SYSTEM,
    messages: [{ role: 'user', content: buildPersonaContent(t) }],
    temperature: 0.4,
    maxTokens: 400,
    tag: 'match.persona_gen',
  });
  const parsed = parsePersonaJson(res.content);
  if (!parsed) return null;
  const payload: MatchPersona = { ...parsed, source: 'llm_v1', updatedAt: new Date().toISOString() };
  await ctx.db.update(therapists).set({ matchPersona: payload }).where(eq(therapists.id, therapistId));
  return payload;
}
