/**
 * 搜索行为埋点 · 失败全部静默(不影响 UX)
 *
 * 流程:
 *   1. 进 results 页 · trackSearch 写一条 log · 返回 logId
 *   2. 点击技师卡 · trackClick(logId, therapistId) 回写
 *
 * 两个都不 await · 即使 API 挂掉搜索也照常用
 */

import { apiGet, apiPost, apiPatch } from './api';

interface TrackSearchInput {
  rawQuery: string;
  parsedQuery?: Record<string, unknown>;
  resultCount: number;
  personalized: boolean;
}

/** 返回 log_id · 失败返 null(组件可继续使用,但 click 回写会跳过) */
export async function trackSearch(input: TrackSearchInput): Promise<string | null> {
  try {
    const res = await apiPost<{ log_id: string | null }>('/search/log', {
      raw_query: input.rawQuery,
      parsed_query: input.parsedQuery,
      result_count: input.resultCount,
      personalized: input.personalized,
    });
    return res.log_id ?? null;
  } catch {
    return null;
  }
}

/** 点击技师卡时回写 · logId 为 null 时跳过 */
export async function trackClick(logId: string | null, therapistId: string): Promise<void> {
  if (!logId) return;
  try {
    await apiPatch(`/search/log/${logId}/click`, { therapist_id: therapistId });
  } catch {
    // 静默
  }
}

// ──────────────────── 热门词 + 类目拉取 ────────────────────

export interface HotKeyword {
  id: string;
  keyword: string;
  label: string;
}

export interface SearchCategory {
  id: string;
  code: string;
  emoji: string | null;
  label: string;
  filter_condition: Record<string, unknown> | null;
}

export interface HotKeywordsResponse {
  hot_keywords: HotKeyword[];
  categories: SearchCategory[];
}

/** 拉热门词 + 类目 · 失败返 null(组件用本地 fallback) */
export async function fetchHotKeywords(params?: {
  locale?: string;
  city?: string;
}): Promise<HotKeywordsResponse | null> {
  try {
    return await apiGet<HotKeywordsResponse>('/search/hot-keywords', {
      locale: params?.locale,
      city: params?.city,
    });
  } catch {
    return null;
  }
}
