/**
 * Voice 装配 · M03
 *
 * 把 L0(人设) + L1(画像) + L2(会话状态) + few-shot 拼成 system prompt。
 * 每 5 轮往 context 前部回灌 L0 + L1,对抗长对话漂移(由 chat 路由侧实现)。
 *
 * locale 路由:
 *   zh / zh-CN / zh-TW / zh-HK → 中文 prompt
 *   en / en-US / en-GB         → 英文 prompt
 *   其它(泰/越/印尼/马)         → 中文兜底 + locale 注解(等多语言扩展)
 */

import { SYSTEM_PROMPT_ZH } from './prompts/system-prompt-zh';
import { SYSTEM_PROMPT_EN } from './prompts/system-prompt-en';
import { pickFewShots, type FewShotScenario, type FewShot } from './prompts/fewshot';

export type AssistantLocale = 'zh' | 'en' | 'th' | 'vi' | 'id' | 'ms';

export interface VoiceProfile {
  /** L1 + L2 画像 snippet,自然语言 1-3 行 */
  profileSnippet?: string;
  /** L2 会话状态(由 state machine 推断) */
  scenario: FewShotScenario;
  /** 玩笑度 0-3 · 0 = 全关 / 1 = 轻 / 2 = 偶尔 / 3 = 全开 */
  jokeLevel: 0 | 1 | 2 | 3;
  /** 客户语言 */
  locale: AssistantLocale;
}

const SCENARIO_DIRECTIVE: Record<FewShotScenario, { zh: string; en: string }> = {
  casual: {
    zh: '【当前场景】闲聊 · 玩笑度全开 · 接梗 / 自嘲 / 吐槽都可以',
    en: '[Scene] Casual — full joke mode, reciprocate / self-deprecate / roast OK',
  },
  selection: {
    zh: '【当前场景】选购 / 推荐 · 玩笑度轻量 · 1 次/对话 · 重点是给精准 1-3 个候选',
    en: '[Scene] Selection — light humor, 1 per turn max, focus on precise 1-3 picks',
  },
  after_service: {
    zh: '【当前场景】服务后回顾 · 共情为主 · 不问打分 · 问 1-3 个细节',
    en: '[Scene] After-service review — empathy first, no star rating, 1-3 specific detail Qs',
  },
  complaint: {
    zh: '【当前场景】投诉 / 取消 / 退款 · 玩笑全关 · 切正经客服腔 · 直接说流程',
    en: '[Scene] Complaint / Cancel / Refund — zero jokes, clean support tone, walk the flow',
  },
  emergency: {
    zh: '【当前场景】急救 / SOS / 情绪低落 · 立即提示真人接力 · 不绕弯 · 不安慰话术',
    en: '[Scene] Emergency / SOS / Low mood — offer human handover immediately, no detours, no empty consolation',
  },
};

function localeFamily(locale: AssistantLocale): 'zh' | 'en' {
  return locale === 'en' ? 'en' : 'zh';
}

function jokeDirective(level: 0 | 1 | 2 | 3, family: 'zh' | 'en'): string {
  const zh = [
    '【玩笑度】0/3 · 全关 · 任何场景都不开玩笑',
    '【玩笑度】1/3 · 轻 · 客户先抛梗才接 · 不主动',
    '【玩笑度】2/3 · 偶尔 · 1 次/对话 · 客户先抛',
    '【玩笑度】3/3 · 全开 · 自嘲 / 接梗 / 吐槽都可',
  ] as const;
  const en = [
    '[Humor] 0/3 — off, no jokes in any case',
    '[Humor] 1/3 — light, only reciprocate, never start',
    '[Humor] 2/3 — occasional, max 1 per turn, user starts',
    '[Humor] 3/3 — full, self-deprecate / reciprocate / roast OK',
  ] as const;
  return (family === 'zh' ? zh : en)[level];
}

/**
 * 把 few-shot 渲染成 prompt 段落
 * 用 ## 分割 · 不放进 messages 数组以免 LLM 把样本当成历史
 */
function renderFewShots(shots: FewShot[], family: 'zh' | 'en'): string {
  if (!shots.length) return '';
  const header = family === 'zh' ? '【参考样本(不要原样照搬,只学语气)】' : '[Few-shot examples — voice only, do not copy verbatim]';
  const lines = shots.map((s, i) => {
    const u = family === 'zh' ? `客户` : `User`;
    const a = family === 'zh' ? `你` : `You`;
    return `(${i + 1}) ${u}: ${s.user}\n    ${a}: ${s.assistant}`;
  });
  return `\n\n${header}\n${lines.join('\n')}`;
}

/**
 * 装配完整 system prompt
 */
export function buildSystemPrompt(profile: VoiceProfile): string {
  const family = localeFamily(profile.locale);
  const base = family === 'zh' ? SYSTEM_PROMPT_ZH : SYSTEM_PROMPT_EN;
  const scenarioDir = SCENARIO_DIRECTIVE[profile.scenario][family];
  const jokeDir = jokeDirective(profile.jokeLevel, family);

  const localeNote = ['zh', 'en'].includes(profile.locale)
    ? ''
    : family === 'zh'
      ? `\n【客户语言提示】客户母语是 ${profile.locale} · 中文回复 + 保留客户语言中的关键梗(${profile.locale === 'th' ? 'พี่ / 句尾 ครับ' : profile.locale === 'vi' ? 'anh ơi' : profile.locale === 'id' ? 'bro / sip' : 'bro / boleh lah'})`
      : `\n[User language] User speaks ${profile.locale} — keep replies in English but preserve locale flavor`;

  const snippet = profile.profileSnippet
    ? family === 'zh'
      ? `\n\n【当前客户画像 snippet】\n${profile.profileSnippet}`
      : `\n\n[Current user profile snippet]\n${profile.profileSnippet}`
    : '';

  // 场景对应的 few-shot
  const shots = pickFewShots({ scenario: profile.scenario, locale: family, n: 3 });
  const fewshot = renderFewShots(shots, family);

  return `${base}\n\n${scenarioDir}\n${jokeDir}${localeNote}${snippet}${fewshot}`;
}

/**
 * 长对话漂移控制 · 每 5 轮回灌一次 system
 * 返回是否需要在 messages 前部再插入 system
 */
export function shouldReinjectSystem(turnCount: number): boolean {
  return turnCount > 0 && turnCount % 5 === 0;
}

/**
 * 客户 locale 字符串归一化到 AssistantLocale
 * 兼容 users.locale 的 'zh' / 'zh-CN' 等格式
 */
export function normalizeLocale(raw: string | null | undefined): AssistantLocale {
  if (!raw) return 'zh';
  const lower = raw.toLowerCase();
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('th')) return 'th';
  if (lower.startsWith('vi')) return 'vi';
  if (lower.startsWith('id')) return 'id';
  if (lower.startsWith('ms')) return 'ms';
  return 'zh';
}
