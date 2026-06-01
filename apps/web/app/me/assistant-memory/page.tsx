/**
 * /me/assistant-memory 记忆管理 · v5 砍 (2026-06-02 [[loverush_m03_audit_2026_06_01]])
 *
 * v3 L1+L2 记忆 CRUD 页 → v5 砍 · 历史在 VoiceAssistantSheet 内能看
 * 用户量 > 500 触发恢复时再做记忆管理入口
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AssistantMemoryPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/me');
  }, [router]);
  return null;
}
