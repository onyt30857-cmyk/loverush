/**
 * 消息类型治理基座 · 分身回复链路一切「这条消息算不算分身的话」的单一判别器。
 *
 * 背景(根因)：分身的下单卡/选时段卡/付费卡等都以技师身份、JSON 原文写进同一张
 * messages 表。历史回灌、retry「已回复」判定等若按内容启发式(validateOutput)判断，
 * 卡片 JSON 会漏网被当 assistant turn 喂回 LLM → echo 串话 + 末轮崩。
 * 故这里建立统一的「按 messages.type 分类」判别器，全链路复用，禁止再各处散写 type 正则。
 */
export type MessageKind = 'NATURAL_LANGUAGE' | 'ACTION_CARD' | 'MEDIA' | 'SYSTEM';

/** 动作卡片：content 是 JSON payload，绝不能当自然语言回灌历史 */
export const ACTION_CARD_TYPES = new Set<string>([
  'order_offer',
  'schedule_offer',
  'gift_hint',
  'chat_paywall',
  'media_locked',
  'shop_info',
  'customer_location',
]);

/** 自然语言：分身/客户真正说的话，可作为 assistant/user turn 回灌 */
const NATURAL_LANGUAGE_TYPES = new Set<string>(['text']);

/** 媒体：无文本语义。voice content=JSON{text,audioUrl}、gift content=JSON{emoji,name,points},
 *  都是 JSON payload 绝不能当自然语言回灌 LLM,故归 MEDIA(同 image,历史剔除+翻译跳过)。 */
const MEDIA_TYPES = new Set<string>(['image', 'photo', 'sticker', 'voice', 'gift']);

export function classifyMessageKind(type: string | null | undefined): MessageKind {
  const t = type ?? 'text';
  if (NATURAL_LANGUAGE_TYPES.has(t)) return 'NATURAL_LANGUAGE';
  if (ACTION_CARD_TYPES.has(t)) return 'ACTION_CARD';
  if (MEDIA_TYPES.has(t)) return 'MEDIA';
  // system / system_error / 未知 type → 安全降级为 SYSTEM，绝不当自然语言回灌
  return 'SYSTEM';
}

export function isNaturalLanguage(type: string | null | undefined): boolean {
  return classifyMessageKind(type) === 'NATURAL_LANGUAGE';
}

export function isActionCard(type: string | null | undefined): boolean {
  return ACTION_CARD_TYPES.has(type ?? '');
}

/** 卡片在历史里的可选「动作面包屑」(留作未来需要让分身知道自己发过卡时用，当前历史直接剔除卡片) */
const CARD_SUMMARY: Record<string, string> = {
  order_offer: '[我刚给他发了下单卡]',
  schedule_offer: '[我刚给他发了选时段卡]',
  gift_hint: '[我刚暗示了想要礼物]',
  chat_paywall: '[我刚发了陪聊付费提示]',
  media_locked: '[我刚发了一张要解锁的照片]',
  shop_info: '[我刚发了门店信息]',
  customer_location: '[我刚收到了他的位置]',
};

export function cardActionSummary(type: string): string {
  return CARD_SUMMARY[type] ?? '';
}
