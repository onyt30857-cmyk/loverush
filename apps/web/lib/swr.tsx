/**
 * SWR 全局 Provider
 *
 * 设计:
 * - fetcher 复用 apiGet · 自动带 token、走 refresh、抛 ApiClientError
 * - key 约定:形如 '/conversations' / '/me' / '/therapists?limit=20',全字符串
 *   - SWR 会自动用 key 做缓存键,字符串相等就走缓存
 *   - 不要传函数 key,会让 prefetch / mutate 不便
 * - revalidateOnFocus 关:H5 频繁切前台会触发,流量浪费
 * - revalidateOnReconnect 开:网络恢复后自动 revalidate
 * - dedupingInterval 5s:5 秒内同 key 重复请求合并(切 tab 反复点)
 * - errorRetryCount 2:失败两次就放弃,避开慢网雪崩
 * - 兜底 onError:401/E1001 不在 SWR 层处理(已在 AuthProvider 兜底)
 */
'use client';

import { SWRConfig } from 'swr';
import { apiGet } from './api';

export function AppSWRConfig({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: (key: string) => apiGet(key),
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        dedupingInterval: 5000,
        errorRetryCount: 2,
        errorRetryInterval: 1500,
        // 关键路径不去 retry 401(AuthProvider 已处理 token 续期)
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
