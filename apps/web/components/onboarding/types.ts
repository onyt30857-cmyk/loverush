/**
 * 9 步首见 Onboarding 共享类型 · 对齐 0522 信息采集表
 *
 * 与后端 POST /assistant/onboarding/step 严格对齐:
 *   { step: 1-9, payload } → { next_step, ai_reply, visible_options?,
 *                              visible_swipe_cards?, visible_textareas?,
 *                              first_recommendation? }
 */
import type { RecommendItem } from '@/components/RecommendCard';

export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type OnboardingNextStep = OnboardingStep | 'done';

export interface OnboardingOption {
  label: string;
  value: string;
  /** 分组维度键(step 4-7 多组共存时区分)·  例如 age_pref / height_pref */
  group?: string;
}

export interface OnboardingSwipeCard {
  id: string;
  img_url: string;
  tags: string[];
}

export interface OnboardingTextarea {
  /** payload 字段名 · 例如 likes_text / dislikes_text / self_intro */
  name: string;
  /** 顶部小标题 */
  label: string;
  placeholder: string;
  maxLength?: number;
}

export interface OnboardingStepResponse {
  next_step: OnboardingNextStep;
  ai_reply: string;
  visible_options?: OnboardingOption[];
  visible_swipe_cards?: OnboardingSwipeCard[];
  visible_textareas?: OnboardingTextarea[];
  first_recommendation?: RecommendItem[];
}

export interface OnboardingStepRequest {
  step: OnboardingStep;
  payload: Record<string, unknown>;
}
