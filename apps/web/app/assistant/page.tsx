/**
 * /assistant home · v5 砍 (2026-06-02 [[loverush_m03_audit_2026_06_01]])
 *
 * v3 6 区块 home / v4 2 区块 home / v5 整页删除 → redirect /home
 *
 * 新交互: 底部 BottomNav 中央"助理"按钮 → 弹 VoiceAssistantSheet (语音输入)
 *   不再有 home dashboard 概念 · 路由保留只为兼容老链接
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AssistantPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/home');
  }, [router]);
  return null;
}
