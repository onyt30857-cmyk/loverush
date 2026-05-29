/**
 * Admin · 群发详情 · M13 Phase 0
 *
 * 显示批次完整信息 + 投递统计 + 样本明细
 */
'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface DeliverySample {
  id: string;
  recipientUserId: string;
  notificationId: string | null;
  status: 'sent' | 'skipped' | 'failed';
  skipReason: string | null;
  createdAt: string;
}

interface BroadcastDetail {
  id: string;
  name: string;
  title: string;
  body: string | null;
  level: string;
  category: string;
  deepLink: string | null;
  audienceRule: Record<string, unknown>;
  audienceCount: number;
  channels: string[];
  bypassUserPrefs: number;
  status: 'draft' | 'sending' | 'completed' | 'failed';
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  stats: { sent?: number; skipped?: number; failed?: number };
  samples: DeliverySample[];
}

export default function BroadcastDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<BroadcastDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await api.get<BroadcastDetail>(`/admin/broadcasts/${id}`));
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
    // 如果正在发送中,2 秒轮询直到完成
    const t = setInterval(() => {
      if (data?.status === 'sending' || data?.status === 'draft') void load();
    }, 2_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!data) {
    return (
      <AdminShell>
        {error ? (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        ) : (
          <div className="text-ink-500">加载中…</div>
        )}
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">📣 {data.name}</h1>
        <Link href="/broadcasts" className="btn-ghost">
          ← 返回列表
        </Link>
      </div>

      {data.status === 'failed' && data.errorMessage && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          异常: {data.errorMessage}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* 左:基本信息 */}
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">基础信息</h2>
          <dl className="space-y-2 text-sm">
            <Row k="状态" v={`${data.status} ${data.bypassUserPrefs === 1 ? '· ⚠️ 穿透偏好' : ''}`} />
            <Row k="分级 / 类别" v={`${data.level} / ${data.category}`} />
            <Row k="标题" v={data.title} />
            <Row k="正文" v={data.body ?? '—'} />
            <Row k="深链" v={data.deepLink ?? '—'} />
            <Row k="渠道" v={data.channels.join(', ')} />
            <Row k="创建" v={new Date(data.createdAt).toLocaleString()} />
            <Row k="开始" v={data.startedAt ? new Date(data.startedAt).toLocaleString() : '—'} />
            <Row k="完成" v={data.completedAt ? new Date(data.completedAt).toLocaleString() : '—'} />
          </dl>
        </section>

        {/* 右:统计 + 受众规则 */}
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">投递统计</h2>
          <div className="mb-4 grid grid-cols-3 gap-2 text-center">
            <Stat label="受众数" value={data.audienceCount} />
            <Stat label="已发" value={data.stats.sent ?? data.sentCount} color="text-green-700" />
            <Stat label="跳过" value={data.stats.skipped ?? data.skippedCount} color="text-ink-500" />
            <Stat label="失败" value={data.stats.failed ?? data.failedCount} color="text-red-700" />
            <Stat
              label="送达率"
              value={
                data.audienceCount > 0
                  ? `${(((data.stats.sent ?? data.sentCount) / data.audienceCount) * 100).toFixed(1)}%`
                  : '—'
              }
            />
          </div>
          <h3 className="mb-1 text-sm font-medium">受众规则</h3>
          <pre className="overflow-x-auto rounded-lg bg-ink-50 p-3 text-xs">
{JSON.stringify(data.audienceRule, null, 2)}
          </pre>
        </section>
      </div>

      {data.samples.length > 0 && (
        <section className="card mt-4 p-5">
          <h2 className="mb-3 text-lg font-semibold">投递明细(最近 20 条)</h2>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>状态</th>
                  <th>原因</th>
                  <th>用户 ID</th>
                  <th>通知 ID</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {data.samples.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          s.status === 'sent'
                            ? 'bg-green-100 text-green-700'
                            : s.status === 'skipped'
                              ? 'bg-ink-100 text-ink-700'
                              : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="text-xs">{s.skipReason ?? '—'}</td>
                    <td className="font-mono text-xs">{s.recipientUserId.slice(0, 8)}</td>
                    <td className="font-mono text-xs">{s.notificationId?.slice(0, 8) ?? '—'}</td>
                    <td className="text-xs">{new Date(s.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </AdminShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start gap-4">
      <dt className="w-20 shrink-0 text-xs text-ink-500">{k}</dt>
      <dd className="flex-1 break-words text-sm text-ink-800">{v}</dd>
    </div>
  );
}

function Stat({ label, value, color = 'text-ink-800' }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="rounded-lg bg-ink-50 p-3">
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
