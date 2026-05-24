'use client';

import { useEffect } from 'react';
import { initBrowserSentry } from '@/lib/sentry';

export default function SentryInit() {
  useEffect(() => {
    void initBrowserSentry();
  }, []);
  return null;
}
