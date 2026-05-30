/**
 * 9 步首见对话 onboarding · 中文剧本 · 对齐 0522 信息采集表
 *
 * 设计原则:
 *   1. 每步聚合 1-3 个相关维度 · 不让用户疲劳
 *   2. 上一步抓到的信息,下一步开头立即兑现("懂了 · 你...")
 *   3. 步 1-7 chips · 步 8-9 自由文本 · 步 3 swipe
 *   4. 跳过权 = 信任货币(任何轮"先看看")
 */

import type { OnboardingFacts } from '../onboarding-types';

export type SwipeCard = { id: string; img_url: string; tags: string[] };
export type Option = { label: string; value: string };

// ──────────────── 步 1:城市 ────────────────

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

// ──────────────── 步 2:主要关注(锚定权重) ────────────────

export function step2Reply(facts: OnboardingFacts): string {
  const city = String(facts.city ?? '').trim();
  const cityAck = city
    ? city === 'other' || city === '其它'
      ? '哎,小众城市 · 我看看有谁覆盖。'
      : `懂了,${city} 我熟。`
    : '行 · 那继续。';
  return `${cityAck}先问最关键的:挑技师时你最在意哪一两项?多选都行,我会优先按这个权重来推。`;
}

export function step2Options(): Option[] {
  return [
    { label: '颜值与身材', value: 'looks' },
    { label: '互动与性格', value: 'vibe' },
    { label: '按摩手法 / 专业度', value: 'skill' },
    { label: '服务态度 / 贴心度', value: 'service' },
    { label: '隐私与安全感', value: 'privacy' },
    { label: '不限 · 综合推', value: 'any' },
  ];
}

// ──────────────── 步 3:颜值风格 swipe ────────────────

/** 6 张颜值风格图占位(P1 设计师补真实图) */
export function styleSwipeCards(): SwipeCard[] {
  return [
    {
      id: 'look_sweet_y',
      img_url: 'https://i.pravatar.cc/300?img=47',
      tags: ['gender:female', 'age:23-28', 'look:甜美可爱'],
    },
    {
      id: 'look_sexy_y',
      img_url: 'https://i.pravatar.cc/300?img=49',
      tags: ['gender:female', 'age:23-28', 'look:性感妩媚'],
    },
    {
      id: 'look_queen_m',
      img_url: 'https://i.pravatar.cc/300?img=44',
      tags: ['gender:female', 'age:29-35', 'look:御姐气质'],
    },
    {
      id: 'look_exotic_m',
      img_url: 'https://i.pravatar.cc/300?img=45',
      tags: ['gender:female', 'age:29-35', 'look:异域风情'],
    },
    {
      id: 'look_sweet_18',
      img_url: 'https://i.pravatar.cc/300?img=48',
      tags: ['gender:female', 'age:18-22', 'look:甜美可爱'],
    },
    {
      id: 'look_queen_36',
      img_url: 'https://i.pravatar.cc/300?img=46',
      tags: ['gender:female', 'age:36-42', 'look:御姐气质'],
    },
  ];
}

export function step3Reply(facts: OnboardingFacts): string {
  const focus = Array.isArray(facts.primary_focus) ? facts.primary_focus : [];
  const ack =
    focus.includes('looks')
      ? '颜值优先 · 那图就先发你看。'
      : focus.length
        ? '行 · 风格我先记着。'
        : '给你看 6 张颜值风格图。';
  return `${ack}顺眼直接点 · 看不上划走。不用解释 · 我看反应就懂——比你描述快多了。`;
}

// ──────────────── 步 4:技师外形偏好(年龄/身高/体型/胸围) ────────────────

export function step4Reply(facts: OnboardingFacts): string {
  const looks = Array.isArray(facts.look_style) ? facts.look_style : [];
  const ack = looks.length
    ? `看出来了 · ${looks.slice(0, 2).join(' / ')} 这条线我记下了。`
    : '行 · 风格边推边校准。';
  return `${ack}再细一点:年龄、身高、体型、胸围 · 想到啥选啥 · 不想卡的留"不限"就行。`;
}

export function step4AgeOptions(): Option[] {
  return [
    { label: '18-22 少女', value: '18-22' },
    { label: '23-28 青春', value: '23-28' },
    { label: '29-35 轻熟', value: '29-35' },
    { label: '36-42 少妇', value: '36-42' },
    { label: '不限', value: 'any' },
  ];
}

export function step4HeightOptions(): Option[] {
  return [
    { label: '≤159 cm', value: '<=159' },
    { label: '160-164', value: '160-164' },
    { label: '165-169', value: '165-169' },
    { label: '≥170 cm', value: '>=170' },
    { label: '不限', value: 'any' },
  ];
}

export function step4BodyOptions(): Option[] {
  return [
    { label: '纤细苗条', value: '纤细苗条' },
    { label: '匀称健康', value: '匀称健康' },
    { label: '软糯丰满', value: '软糯丰满' },
    { label: '高挑大气', value: '高挑大气' },
    { label: '不限', value: 'any' },
  ];
}

export function step4BustOptions(): Option[] {
  return [
    { label: 'A-B 清秀', value: 'A-B' },
    { label: 'C 恰好', value: 'C' },
    { label: 'D 丰盈', value: 'D' },
    { label: 'E-G 丰满', value: 'E-G' },
    { label: '不限', value: 'any' },
  ];
}

// ──────────────── 步 5:服务风格 + 服务力度 ────────────────

export function step5Reply(facts: OnboardingFacts): string {
  const body = Array.isArray(facts.body_type) ? facts.body_type : [];
  const ack = body.length
    ? `身材方向 ${body.slice(0, 2).join(' / ')} 收到。`
    : '行。';
  return `${ack}风格上是想要话少专注,还是有说有笑?手法力度偏轻还是重?`;
}

export function step5StyleOptions(): Option[] {
  return [
    { label: '温柔安静(话少专注)', value: '温柔安静' },
    { label: '活泼聊天(气氛好)', value: '活泼聊天' },
    { label: '成熟知性(聊得来)', value: '成熟知性' },
    { label: '体贴入微(细节满分)', value: '体贴入微' },
    { label: '元气开朗(让人开心)', value: '元气开朗' },
    { label: '不限', value: 'any' },
  ];
}

export function step5StrengthOptions(): Option[] {
  return [
    { label: '轻柔舒缓', value: '轻柔舒缓' },
    { label: '适中均衡', value: '适中均衡' },
    { label: '力度较重', value: '力度较重' },
    { label: '按需调整', value: '按需调整' },
  ];
}

// ──────────────── 步 6:国籍 + 语言 + 服务区域 ────────────────

export function step6Reply(facts: OnboardingFacts): string {
  const style = Array.isArray(facts.service_style) ? facts.service_style : [];
  const ack = style.length
    ? `${style[0]} 这条线我手上有几个稳的。`
    : '行。';
  return `${ack}国籍 / 语言 / 距离这三件 · 哪种都行就留"不限"。`;
}

export function step6NationOptions(): Option[] {
  return [
    { label: '泰国', value: '泰国' },
    { label: '马来西亚', value: '马来西亚' },
    { label: '中国', value: '中国' },
    { label: '本地华人', value: '本地华人' },
    { label: '缅甸', value: '缅甸' },
    { label: '印尼', value: '印尼' },
    { label: '越南', value: '越南' },
    { label: '不限', value: 'any' },
  ];
}

export function step6LangOptions(): Option[] {
  return [
    { label: '中文', value: 'zh' },
    { label: '英文', value: 'en' },
    { label: '泰文', value: 'th' },
    { label: '都行', value: 'any' },
  ];
}

export function step6AreaOptions(): Option[] {
  return [
    { label: '车程 30 分钟以内', value: '30min' },
    { label: '车程 1 小时内', value: '1h' },
    { label: '车程 2 小时内', value: '2h' },
    { label: '不限', value: 'any' },
  ];
}

// ──────────────── 步 7:价位 + 隐私 + 小费 + 时段 ────────────────

export function step7Reply(_facts: OnboardingFacts): string {
  return '还有钱、时间和隐私这三件 · 一次说完:预算上限、几点方便、要不要用代号代金额。另外:小费意向越高 · 系统优先给你匹配热门技师。';
}

export function step7PriceOptions(): Option[] {
  return [
    { label: '无所谓 · 推好的就行', value: 'flexible' },
    { label: '低价位(性价比)', value: 'low' },
    { label: '中等价位', value: 'mid' },
    { label: '高端', value: 'high' },
  ];
}

export function step7PrivacyOptions(): Option[] {
  return [
    { label: '用代号 · 我懂', value: 'codename' },
    { label: '直接说金额', value: 'plain' },
  ];
}

export function step7TipOptions(): Option[] {
  return [
    { label: '不给小费', value: 'none' },
    { label: '20-50 元', value: '20-50' },
    { label: '50-100 元', value: '50-100' },
    { label: '100-200 元', value: '100-200' },
    { label: '200 元以上', value: '200+' },
  ];
}

export function step7TimeOptions(): Option[] {
  return [
    { label: '今晚 8 点左右', value: '20:00' },
    { label: '今晚 10 点后', value: '22:00' },
    { label: '明天白天', value: 'tomorrow_day' },
    { label: '看情况 · 你推就行', value: 'flexible' },
  ];
}

// ──────────────── 步 8:特别喜欢 + 特别讨厌(textarea) ────────────────

export function step8Reply(_facts: OnboardingFacts): string {
  return '最关键的两件 · 一定要写 · 哪怕一两句:你最吃哪一套?最受不了什么?这两个写得越具体,我推得越准 · 比上面选项加起来还管用。';
}

export function step8LikesPlaceholder(): string {
  return '比如:喜欢聊天陪伴 / 喜欢拥抱 / 服务结束后多聊一会儿';
}

export function step8DislikesPlaceholder(): string {
  return '比如:讨厌临时加价 / 讨厌全程看手机 / 讨厌迟到不通知';
}

// ──────────────── 步 9:自我推荐 + 出 3 推荐 ────────────────

export function step9Reply(_facts: OnboardingFacts): string {
  return '最后一项 · 简单介绍下你自己(技师在接单前会看到这段,可以让她对你有个初判):多大、什么职业、有没有什么习惯。不写也行,但写了配合度会高很多。';
}

export function step9IntroPlaceholder(): string {
  return '比如:30 岁出头,不太爱说话,我很注重个人卫生,服务前一定会洗澡。从不乱摸,完全尊重技师工作边界。找到喜欢的会长期复购。';
}

/** 完成 · 力推 + 留口子 · 把推荐口播出来 */
export function step9DoneReply(facts: OnboardingFacts, picksCount: number): string {
  const looks = Array.isArray(facts.look_style) ? facts.look_style : [];
  const time = String(facts.time_slot ?? '');
  const tags: string[] = [];
  if (looks.length) tags.push(`${looks.slice(0, 1).join('')}风格`);
  if (time && time !== 'flexible') tags.push('对得上时段');
  if (facts.price_range && facts.price_range !== 'flexible') tags.push('价位合适');
  if (facts.language && facts.language !== 'any') tags.push(`${facts.language} 沟通`);
  const tagsLine = tags.length ? `[${tags.join(' / ')}]` : '[今晚最稳的]';
  if (picksCount === 0) {
    return '齐活。你的偏好范围里暂时没现成的稳的 · 我先把方向记下来 · 有空档我顶上 · 不催。';
  }
  return `齐活。基于你刚说的 · 我给你挑了 ${picksCount} 个最稳的 —— ${tagsLine}这条线里今天评价没翻车的。觉得对味点进去 · 不行回来换。先看看也行 · 不催。`;
}

// ──────────────── 旧接口兼容(server 旧调用) ────────────────

/** 旧 step6Reply 别名 · 路由到 step9DoneReply(server 调用兼容)*/
export function step6DoneReply(facts: OnboardingFacts, picksCount: number): string {
  return step9DoneReply(facts, picksCount);
}

// ──────────────── 杂项 ────────────────

export function selfDeprecateSkip(): string {
  return '我话多了哈 · 直接上 3 个看看 · 不行你再骂我。';
}

export function resumeAfterInterrupt(): string {
  return '刚那个你看了吗?接着帮你校准。';
}
