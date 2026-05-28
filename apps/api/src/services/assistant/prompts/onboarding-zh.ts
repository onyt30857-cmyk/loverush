/**
 * 6 步首见对话 onboarding · 中文剧本
 *
 * PRD §3.0.1 F03-OB1
 *
 * 核心原则:
 *   1. 零问卷感(轮 3 看图代替敏感问题)
 *   2. 每抓必兑现(下一轮立刻"我懂了"反馈)
 *   3. 动机 > 客观字段
 *   4. 6 屏内出 3 选 1
 *   5. 跳过权 = 信任货币(任何轮"先看看")
 */

import type { OnboardingFacts } from '../onboarding-types';

export type SwipeCard = { id: string; img_url: string; tags: string[] };
export type Option = { label: string; value: string };

/** 6 张风格图占位(PRD: P1 设计师补真实图) */
export function styleSwipeCards(): SwipeCard[] {
  return [
    {
      id: 'style_tender_young_f',
      img_url: 'https://i.pravatar.cc/300?img=47',
      tags: ['gender:female', 'age:20-25', 'style:温柔'],
    },
    {
      id: 'style_outgoing_young_f',
      img_url: 'https://i.pravatar.cc/300?img=49',
      tags: ['gender:female', 'age:20-25', 'style:活力'],
    },
    {
      id: 'style_pro_mid_f',
      img_url: 'https://i.pravatar.cc/300?img=44',
      tags: ['gender:female', 'age:26-32', 'style:专业'],
    },
    {
      id: 'style_mature_f',
      img_url: 'https://i.pravatar.cc/300?img=45',
      tags: ['gender:female', 'age:33-40', 'style:成熟稳重'],
    },
    {
      id: 'style_deep_pro_m',
      img_url: 'https://i.pravatar.cc/300?img=12',
      tags: ['gender:male', 'age:26-32', 'style:重手法'],
    },
    {
      id: 'style_quiet_pro_f',
      img_url: 'https://i.pravatar.cc/300?img=48',
      tags: ['gender:female', 'age:26-32', 'style:安静'],
    },
  ];
}

/** 步 1 台词:报家门 · 抓 city */
export function step1Reply(): string {
  return '嘿,我是你的小助理。帮你过滤花里胡哨踩雷率高的店 · 直接挑能下单的。我免费 · 聊多少都行。先说,你这会儿在哪个城?';
}

export function step1Options(): Option[] {
  return [
    { label: '曼谷', value: '曼谷' },
    { label: '新加坡', value: '新加坡' },
    { label: '吉隆坡', value: '吉隆坡' },
    { label: '雅加达', value: '雅加达' },
    { label: '西贡', value: '西贡' },
    { label: '其它', value: 'other' },
  ];
}

/** 步 2 台词:动机问句 · 抓 intent · 用上一步的 city 兑现 */
export function step2Reply(facts: OnboardingFacts): string {
  const city = String(facts.city ?? '').trim();
  const cityAck = city
    ? city === '曼谷'
      ? '懂了,曼谷我熟。'
      : city === 'other' || city === '其它'
        ? '哎,小众城市 · 我看看有谁覆盖。'
        : `懂了,${city} 我熟。`
    : '行 · 那继续。';
  return `${cityAck}你今晚是哪种状态?① 工作累成狗想躺平 ② 想找手法到位好好松开 ③ 单纯想换换心情看看新地方。直觉选 · 不用想。`;
}

export function step2Options(): Option[] {
  return [
    { label: '工作累成狗想躺平', value: 'relax' },
    { label: '想找手法到位好好松开', value: 'deep_tissue' },
    { label: '换换心情看看新地方', value: 'explore' },
  ];
}

/** 步 3 台词:看图说话 · 抓 gender/age/style · 用上一步 intent 兑现 */
export function step3Reply(facts: OnboardingFacts): string {
  const intent = String(facts.intent ?? '');
  const ack =
    intent === 'relax'
      ? '行 · 累了就别绕弯路。'
      : intent === 'deep_tissue'
        ? '懂 · 那我给你看的会偏重手法。'
        : intent === 'explore'
          ? '哎 · 来玩的 · 那帮你看看新到的。'
          : '行嘞。';
  return `${ack}给你看 6 张风格图 · 顺眼直接点 · 看不上划走。不用解释 · 我看反应就懂——比你描述快多了。`;
}

/** 步 4 台词:即时兑现 + 时段 · 抓 time_slot + language */
export function step4Reply(facts: OnboardingFacts): string {
  const styles = Array.isArray(facts.style_pref) ? (facts.style_pref as string[]) : [];
  const styleAck = styles.length
    ? `看出来了 · 你偏好 ${styles.slice(0, 2).join(' / ')} 风格 · 我手上正好有几个稳的。`
    : '行 · 风格我先记着 · 边推边校准。';
  return `${styleAck}最后两件小事:几点比较方便?语言要中文还是英文/泰文?`;
}

export function step4TimeOptions(): Option[] {
  return [
    { label: '今晚 8 点左右', value: '20:00' },
    { label: '今晚 10 点后', value: '22:00' },
    { label: '明天白天', value: 'tomorrow_day' },
    { label: '看情况 · 你推就行', value: 'flexible' },
  ];
}

export function step4LangOptions(): Option[] {
  return [
    { label: '中文', value: 'zh' },
    { label: '英文', value: 'en' },
    { label: '泰文', value: 'th' },
    { label: '都行', value: 'any' },
  ];
}

/** 步 5 台词:隐私 + 价格 · 抓 price_range + privacy_mode */
export function step5Reply(_facts: OnboardingFacts): string {
  return '还有 · 有些哥们在意预算和隐私 —— 你有预算上限要卡着?还是无所谓?另外,介意我用代号代替直接金额吗?';
}

export function step5PriceOptions(): Option[] {
  return [
    { label: '无所谓 · 推好的就行', value: 'flexible' },
    { label: '低价位(性价比)', value: 'low' },
    { label: '中等价位', value: 'mid' },
    { label: '高端', value: 'high' },
  ];
}

export function step5PrivacyOptions(): Option[] {
  return [
    { label: '用代号 · 我懂', value: 'codename' },
    { label: '直接说金额', value: 'plain' },
  ];
}

/** 步 6 台词:力推 + 留口子 · 把推荐口播出来 */
export function step6Reply(facts: OnboardingFacts, picksCount: number): string {
  const styles = Array.isArray(facts.style_pref) ? (facts.style_pref as string[]) : [];
  const time = String(facts.time_slot ?? '');
  const tags: string[] = [];
  if (styles.length) tags.push(`${styles.slice(0, 1).join('')}风格`);
  if (time && time !== 'flexible') tags.push('对得上时段');
  if (facts.price_range && facts.price_range !== 'flexible') tags.push('价位合适');
  if (facts.language && facts.language !== 'any') tags.push(`${facts.language} 沟通`);
  const tagsLine = tags.length ? `[${tags.join(' / ')}]` : '[今晚最稳的]';
  if (picksCount === 0) {
    return '齐活。今晚你的偏好范围里暂时没现成的稳的 · 我先把方向记下来 · 有空档我顶上 · 不催。';
  }
  return `齐活。基于你刚说的 · 我给你挑了 ${picksCount} 个最稳的 —— ${tagsLine}这条线里今天评价没翻车的。觉得对味点进去 · 不行回来换。先看看也行 · 不催。`;
}

/** 自嘲跳过(连续 2 步空 payload) */
export function selfDeprecateSkip(): string {
  return '我话多了哈 · 直接上 3 个看看 · 不行你再骂我。';
}

/** 中途打断后回拢 */
export function resumeAfterInterrupt(): string {
  return '刚那个你看了吗?接着帮你校准。';
}
