'use client';

/**
 * 客户助理画像 · 看 AI 助理在客户侧的健康度
 *
 * 数据源:
 *   - customer_behavior_profile · 行为模式(stable/exploratory/mixed)
 *   - customer_assistant_profile · 配置(tone/warmth/记忆窗口/学习)
 *   - customer_session_preferences · 近期 session 活跃
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface Overview {
  by_mode: Array<{
    behavior_mode: string;
    total: number;
    avg_confidence: number;
    avg_orders: number;
    avg_repeat_rate: number;
    heavy_users: number;
    no_orders: number;
  }>;
  profile_stats: {
    total_profiles: number;
    greeting_on: number;
    learning_on: number;
    avg_memory_days: number;
  };
  active_users_30d: number;
  generated_at: string;
}

const MODE_LABEL: Record<string, { label: string; desc: string; color: string }> = {
  stable: { label: '稳定型', desc: '回购老技师 · 忠诚度高', color: 'bg-green-500' },
  exploratory: { label: '探索型', desc: '尝试新技师 · 流量价值高', color: 'bg-blue-500' },
  mixed: { label: '混合型', desc: '平衡偏好', color: 'bg-amber-500' },
};

export default function AssistantProfilesPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookupId, setLookupId] = useState('');
  const [detail, setDetail] = useState<unknown>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Overview>('/admin/ai/assistant-profiles/overview')
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiClientError) setError(err.payload.message);
      });
  }, []);

  async function lookup() {
    setDetail(null);
    setDetailErr(null);
    if (!lookupId.trim()) return;
    try {
      const d = await api.get(`/admin/ai/assistant-profiles/${lookupId.trim()}`);
      setDetail(d);
    } catch (err) {
      if (err instanceof ApiClientError) setDetailErr(err.payload.message);
      else setDetailErr(String(err));
    }
  }

  if (error) {
    return (
      <AdminShell>
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">客户助理画像</h1>
        <p className="mt-1 text-xs text-ink-500">
          客户 AI 助理(M03)· 行为模式 + 配置 + 长期记忆
        </p>
      </div>

      {!data ? (
        <div className="text-sm text-ink-500">加载中…</div>
      ) : (
        <>
          {/* 总体 KPI */}
          <section className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi label="助理档案总数" value={data.profile_stats.total_profiles} />
            <Kpi label="近 30d 活跃" value={data.active_users_30d} accent />
            <Kpi
              label="主动问候开启"
              value={data.profile_stats.greeting_on}
              sub={
                data.profile_stats.total_profiles > 0
                  ? `${Math.round(
                      (data.profile_stats.greeting_on * 100) / data.profile_stats.total_profiles,
                    )}% 客户开启`
                  : undefined
              }
            />
            <Kpi
              label="学习偏好开启"
              value={data.profile_stats.learning_on}
              sub={
                data.profile_stats.total_profiles > 0
                  ? `${Math.round(
                      (data.profile_stats.learning_on * 100) / data.profile_stats.total_profiles,
                    )}% 客户开启`
                  : undefined
              }
            />
          </section>

          {/* 行为模式分布 */}
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold text-ink-700">行为模式分布(behavior_mode)</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {data.by_mode.length === 0 ? (
                <div className="card col-span-3 py-8 text-center text-sm text-ink-500">
                  暂无客户画像数据
                </div>
              ) : (
                data.by_mode.map((m) => {
                  const meta = MODE_LABEL[m.behavior_mode] ?? {
                    label: m.behavior_mode,
                    desc: '',
                    color: 'bg-ink-400',
                  };
                  return (
                    <div key={m.behavior_mode} className="card">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-semibold">{meta.label}</span>
                        <span className="font-mono text-xl">{m.total.toLocaleString()}</span>
                      </div>
                      <div className="mb-3 text-xs text-ink-500">{meta.desc}</div>
                      <div className="mb-2 h-2 overflow-hidden rounded-full bg-ink-100">
                        <div className={`h-full ${meta.color}`} style={{ width: `${m.avg_confidence}%` }} />
                      </div>
                      <div className="text-xs text-ink-500">
                        平均信心 {m.avg_confidence}% · 均订单 {m.avg_orders} · 复购率 {m.avg_repeat_rate}%
                      </div>
                      <div className="mt-2 flex justify-between border-t border-ink-100 pt-2 text-xs">
                        <span className="text-ink-500">重度用户(≥3 单)</span>
                        <span className="font-mono font-semibold text-green-700">{m.heavy_users}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-ink-500">零订单</span>
                        <span className="font-mono text-ink-700">{m.no_orders}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* 单客户查询 */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink-700">
              单客户画像查询
              <span className="ml-2 text-xs font-normal text-ink-400">输入 customer_id(UUID)看完整画像</span>
            </h2>
            <div className="card mb-3">
              <div className="flex gap-2">
                <input
                  className="input flex-1 font-mono text-xs"
                  placeholder="customer_id (UUID)"
                  value={lookupId}
                  onChange={(e) => setLookupId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void lookup()}
                />
                <button type="button" onClick={() => void lookup()} className="btn-primary">
                  查询
                </button>
              </div>
              {detailErr && <div className="mt-2 text-xs text-rose-600">{detailErr}</div>}
            </div>

            {detail !== null && (
              <div className="card">
                <pre className="overflow-x-auto text-xs">{JSON.stringify(detail, null, 2)}</pre>
              </div>
            )}
          </section>
        </>
      )}
    </AdminShell>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={`card ${accent ? 'bg-gradient-to-br from-rose-50 to-white' : ''}`}>
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ? 'text-rose-700' : 'text-ink-900'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}
