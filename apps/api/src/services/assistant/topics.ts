/**
 * 私聊找话题 · 客户在跟技师对话时点'💬 找话题'触发
 *
 * - 基于技师档案(bio/tags/skills/nationality)生成 3 个温柔自然的开场白
 * - 反 AI slop · 避免"亲爱的"等推销词 · 玫瑰品牌调性
 * - 客户选 1 个直接填入输入框(不强制发送)
 *
 * 性能:T2(中等模型)够 · 不需要 T3
 */

import { eq } from 'drizzle-orm';
import type { LLMGateway } from '@loverush/llm';
import type { Database } from '@loverush/db';
import { therapists, users } from '@loverush/db';
import { HttpError } from '../../middleware/errors';
import { ErrorCode } from '@loverush/types';

export interface TopicsContext {
  db: Database;
}

const SYSTEM_PROMPT_ZH = `你是用户(男性客户)的对话教练。用户在跟一位技师进入私聊页,想要破冰但不知道说什么。

任务:根据下面提供的技师档案,生成 3 个【自然温柔的开场白】供客户选择直接发送。

风格铁律:
- 每句 ≤ 25 字 · 中文 · 简单直接
- 不要"亲爱的""美女"等油腻词
- 不要推销味 · 不要太正式
- 像真人朋友第一句话那种自然
- 一句聚焦"夸她优点" · 一句聚焦"问她最近" · 一句聚焦"约一下"
- 避免重复模板感 · 不带 emoji

输出严格 JSON 数组(只 3 个字符串 · 不加任何额外文字):
["...", "...", "..."]`;

const SYSTEM_PROMPT_EN = `You are a chat coach. The user (male customer) wants to break the ice with a therapist.

Generate 3 short, natural opening lines based on her profile.

Rules:
- Each ≤ 20 words · simple direct
- No "honey/babe/queen" type pickup words
- No sales tone · not too formal
- Like a real friend's first message
- One praise · one ask-her · one suggest-meet
- No emoji · No template feel

Output strict JSON array of 3 strings only:
["...", "...", "..."]`;

export async function suggestTopics(
  ctx: TopicsContext,
  gateway: LLMGateway,
  args: { therapistId: string; locale?: 'zh' | 'en' },
): Promise<string[]> {
  const t = await ctx.db.query.therapists.findFirst({
    where: eq(therapists.id, args.therapistId),
  });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');

  // 拿 display_name 用于个性化
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, t.userId) });
  const name = (u?.displayName ?? '').trim() || '她';

  const bio = (t.bio ?? '').slice(0, 150);
  const tags = (t.tags ?? []).slice(0, 6).join('、');
  const nation = t.nationality ?? '';
  const city = t.serviceCity ?? '';
  const langs = (t.languages ?? []).slice(0, 3).join('、');

  const locale = args.locale ?? 'zh';
  const systemPrompt = locale === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_ZH;

  const userPrompt =
    locale === 'en'
      ? `Therapist profile:
- Name: ${name}
- Bio: ${bio || 'N/A'}
- Tags: ${tags || 'N/A'}
- Nationality: ${nation || 'N/A'}
- City: ${city || 'N/A'}
- Languages: ${langs || 'N/A'}

Give me 3 opening lines now.`
      : `技师档案:
- 名字:${name}
- 自我介绍:${bio || '暂无'}
- 标签:${tags || '暂无'}
- 国籍:${nation || '未填'}
- 城市:${city || '未填'}
- 语言:${langs || '未填'}

现在给我 3 个开场白。`;

  try {
    const res = await gateway.complete({
      tier: 'T2',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 300,
      temperature: 0.85, // 多样性 · 避免每次都返一样
    });
    const text = res.content.trim();

    // 解析 JSON 数组(LLM 可能带 ```json``` 包装)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('LLM 未返回 JSON 数组');
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) throw new Error('返回非数组');

    // 过滤 + 限长 + 去重 · 取最多 3 个
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (!trimmed) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed.slice(0, 60));
      if (out.length >= 3) break;
    }
    if (out.length === 0) throw new Error('LLM 返空数组');
    return out;
  } catch (e) {
    // LLM 失败 fallback · 给静态兜底(基于 name)
    const fallback =
      locale === 'en'
        ? [
            `Hi ${name}, your bio caught my eye.`,
            'How is your day so far?',
            'Free tonight for a chat?',
          ]
        : [
            `${name},看了你的介绍 想聊聊`,
            '你最近怎么样?',
            '今晚有空吗 想见见你',
          ];
    // log 但不抛
    const { logger } = await import('../logger');
    logger.error('topics.llm_failed', {
      err: e instanceof Error ? e.message : String(e),
      therapistId: args.therapistId,
    });
    return fallback;
  }
}
