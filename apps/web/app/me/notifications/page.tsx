'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState, ErrorBanner, LoadingFull } from '@/components/ui';
import { apiGet, apiPost, apiPut, ApiClientError } from '@/lib/api';
import { subscribePush, unsubscribePush } from '@/lib/pwa';

interface Notif {
  id: string;
  title: string;
  body: string | null;
  category: string;
  level: string;
  readAt: string | null;
  createdAt: string;
  deepLink: string | null;
}

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

export default function NotificationsPage() {
  const [list, setList] = useState<Notif[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'list' | 'prefs'>('list');

  async function load() {
    const [n, p] = await Promise.all([
      apiGet<Notif[]>('/notifications', { limit: 30 }).catch(() => []), // 失败退出 loading，进入空状态
      apiGet<Prefs | null>('/notifications/preferences').catch(() => null),
    ]);
    setList(n);
    if (p) setPrefs(p);
  }

  useEffect(() => {
    void load();
  }, []);

  async function readAll() {
    try {
      await apiPost('/notifications/read-all');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

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

  if (!list) return <AppShell title="通知" showBack hideTabBar><LoadingFull /></AppShell>;

  return (
    <AppShell title="通知" showBack hideTabBar>
      <div className="sticky top-12 z-10 grid grid-cols-2 border-b border-ink-100 bg-white">
        {(['list', 'prefs'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`py-2.5 text-sm ${tab === k ? 'border-b-2 border-primary font-medium text-primary' : 'text-ink-500'}`}
          >
            {k === 'list' ? '通知' : '设置'}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} />

      {tab === 'list' &&
        (list.length === 0 ? (
          /*
            M2 修复 · §8 空态四件套
            图标 + 主文 + 辅助文 + 次级动作("通知偏好 →")
            点动作 = 切到 prefs tab,不离开页(避免死巷)
          */
          <EmptyState
            title="还没有通知"
            hint="订单 / 私聊 / 派单 / 提现进度会通过这里告诉你"
            icon="🔕"
            action={
              <button
                type="button"
                onClick={() => setTab('prefs')}
                className="rounded-full bg-warm-50 px-4 py-1.5 text-[12px] font-medium text-ink-700 transition active:scale-95"
              >
                通知偏好 →
              </button>
            }
          />
        ) : (
          <>
            <div className="px-5 py-3">
              <button type="button" onClick={() => void readAll()} className="text-xs text-primary">
                全部标已读
              </button>
            </div>
            <ul className="space-y-2 px-5 pb-6">
              {list.map((n) => (
                <li
                  key={n.id}
                  className={`rounded-2xl border p-3 ${n.readAt ? 'border-ink-100 bg-white' : 'border-primary/30 bg-primary/5'}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="text-sm font-medium">{n.title}</div>
                    <span className="text-[10px] text-ink-300">
                      {new Date(n.createdAt).toLocaleString().slice(5, 16)}
                    </span>
                  </div>
                  {n.body && <div className="mt-1 text-xs text-ink-500">{n.body}</div>}
                </li>
              ))}
            </ul>
          </>
        ))}

      {tab === 'prefs' && prefs && (
        <div className="space-y-1 px-5 py-4">
          <div className="mb-3 flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <div>
              <div className="text-sm font-medium">浏览器推送</div>
              <div className="mt-0.5 text-xs text-ink-500">即使离线也能收到</div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  const r = await subscribePush();
                  if (!r.ok) setError(`订阅失败：${r.reason}`);
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
          {[
            ['chatMsgEnabled', '私聊消息'],
            ['orderStatusEnabled', '订单状态'],
            ['dispatchOfferEnabled', '派单邀请'],
            ['reviewEnabled', '评价回应'],
            ['withdrawEnabled', '提现状态'],
            ['promoEnabled', '活动推广'],
            ['obfuscatePreviews', '模糊化推送内容（仅显示「新消息」）'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center justify-between rounded-xl bg-white px-3 py-3">
              <span className="text-sm">{label}</span>
              <input
                type="checkbox"
                checked={Boolean(prefs[key as keyof Prefs])}
                onChange={(e) => void setPref(key as keyof Prefs, e.target.checked)}
                className="h-5 w-5 accent-primary"
              />
            </label>
          ))}
        </div>
      )}
    </AppShell>
  );
}
