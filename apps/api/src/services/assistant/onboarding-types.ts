/**
 * Onboarding 共享类型 · PRD §3.0.1 F03-OB1
 *
 * facts 是累计抓到的字段(每一步往里塞,最终写入 customer_saved_memory.facts/stable_prefs)。
 */

export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6;
export type NextStep = OnboardingStep | 'done';

export interface OnboardingFacts {
  /** 步 1:city */
  city?: string;
  /** 步 2:intent · relax / deep_tissue / explore */
  intent?: string;
  /** 步 3 swipe 衍生:gender_pref(female / male / any) */
  gender_pref?: string;
  /** 步 3 swipe 衍生:age_pref(数组,如 ['20-25','26-32']) */
  age_pref?: string[];
  /** 步 3 swipe 衍生:style_pref(数组,如 ['温柔','活力']) */
  style_pref?: string[];
  /** 步 4:time_slot · '20:00' / '22:00' / 'tomorrow_day' / 'flexible' */
  time_slot?: string;
  /** 步 4:language · zh / en / th / any */
  language?: string;
  /** 步 5:price_range · low / mid / high / flexible */
  price_range?: string;
  /** 步 5:privacy_mode · codename / plain */
  privacy_mode?: string;
  /** 完成标记 */
  onboarding_complete?: boolean;
}

/**
 * 步 3 swipe payload 形状:
 *   { liked: ['style_tender_young_f', 'style_pro_mid_f'], skipped: ['style_deep_pro_m'] }
 *
 * 由 onboarding.ts 解析 cards 的 tags 抽取 gender / age / style 偏好。
 */
export interface SwipePayload {
  liked?: string[];
  skipped?: string[];
}
