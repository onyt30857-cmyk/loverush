/**
 * 6 步首见 Onboarding 共享类型 · M03 F03-OB1
 *
 * 与后端 POST /assistant/onboarding/step 严格对齐:
 *   { step: 1-6, payload } → { next_step, ai_reply, visible_options?,
 *                              visible_swipe_cards?, first_recommendation? }
 */
import type { RecommendItem } from '@/components/RecommendCard';

export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6;
export type OnboardingNextStep = OnboardingStep | 'done';

export interface OnboardingOption {
  label: string;
  value: string;
}

export interface OnboardingSwipeCard {
  id: string;
  img_url: string;
  tags: string[];
}

export interface OnboardingStepResponse {
  next_step: OnboardingNextStep;
  ai_reply: string;
  visible_options?: OnboardingOption[];
  visible_swipe_cards?: OnboardingSwipeCard[];
  first_recommendation?: RecommendItem[];
}

export interface OnboardingStepRequest {
  step: OnboardingStep;
  payload: Record<string, unknown>;
}
