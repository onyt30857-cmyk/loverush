/**
 * /assistant/chat 全屏对话 · v5 砍 (2026-06-02 [[loverush_m03_audit_2026_06_01]])
 *
 * v3 全屏对话页 → v5 砍 · 对话整合进 VoiceAssistantSheet (语音 + 多轮历史)
 * 路由保留 redirect 兼容老链接
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AssistantChatPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/home');
  }, [router]);
  return null;
}
