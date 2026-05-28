/**
 * 会话状态机 · M03
 *
 * 8 场景 × 4 玩笑度档位 · PRD §5.4
 *
 * 输入:客户最近 3 轮消息(最近一轮权重最高)
 * 输出:scenario + jokeLevel + 置信度
 *
 * 实现:规则优先(关键词 + 标点)· 不调 LLM · ≤ 5ms
 * 兜底:闲聊 + 玩笑度 2(偶尔)
 */

import type { FewShotScenario } from './prompts/fewshot';

export type SceneClass =
  | 'casual' // 闲聊 / 浏览 / 等待 · 玩笑度 3
  | 'selection' // 选购 / 推荐 · 玩笑度 2
  | 'after_service' // 服务后回顾 · 玩笑度 1
  | 'complaint' // 投诉 / 取消 / 退款 / 纠纷 · 玩笑度 0
  | 'low_mood' // 情绪低落 · 玩笑度 0
  | 'emergency' // SOS / 急救 · 玩笑度 0
  | 'cancel' // 取消订单 · 玩笑度 0
  | 'refund'; // 退款 · 玩笑度 0

export interface StateResult {
  /** 内部 8 分类 */
  scene: SceneClass;
  /** 映射到 Voice few-shot 的 5 大类 */
  scenario: FewShotScenario;
  jokeLevel: 0 | 1 | 2 | 3;
  /** 置信度 0-100 */
  confidence: number;
  /** 命中的关键词,便于审计 */
  hitKeywords: string[];
}

// ──────────────── 关键词库(中英双语) ────────────────

const KW_EMERGENCY = [
  // 中文
  '救命', 'sos', '报警', '不让我走', '动手了', '伤害', '危险', '心跳异常', '快不行了',
  '想结束', '想自杀', '不想活', '头晕想吐', '快窒息',
  // 英文
  'help me', 'emergency', "won't let me", 'hit me', 'in danger', 'feel sick', 'cant breathe',
  'end it tonight', 'kill myself',
];

const KW_LOW_MOOD = [
  '抑郁', '心情很糟', '难受', '哭出来', '撑不住', '崩溃', '焦虑死了',
  'depressed', 'feeling low', 'in a bad place', 'cant cope', 'breaking down',
];

const KW_REFUND = ['退款', '退钱', '不退就', 'refund', 'money back', 'i want my money'];

const KW_CANCEL = ['取消', '不要了', 'cancel', 'call off'];

const KW_COMPLAINT = [
  '投诉', '差评', '不满意', '加项', '迟到', '私下加微信', '动手动脚', 'red flag',
  'complaint', 'late', 'no-show', 'upsell', 'wechat', 'extras',
];

const KW_AFTER_SERVICE = [
  '挺好的', '一般般', '完美', '差点意思', '体验如何', '感觉怎样', '回顾',
  'how was', 'rate', 'feedback', 'review', 'after', 'today she',
];

const KW_SELECTION = [
  '推荐', '推一个', '今晚', '明天', '帮我选', '哪个好', '想要', '约', '想试',
  'recommend', 'pick', 'book', 'tonight', 'tomorrow', 'find me', 'i want',
];

// 闲聊不需要正向关键词 — 是兜底类

/**
 * 检查某条消息是否命中关键词,返回命中列表
 */
function matchKeywords(msg: string, kws: readonly string[]): string[] {
  const lower = msg.toLowerCase();
  return kws.filter((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * 从最近 3 轮消息推断状态
 * 注:从最新到最老,最新的权重最高(2x)
 */
export function detectState(recentMessages: string[]): StateResult {
  // 取最近 3 条,空数组兜底
  const msgs = recentMessages.slice(0, 3);
  const latest = msgs[0] ?? '';
  const older = msgs.slice(1).join(' ');

  // 优先级:emergency > low_mood > refund > cancel > complaint > after_service > selection > casual
  const sources = [
    { scene: 'emergency' as SceneClass, kws: KW_EMERGENCY, weight: 100 },
    { scene: 'low_mood' as SceneClass, kws: KW_LOW_MOOD, weight: 95 },
    { scene: 'refund' as SceneClass, kws: KW_REFUND, weight: 85 },
    { scene: 'cancel' as SceneClass, kws: KW_CANCEL, weight: 80 },
    { scene: 'complaint' as SceneClass, kws: KW_COMPLAINT, weight: 75 },
    { scene: 'after_service' as SceneClass, kws: KW_AFTER_SERVICE, weight: 60 },
    { scene: 'selection' as SceneClass, kws: KW_SELECTION, weight: 50 },
  ];

  for (const src of sources) {
    const latestHits = matchKeywords(latest, src.kws);
    const olderHits = matchKeywords(older, src.kws);
    const hits = [...latestHits, ...olderHits];
    if (hits.length > 0) {
      const confidence = Math.min(
        100,
        src.weight + latestHits.length * 5 + olderHits.length * 2,
      );
      return {
        scene: src.scene,
        scenario: mapToScenario(src.scene),
        jokeLevel: jokeLevelFor(src.scene),
        confidence,
        hitKeywords: hits.slice(0, 5),
      };
    }
  }

  // 兜底:闲聊
  return {
    scene: 'casual',
    scenario: 'casual',
    jokeLevel: 3,
    confidence: 40,
    hitKeywords: [],
  };
}

/** 8 分类 → 5 类 few-shot scenario 映射 */
function mapToScenario(scene: SceneClass): FewShotScenario {
  switch (scene) {
    case 'casual':
      return 'casual';
    case 'selection':
      return 'selection';
    case 'after_service':
      return 'after_service';
    case 'complaint':
    case 'cancel':
    case 'refund':
      return 'complaint';
    case 'low_mood':
    case 'emergency':
      return 'emergency';
  }
}

/** 场景 → 玩笑度 · PRD §5.4 */
function jokeLevelFor(scene: SceneClass): 0 | 1 | 2 | 3 {
  switch (scene) {
    case 'casual':
      return 3;
    case 'selection':
      return 2;
    case 'after_service':
      return 1;
    case 'complaint':
    case 'cancel':
    case 'refund':
    case 'low_mood':
    case 'emergency':
      return 0;
  }
}

/**
 * 是否处于"严肃应对"场景(玩笑全关 + 短句正经口气)
 * 注:原本用于触发"建议真人接力",该功能已撤(2026-05-28)。
 *     现在仅用于切换 voice 严肃档,不再主动转人工。
 */
export function shouldUseSeriousMode(state: StateResult): boolean {
  return (
    state.scene === 'emergency' ||
    state.scene === 'low_mood' ||
    (state.scene === 'complaint' && state.confidence >= 80)
  );
}
