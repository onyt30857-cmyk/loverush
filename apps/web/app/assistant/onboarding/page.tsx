/**
 * v4 砍 9 步 onboarding (2026-06-01 Tony 决策 · [[loverush_m03_audit_2026_06_01]])
 *
 * 真数据:alpha 阶段 2 用户走完 9 步 · 0 单转化 · 9 步 onboarding 收集的字段
 * recommender 真用 ≤ 4 项 · 大半字段是死代码。整流程改 redirect 直接进 home。
 *
 * 入口保留 (URL 仍可访问) · 但立刻完成 + redirect /assistant · 不再卡用户。
 * 用户量 > 500 后 (见 [[loverush_m03_audit_2026_06_01]] trigger) 再考虑恢复轻量 onboarding。
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const ONBOARDING_DONE_KEY = 'assistant_onboarding_done_v1';

export default function AssistantOnboardingPage() {
  const router = useRouter();
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(ONBOARDING_DONE_KEY, '1');
      } catch {
        // localStorage quota/disabled · 静默 · 进 home 仍能展示
      }
    }
    router.replace('/assistant');
  }, [router]);
  return null;
}
