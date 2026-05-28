/**
 * 助理 Home 仪表盘共享类型 · M03 F03-Home3 数据契约
 *
 * 与后端 GET /assistant/home 响应严格对齐。
 */

export type GreetingTone = 'early' | 'morning' | 'afternoon' | 'evening' | 'late_night';

export interface AssistantGreeting {
  text: string;
  tone: GreetingTone;
}

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

export interface AssistantHomeData {
  greeting: AssistantGreeting;
  today_cards: TodayCard[];
  history: HistoryItemData[];
  quick_acts: QuickAct[];
  onboarding_required: boolean;
}
