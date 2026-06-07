'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ErrorBanner, LoadingFull } from '@/components/ui';
import { apiGet, apiPut, ApiClientError } from '@/lib/api';
import { subscribePush, unsubscribePush } from '@/lib/pwa';

interface Prefs {
  chatMsgEnabled: number;
  orderStatusEnabled: number;
  dispatchOfferEnabled: number;
  reviewEnabled: number;
  withdrawEnabled: number;
  promoEnabled: number;
  obfuscatePreviews: number;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

// 新用户后端可能返回 null → 给一份默认全开,避免页面卡在 loading
const DEFAULT_PREFS: Prefs = {
  chatMsgEnabled: 1,
  orderStatusEnabled: 1,
  dispatchOfferEnabled: 1,
  reviewEnabled: 1,
  withdrawEnabled: 1,
  promoEnabled: 1,
  obfuscatePreviews: 0,
  quietHoursStart: null,
  quietHoursEnd: null,
};

export default function NotificationSettingsPage() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Prefs | null>('/notifications/preferences')
      .then((p) => setPrefs(p ?? DEFAULT_PREFS))
      .catch(() => setPrefs(DEFAULT_PREFS));
  }, []);

  async function setPref(key: keyof Prefs, value: boolean | string | null) {
    try {
      const body: Record<string, unknown> = {};
      const snakeMap: Record<string, string> = {
        chatMsgEnabled: 'chat_msg_enabled',
        orderStatusEnabled: 'order_status_enabled',
        dispatchOfferEnabled: 'dispatch_offer_enabled',
        reviewEnabled: 'review_enabled',
        withdrawEnabled: 'withdraw_enabled',
        promoEnabled: 'promo_enabled',
        obfuscatePreviews: 'obfuscate_previews',
        quietHoursStart: 'quiet_hours_start',
        quietHoursEnd: 'quiet_hours_end',
      };
      body[snakeMap[key] ?? key] = value;
      const updated = await apiPut<Prefs>('/notifications/preferences', body);
      setPrefs(updated);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  if (!prefs) {
    return (
      <AppShell title="通知设置" showBack hideTabBar>
        <LoadingFull />
      </AppShell>
    );
  }

  return (
    <AppShell title="通知设置" showBack hideTabBar>
      <ErrorBanner message={error} />
      <div className="space-y-1 px-5 py-4">
        <div className="mb-3 flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div>
            <div className="text-sm font-medium">浏览器推送</div>
            <div className="mt-0.5 text-xs text-ink-500">即使离线也能收到</div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  const r = await subscribePush();
                  if (!r.ok) setError(`订阅失败：${r.reason}`);
                })();
              }}
              className="rounded-xl bg-primary px-3 py-1.5 text-xs text-white"
            >
              开启
            </button>
            <button
              type="button"
              onClick={() => void unsubscribePush()}
              className="rounded-xl border border-ink-100 px-3 py-1.5 text-xs"
            >
              关闭
            </button>
          </div>
        </div>
        {(
          [
            ['chatMsgEnabled', '私聊消息'],
            ['orderStatusEnabled', '订单状态'],
            ['dispatchOfferEnabled', '派单邀请'],
            ['reviewEnabled', '评价回应'],
            ['withdrawEnabled', '提现状态'],
            ['promoEnabled', '活动推广'],
            ['obfuscatePreviews', '模糊化推送内容（仅显示「新消息」）'],
          ] as Array<[keyof Prefs, string]>
        ).map(([key, label]) => (
          <label key={key} className="flex items-center justify-between rounded-xl bg-white px-3 py-3">
            <span className="text-sm">{label}</span>
            <input
              type="checkbox"
              checked={Boolean(prefs[key])}
              onChange={(e) => void setPref(key, e.target.checked)}
              className="h-5 w-5 accent-primary"
            />
          </label>
        ))}
      </div>
    </AppShell>
  );
}
