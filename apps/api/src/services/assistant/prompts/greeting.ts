/**
 * 助理 home 仪表盘 · 5 时段 × 中英问候库
 *
 * PRD §3.0 F03-Home1 区块 1:问候头(时段 + L1 籍贯 + 免打扰)
 *
 * 时段切分(假设 SE Asia GMT+7):
 *   early       05:00-08:59  起床
 *   morning     09:00-11:59  上午
 *   afternoon   12:00-17:59  下午
 *   evening     18:00-22:59  晚上
 *   late_night  23:00-04:59  深夜
 *
 * 风格:好哥们腔 · 直接 · 不"您好" · 不"亲爱的"
 */

export type GreetingTone = 'early' | 'morning' | 'afternoon' | 'evening' | 'late_night';

/** SE Asia GMT+7 时区偏移(分钟)*/
export const SE_ASIA_TZ_OFFSET_MIN = 7 * 60;

/** 把当前 UTC 时间换算成 SE Asia 时段 */
export function toToneFromDate(d: Date = new Date()): GreetingTone {
  // 把 UTC ms 加上 GMT+7 偏移再取 hour
  const seAsiaMs = d.getTime() + SE_ASIA_TZ_OFFSET_MIN * 60_000;
  const hour = new Date(seAsiaMs).getUTCHours();
  if (hour >= 5 && hour < 9) return 'early';
  if (hour >= 9 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'late_night'; // 23-04
}

/** 中文问候 · 每时段 3 条候选 · 用 seed 轮转 */
const GREETINGS_ZH: Record<GreetingTone, string[]> = {
  early: ['嘿哥们,早 · 今天打算找谁?', '早 · 起得早 · 我给你看几个新档', '哎,早起的人 · 顺便帮你扫了下今晚有谁'],
  morning: ['嘿哥们,上午好', '哥们 · 还没下定主意?帮你看看', '上午好 · 给你挑了几个新到的'],
  afternoon: ['嘿哥们,下午好', '下午好 · 今天想找哪种?', '哎,下午这会儿空 · 帮你看下今晚的档'],
  evening: ['嘿哥们,晚上好 · 今晚谁?', '晚上好 · 帮你看了下今晚的档', '哥们 · 这点出来了 · 几个稳的给你'],
  late_night: ['哥们 · 还没睡?帮你看看今晚谁还能接', '深夜了 · 今晚有几个还在线', '哎 · 还在?我看看谁能接你这单'],
};

/** 英文问候 */
const GREETINGS_EN: Record<GreetingTone, string[]> = {
  early: ['Morning bro · early one today?', "You're up early — let me show you a few fresh ones", "Up early? I've already scoped tonight"],
  morning: ['Hey bro, morning', "Morning — still picking? Let me help", "Morning · got a few new arrivals for you"],
  afternoon: ['Hey bro, good afternoon', 'Afternoon · what kind today?', "Free afternoon? Let's check tonight's slots"],
  evening: ['Hey bro, evening — who tonight?', "Evening · I've already scoped tonight's slots", "Bro, you're up — got a few solid picks"],
  late_night: ["Bro, still up? Let me see who's still on", "Late night · few still online", "Still around? Let me find someone who can take you"],
};

/** 籍贯个性化前缀(L1 facts.origin / nationality)*/
const ORIGIN_TAG_ZH: Record<string, string> = {
  泰国: '(在曼谷的)',
  thailand: '(在曼谷的)',
  th: '(在曼谷的)',
  新加坡: '(在 SG 的)',
  singapore: '(在 SG 的)',
  sg: '(在 SG 的)',
  马来西亚: '(在 KL 的)',
  malaysia: '(在 KL 的)',
  my: '(在 KL 的)',
  印尼: '(在雅加达的)',
  indonesia: '(在雅加达的)',
  id: '(在雅加达的)',
  越南: '(在西贡的)',
  vietnam: '(在西贡的)',
  vn: '(在西贡的)',
};

/**
 * 生成问候语
 *
 * @param tone 时段(由 toToneFromDate 计算)
 * @param locale 客户语言 family('zh' | 'en')
 * @param nationality 客户籍贯/国别(L1 facts) · 可选
 * @param seed 轮转 seed(默认按日期取 day-of-year · 同一天同一条)
 */
export function buildGreeting(
  tone: GreetingTone,
  locale: 'zh' | 'en' = 'zh',
  nationality?: string | null,
  seed?: number,
): string {
  const pool = locale === 'en' ? GREETINGS_EN[tone] : GREETINGS_ZH[tone];
  // seed = 日历日 → 同一天问候稳定 · 跨天换新
  const s = seed ?? Math.floor(Date.now() / (24 * 3600 * 1000));
  const idx = ((s % pool.length) + pool.length) % pool.length;
  const base = pool[idx] ?? pool[0]!;
  // 籍贯个性化:仅中文且匹配到 tag 时插入
  if (locale === 'zh' && nationality) {
    const tag = ORIGIN_TAG_ZH[nationality.toLowerCase()] ?? ORIGIN_TAG_ZH[nationality];
    if (tag) {
      return `${tag}${base}`;
    }
  }
  return base;
}
