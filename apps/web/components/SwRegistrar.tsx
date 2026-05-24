'use client';

import { useEffect } from 'react';
import { registerSW } from '@/lib/pwa';

/**
 * 挂在 layout 里 · 进入应用即注册 Service Worker
 */
export default function SwRegistrar() {
  useEffect(() => {
    void registerSW();
  }, []);
  return null;
}
