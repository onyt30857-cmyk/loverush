'use client';

import { useEffect } from 'react';
import { captureClientError } from '@/lib/sentry';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void captureClientError(error, { digest: error.digest });
  }, [error]);

  return (
    <html lang="zh">
      <body className="flex min-h-screen flex-col items-center justify-center bg-ink-50 p-6 text-center">
        <div className="text-5xl">😢</div>
        <h1 className="mt-4 text-base font-semibold">应用出错了</h1>
        <p className="mt-1 text-xs text-ink-500">
          我们已经记下了这个问题。{error.digest && <span>编号 {error.digest}</span>}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex h-10 items-center rounded-2xl bg-primary px-6 text-sm font-medium text-white"
        >
          重试
        </button>
      </body>
    </html>
  );
}
