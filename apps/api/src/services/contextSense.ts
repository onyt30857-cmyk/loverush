/**
 * 语境感知 · 轻量情绪态判定(规则版,零 LLM 零成本)
 *
 * 背景(根因②)：付费判定(chatPass)无条件前置于一切情绪判断 → 客户深夜倾诉但免费额度耗尽时，
 * 分身二话不说甩付费卡(评测"脆弱场景自曝金钱"根因)。本模块在生成前给一道情绪态判定，
 * 让付费/索礼触点受语境门控：脆弱/戒备态静默金钱框架。
 *
 * 调研依据：规则不用弱 LLM judge(judge 弱于生成模型会越校越糟，见 reference_llm_roleplay_reliability)。
 * 优先级 vulnerable > guarded > warm > neutral —— 安全优先，脆弱态压一切。
 */
export type Mood = 'vulnerable' | 'guarded' | 'neutral' | 'warm';

export interface SenseInput {
  /** 客户最近的自然语言消息(只看客户说的，按时间正序，最近的在后) */
  content: string;
  isCustomer: boolean;
}

// 脆弱信号：倾诉/低落/孤独/睡不着/情感受挫。命中即 vulnerable(最高优先)。
const VULNERABLE_RE =
  /难过|难受|想哭|哭了|哭死|崩溃|抑郁|焦虑|压力(大|好大)|撑不住|扛不住|好累|心累|疲惫|孤独|寂寞|没人(理|懂|陪)|空虚|没意思|活着.*没(意思|意义)|不想活|失业|被裁|分手|离婚|吵架了|失眠|睡不着|烦死|心烦|委屈|无助|绝望|emo|心里堵|不开心|很丧|好丧/i;

// 戒备信号：试探真假/质疑身份/冷淡敷衍。命中即 guarded。
const GUARDED_RE =
  /你是(不是|不是真)?(人|真人|机器人|ai|AI|机器|程序|客服|假的)|真的假的|是不是骗|套路|不信你|你到底是谁|你谁啊|敷衍|爱答不理|呵呵|无所谓|随便吧|你别装|装什么|演什么|机器人吧|不会是.*(机器|ai)/i;

// 暖意信号：正面情绪/亲密。命中且无脆弱/戒备 → warm。
const WARM_RE =
  /想你|喜欢你|爱你|宝贝|抱抱|亲亲|么么|开心|好开心|哈哈哈|嘻嘻|笑死|太可爱|好喜欢|心动|喜欢和你|聊得开心|你真好|谢谢你.*(陪|聊)/i;

/**
 * 纯函数：根据最近若干条客户消息判定情绪态。
 * 只看客户(isCustomer=true)的话；分身自己的话不参与情绪判定。
 */
export function senseContext(recent: SenseInput[]): { mood: Mood; signal?: string } {
  const customerText = recent
    .filter((m) => m.isCustomer)
    .map((m) => m.content ?? '')
    .join('\n');
  if (!customerText.trim()) return { mood: 'neutral' };

  const vuln = customerText.match(VULNERABLE_RE);
  if (vuln) return { mood: 'vulnerable', signal: vuln[0] };
  const guard = customerText.match(GUARDED_RE);
  if (guard) return { mood: 'guarded', signal: guard[0] };
  const warm = customerText.match(WARM_RE);
  if (warm) return { mood: 'warm', signal: warm[0] };
  return { mood: 'neutral' };
}

import { desc, eq } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { messages } from '@loverush/db';
import { isNaturalLanguage } from './messageKind';

/** 最近看几条客户自然语言消息来判情绪态(够近=反映"此刻"，够少=不被旧情绪带偏) */
const SENSE_LOOKBACK = 6;

/**
 * DB 薄封装：拉本会话最近若干条自然语言消息 → senseContext。
 * 失败安全：查不到/异常一律返回 neutral，绝不阻断回复主链。
 */
export async function senseRecentContext(
  db: Database,
  conversationId: string,
  customerId: string,
): Promise<{ mood: Mood; signal?: string }> {
  try {
    const rows = await db.query.messages.findMany({
      where: eq(messages.conversationId, conversationId),
      orderBy: [desc(messages.sentAt)],
      limit: SENSE_LOOKBACK * 3, // 多取，过滤卡片/媒体后再用
    });
    const recent: SenseInput[] = rows
      .reverse()
      .filter((m) => isNaturalLanguage(m.type))
      .slice(-SENSE_LOOKBACK)
      .map((m) => ({ content: m.contentOriginal ?? '', isCustomer: m.senderUserId === customerId }));
    return senseContext(recent);
  } catch {
    return { mood: 'neutral' };
  }
}
