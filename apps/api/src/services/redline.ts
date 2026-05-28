/**
 * 红线检测 · M06 F06.29
 *
 * 5 类红线：
 * 1. contact_off_platform   — 引导客户线下加微信/Telegram/WhatsApp/Line
 * 2. payment_off_platform   — 引导线下转账/微信红包/USDT
 * 3. fake_memory            — 编造客户没说过的过往（"上次你..." 但实际无此记录）
 * 4. minor                  — 涉及未成年
 * 5. illegal                — 毒品 / 暴力 / 仇恨
 *
 * 二层结构：规则层（关键词）→ LLM 语义层（边界场景）
 * 命中 → 写 ai_alter_redline_logs；action = block / rewrite / pass
 */

import type {
  Database} from '@loverush/db';
import {
  aiAlterRedlineLogs,
} from '@loverush/db';
import {
  createLLMGateway,
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  type LLMGateway,
} from '@loverush/llm';
import { loadEnv } from '../env';

export interface RedlineContext {
  db: Database;
}

const KEYWORDS: Record<string, RegExp[]> = {
  contact_off_platform: [
    /微信|wechat|加我微|line|telegram|whatsapp|telegram|tg|手机号|私下加我|加微信|个人联系|私加/i,
    /扫一下|加好友|二维码|微信号|line\s*id|qq\s*号/i,
  ],
  payment_off_platform: [
    /转账|红包|私下付|私下转|usdt|btc|eth|微信支付|alipay|支付宝|私下结算|line\s*pay|paynow\s*转/i,
    /给我转|打我账户|个人账户/i,
  ],
  minor: [
    /未成年|学生妹|18\s*[-~]\s*\d|高中|初中|loli|萝莉|小学生/i,
  ],
  illegal: [
    /毒品|大麻|可卡因|冰毒|摇头丸|海洛因|武器|刀具|强奸|暴力侵犯/i,
  ],
};

export type RedlineFlag = keyof typeof KEYWORDS | 'fake_memory';

export interface RedlineCheckArgs {
  text: string;
  /** 历史上下文（用于检测 fake_memory） */
  historyText?: string;
  therapistUserId: string;
}

export interface RedlineResult {
  flags: RedlineFlag[];
  action: 'pass' | 'rewrite' | 'block';
  rewritten?: string;
  confidence: number;
}

function ruleCheck(text: string): RedlineFlag[] {
  const flags: RedlineFlag[] = [];
  for (const [flag, patterns] of Object.entries(KEYWORDS)) {
    if (patterns.some((p) => p.test(text))) flags.push(flag);
  }
  return flags;
}

let gw: LLMGateway | null = null;
let gwAvailable: boolean | null = null;

function gateway(): LLMGateway | null {
  if (gwAvailable === false) return null;
  if (gw) return gw;
  const env = loadEnv();
  // 无任何 LLM provider 时返回 null，调用方走 stub fallback
  // （避免 dev / CI / dry-run 缺 key 时卡在 SDK retry）
  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY && !env.GOOGLE_GEMINI_API_KEY) {
    gwAvailable = false;
    return null;
  }
  gw = createLLMGateway({
    providers: {
      anthropic: env.ANTHROPIC_API_KEY ? new AnthropicProvider(env.ANTHROPIC_API_KEY) : undefined,
      openai: env.OPENAI_API_KEY ? new OpenAIProvider(env.OPENAI_API_KEY) : undefined,
      gemini: env.GOOGLE_GEMINI_API_KEY ? new GeminiProvider(env.GOOGLE_GEMINI_API_KEY) : undefined,
    },
  });
  gwAvailable = true;
  return gw;
}

async function llmFakeMemoryCheck(text: string, historyText?: string): Promise<boolean> {
  if (!historyText) return false;
  const gw = gateway();
  if (!gw) return false; // 无 LLM 时保守不告警，依赖人工抽检兜底
  const res = await gw.complete({
    tier: 'T2',
    system:
      '你是事实核查器。判断"候选回复"是否包含历史对话中未提及的具体记忆（编造客户没说过的事）。仅输出 yes / no。',
    messages: [
      { role: 'user', content: `历史对话：\n${historyText}\n\n候选回复：\n${text}\n\n候选是否编造了未提及的具体记忆？` },
    ],
    maxTokens: 5,
    temperature: 0,
    tag: 'redline.fake_memory',
  });
  return /yes/i.test(res.content.trim());
}

async function rewrite(text: string, flags: RedlineFlag[]): Promise<string> {
  const gw = gateway();
  // 无 LLM 时返回原文 · action 仍为 rewrite · 让上游凭证链留痕走人工
  if (!gw) return text;
  const res = await gw.complete({
    tier: 'T2',
    system:
      '你是平台 AI 安全官。把违规候选改写为合规自然的版本：不引导线下、不涉未成年、不涉非法、不编造记忆；保持原语气与意图。仅输出改写文本，无解释。',
    messages: [
      { role: 'user', content: `违规标签：${flags.join(', ')}\n\n违规候选：${text}\n\n改写：` },
    ],
    maxTokens: 300,
    temperature: 0.5,
    tag: 'redline.rewrite',
  });
  return res.content.trim();
}

export async function checkAndAct(
  ctx: RedlineContext,
  args: RedlineCheckArgs,
): Promise<RedlineResult> {
  const flags: RedlineFlag[] = ruleCheck(args.text);

  // fake_memory 仅在有历史时调 LLM
  if (args.historyText && (await llmFakeMemoryCheck(args.text, args.historyText))) {
    flags.push('fake_memory');
  }

  if (flags.length === 0) {
    return { flags: [], action: 'pass', confidence: 90 };
  }

  const hasHardBlock = flags.includes('minor') || flags.includes('illegal');
  const action: RedlineResult['action'] = hasHardBlock ? 'block' : 'rewrite';

  let rewritten: string | undefined;
  if (action === 'rewrite') {
    rewritten = await rewrite(args.text, flags);
  }

  await ctx.db.insert(aiAlterRedlineLogs).values({
    therapistUserId: args.therapistUserId,
    stage: 'pre_send',
    flag: flags.join(','),
    candidateText: args.text.slice(0, 1000),
    contextText: args.historyText?.slice(0, 2000),
    action,
    rewrittenText: rewritten,
    confidence: 85,
  });

  return { flags, action, rewritten, confidence: 85 };
}
