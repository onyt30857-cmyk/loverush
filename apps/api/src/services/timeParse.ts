/**
 * 中文相对时间解析 · 防越权承诺档期(Phase3)
 *
 * 客户问"今晚8点有空吗"，分身越权答应"可以呀"——但那个点技师可能已被约。
 * 本模块把客户消息里的"今晚8点 / 明天下午3点"解析成 { day, wallMinutes }，
 * 供 checkSlotOverreach 对照真实 slot 校验。
 *
 * 时区约定(与 availability.ts / therapist_facts.ts 自洽)：wallMinutes = 墙上钟点分钟数，
 * 直接对应 slot.startAt 的 HH:MM(不做时区转换)。day 相对技师本地今天/明天。
 *
 * 保守原则：只有能【确信】解析出 24h 时间时才返回(有时段词 或 24h 格式)；
 * 裸"8点"这种 AM/PM 歧义一律返回 null，交给粗粒度 todayFull 检查 + prompt grounding 兜，
 * 绝不因猜错时间而误杀正确回答。
 */
export interface RequestedTime {
  day: 'today' | 'tomorrow';
  /** 墙上钟点分钟数 0..1439 */
  wallMinutes: number;
  /** 命中的原文片段(调试/日志) */
  raw: string;
}

const CN_NUM: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 中文数字(0-23,支持 十/十一/十二/二十/二十一…)→ 数字；纯数字直接 parse */
function cnHour(s: string): number | null {
  if (/^\d{1,2}$/.test(s)) {
    const n = parseInt(s, 10);
    return n >= 0 && n <= 23 ? n : null;
  }
  // 中文：十=10 十一=11 十二=12 二十=20 二十三=23
  if (s === '十') return 10;
  let m = /^十([一二三四五六七八九])$/.exec(s);
  if (m) return 10 + CN_NUM[m[1]!]!;
  m = /^二十([一二三])?$/.exec(s);
  if (m) return 20 + (m[1] ? CN_NUM[m[1]]! : 0);
  if (s.length === 1 && CN_NUM[s] != null) return CN_NUM[s];
  return null;
}

const DAY_TOMORROW = /明天|明早|明晨|明儿/;
const DAY_TOMORROW_EVE = /明晚/;

// 时段词 → 加在小时上的偏移规则
type Period = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | null;
function periodOf(text: string): Period {
  if (/凌晨|半夜|夜里|深夜/.test(text)) return 'dawn';
  if (/早上|早晨|上午|清晨/.test(text)) return 'morning';
  if (/中午|晌午/.test(text)) return 'noon';
  if (/下午|午后/.test(text)) return 'afternoon';
  if (/晚上|傍晚|今晚|明晚|今夜/.test(text)) return 'evening';
  return null;
}

/** period + 12 制小时 → 24h 小时数；返回 null 表示无法确信解析 */
function to24h(hour: number, period: Period): number | null {
  if (period === 'dawn') return hour === 12 ? 0 : hour; // 凌晨12点=0
  if (period === 'morning') return hour === 12 ? 0 : hour;
  if (period === 'noon') return 12;
  if (period === 'afternoon') return hour < 12 ? hour + 12 : hour; // 下午3点=15
  if (period === 'evening') return hour < 12 ? hour + 12 : hour === 12 ? 0 : hour; // 晚上8点=20, 晚上12点=0
  // 无时段词：只接受明确的 24h 制(>=13)，其余歧义返回 null
  if (hour >= 13 && hour <= 23) return hour;
  if (hour === 0) return 0;
  return null;
}

/**
 * 解析客户消息里的具体约定时间。无法确信 → null。
 */
export function parseRequestedTime(text?: string | null): RequestedTime | null {
  if (!text) return null;
  const day: 'today' | 'tomorrow' =
    DAY_TOMORROW.test(text) || DAY_TOMORROW_EVE.test(text) ? 'tomorrow' : 'today';
  const period = periodOf(text);

  // 1) HH:MM 格式(20:00 / 8:30)
  let m = /([0-2]?\d)[:：]([0-5]\d)/.exec(text);
  if (m) {
    const h = parseInt(m[1]!, 10);
    const min = parseInt(m[2]!, 10);
    const h24 = h <= 12 && period ? to24h(h, period) : h >= 0 && h <= 23 ? h : null;
    if (h24 == null) return null;
    return { day, wallMinutes: h24 * 60 + min, raw: m[0] };
  }

  // 2) X点(半/X分)? —— 数字或中文
  m = /([0-2]?\d|[一两二三四五六七八九十]{1,3})\s*点\s*(半|[0-5]?\d\s*分)?/.exec(text);
  if (m) {
    const h = cnHour(m[1]!);
    if (h == null) return null;
    const h24 = to24h(h, period);
    if (h24 == null) return null; // 裸数字无时段 → 歧义 → 不解析
    let min = 0;
    if (m[2]) {
      if (m[2].includes('半')) min = 30;
      else {
        const mm = /(\d+)/.exec(m[2]);
        if (mm) min = parseInt(mm[1]!, 10);
      }
    }
    return { day, wallMinutes: h24 * 60 + (min % 60), raw: m[0] };
  }

  return null;
}
