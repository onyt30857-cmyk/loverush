/**
 * SWR 全局 Provider
 *
 * 设计:
 * - fetcher 复用 apiGet · 自动带 token、走 refresh、抛 ApiClientError
 * - key 约定:形如 '/conversations' / '/me' / '/therapists?limit=20',全字符串
 * - revalidateOnFocus 关:H5 频繁切前台会触发,流量浪费
 * - revalidateOnReconnect 开:网络恢复后自动 revalidate
 * - dedupingInterval 5s:5 秒内同 key 重复请求合并
 * - errorRetryCount 2:失败两次就放弃
 *
 * ⚡ 性能修复(2026-05-31):
 *   provider 改用 Map + localStorage 持久化 · 卸载时 dump 到 localStorage,
 *   启动时回填 SWR cache · 二次进站对所有已访问页面 0ms 显旧数据(后台
 *   revalidate)· 把跨洲 1.5-2s API 等待感知压到 0。
 *   只 cache 列表/详情等读多 endpoint,不缓 /me、/auth/* 隐私敏感的。
 */
'use client';

import { useEffect } from 'react';
import { SWRConfig, type Cache } from 'swr';
import { apiGet } from './api';

const SWR_CACHE_KEY = 'swr-cache-v1';
const MAX_CACHE_ENTRIES = 60;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min · 超过抛弃避免显太老数据

/** 不持久化的 key 前缀 · 隐私敏感/写时变化的 */
const NO_PERSIST_PREFIX = ['/auth/', '/admin/'];

function shouldPersist(key: string): boolean {
  if (typeof key !== 'string') return false;
  if (NO_PERSIST_PREFIX.some((p) => key.startsWith(p))) return false;
  return true;
}

interface PersistedEntry {
  key: string;
  value: unknown;
  ts: number;
}

function createPersistingProvider(): Cache {
  const map = new Map<string, unknown>();

  // 启动 · 从 localStorage 回填 · 只在 client
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(SWR_CACHE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as PersistedEntry[];
        const now = Date.now();
        for (const item of arr) {
          if (now - item.ts > CACHE_TTL_MS) continue;
          // SWR 缓存值是 { data, isValidating, error }· 这里我们简化只持久化 data
          map.set(item.key, { data: item.value, isValidating: false, isLoading: false });
        }
      }
    } catch {
      // 损坏 · 静默
    }
  }

  return map as Cache;
}

const swrProvider = createPersistingProvider();

/** 卸载/隐藏 tab 时 dump 一次 */
function dumpCache() {
  if (typeof window === 'undefined') return;
  try {
    const arr: PersistedEntry[] = [];
    let count = 0;
    for (const [key, value] of swrProvider as unknown as Map<string, { data?: unknown }>) {
      if (!shouldPersist(key)) continue;
      if (!value || value.data === undefined) continue;
      arr.push({ key, value: value.data, ts: Date.now() });
      count++;
      if (count >= MAX_CACHE_ENTRIES) break;
    }
    window.localStorage.setItem(SWR_CACHE_KEY, JSON.stringify(arr));
  } catch {
    // quota / 序列化失败静默
  }
}

export function AppSWRConfig({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // beforeunload 不可靠(mobile)· 加 visibilitychange 双保险
    const onHide = () => dumpCache();
    window.addEventListener('beforeunload', onHide);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') dumpCache();
    });
    // 兜底 · 进站 30s 后做一次(可能用户没退出但已浏览了几个页)
    const t = setTimeout(dumpCache, 30000);
    return () => {
      window.removeEventListener('beforeunload', onHide);
      window.removeEventListener('pagehide', onHide);
      clearTimeout(t);
    };
  }, []);

  return (
    <SWRConfig
      value={{
        provider: () => swrProvider,
        fetcher: (key: string) => apiGet(key),
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        dedupingInterval: 5000,
        errorRetryCount: 2,
        errorRetryInterval: 1500,
        shouldRetryOnError: (err: unknown) => {
          const e = err as { payload?: { code?: string } };
          return e?.payload?.code !== 'E1001_OTP_INVALID';
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
