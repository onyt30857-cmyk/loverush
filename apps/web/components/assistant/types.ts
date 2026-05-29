/**
 * 助理 Home 仪表盘共享类型 · M03 v3 F03-Home3 数据契约
 *
 * 与后端 GET /assistant/home 响应严格对齐(v3 修订 2026-05-29)。
 *
 * v3 6 区块布局对应字段:
 *   1. greeting          GreetingHeader
 *   2. memory_cta        GreetingMemoryCard(可 null · 新用户隐藏)
 *   3. today_picks       RecommendationStrip(永不空 · 编辑兜底)
 *   4. recent_activity   RecentActivityFeed(空数组隐藏)
 *   5. smart_chips       InlineChatInput 上方动态 chip
 *   - onboarding_required 冷启动判定
 *
 * v2 旧字段(today_cards / history / quick_acts) 保留为 optional · 用于灰度兼容期
 */

// ──────────────── 共享 atoms ────────────────

export type GreetingTone = 'early' | 'morning' | 'afternoon' | 'evening' | 'late_night';

export interface AssistantGreeting {
  text: string;
  tone: GreetingTone;
  /** v3 新增:第 N 天("第 23 天") · 信任货币 */
  days_since_first?: number;
}

// ──────────────── v3 新增 ────────────────

/** 跨次记忆 + 主动 CTA 合一卡 · 区块 2 */
export type MemoryCtaType = 'rebook_last' | 'recall_question' | 'recall_favorite' | 'check_back';

export interface MemoryCtaAction {
  /** book_again / try_another / just_chat 等 · 由前端路由分发 */
  key: 'book_again' | 'try_another' | 'just_chat' | 'view_therapist' | 'send_message';
  label: string;
  /** 主按钮 vs 次按钮视觉 */
  primary?: boolean;
  /** book_again / view_therapist 时携带技师 id */
  ref_id?: string;
  /** send_message 时携带预填文本 */
  prefill?: string;
}

export interface MemoryCta {
  type: MemoryCtaType;
  headline: string;
  sub: string;
  actions: MemoryCtaAction[];
}

/** TherapistMiniCard 字段 · 区块 3 子项 */
export interface TherapistMiniCardData {
  therapist_id: string;
  display_name: string;
  avatar_url: string | null;
  score_service: number;        // 0-50 后端字段 → 显 *0.1
  distance_km: number | null;
  next_slot: string | null;     // "22:00空" / null
  tags: string[];               // ["新", "回头率高"]
  why_recommend: string | null;
}

/** 今晚为你挑了 · 区块 3 */
export interface TodayPicks {
  /**
   * 3 种场景:
   *   'ok'        items.length > 0 · 真实卡片显示
   *   'no_match'  数据库真没 verified 技师匹配(运营要 seed)· 友好态 + 看全部链接
   *   'preparing' 临时不可用(数据库挂)· 友好态 + 重试按钮
   */
  status?: 'ok' | 'no_match' | 'preparing';
  reason_tag: string;           // "基于你常选的安静型"
  items: TherapistMiniCardData[];
  refresh_token: string | null; // POST /assistant/home/refresh-picks 时回传
}

/** 最近行为/原话 · 区块 4 */
export type RecentActivityType = 'booking' | 'question' | 'favorite' | 'view';

export interface RecentActivityItem {
  id: string;
  type: RecentActivityType;
  text: string;
  /** booking → 订单 id · question → session id · favorite/view → therapist id */
  ref_id?: string;
}

/** 动态 chip · 区块 5 · 点击直接发送对应文本 */
export interface SmartChip {
  key: string;
  label: string;
  intent_seed: string;
}

// ──────────────── v2 旧字段(保留 optional 兼容) ────────────────

export type TodayCardType = 'recall' | 'available' | 'new_match';

export interface TodayCard {
  id: string;
  type: TodayCardType;
  title: string;
  subtitle: string;
  action_href: string;
}

export interface HistoryItemData {
  id: string;
  preview: string;
  updated_at: string;
  turns_count: number;
}

export interface QuickAct {
  key: string;
  label: string;
  intent_seed: string;
}

// ──────────────── home payload ────────────────

export interface AssistantHomeData {
  greeting: AssistantGreeting;
  /** v3 区块 2 · null 时隐藏 */
  memory_cta?: MemoryCta | null;
  /** v3 区块 3 · 永不空(编辑兜底) */
  today_picks?: TodayPicks;
  /** v3 区块 4 · 空数组隐藏 */
  recent_activity?: RecentActivityItem[];
  /** v3 区块 5 · 输入框上方动态 chip */
  smart_chips?: SmartChip[];

  // v2 兼容字段 · 后端 v3 未上线前用
  today_cards?: TodayCard[];
  history?: HistoryItemData[];
  quick_acts?: QuickAct[];

  onboarding_required: boolean;
}
