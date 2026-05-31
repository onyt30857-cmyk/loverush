'use client';

/**
 * Admin · 节目监控 · M02b/M04 Phase 1
 *
 * 列所有节目(全状态) + admin 强制下架(写 audit log)
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface ShowRow {
  id: string;
  therapist_user_id: string;
  category_code: string;
  category_name_zh: string | null;
  start_time: string;
  duration_min: number;
  price_points: number;
  slots_total: number;
  slots_remaining: number;
  status: 'draft' | 'open' | 'closed' | 'completed';
  service_city: string | null;
  therapist_display_name: string | null;
  therapist_avatar_url: string | null;
  created_at: string;
}

type StatusFilter = 'all' | 'draft' | 'open' | 'closed' | 'completed';

export default function AdminShowsPage() {
  const [rows, setRows] = useState<ShowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ShowRow[]>('/admin/shows', {
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 100,
      });
      setRows(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [statusFilter]);

  async function handleForceClose(s: ShowRow) {
    const reason = window.prompt(`强制下架 "${s.therapist_display_name} · ${s.category_name_zh}" 的节目?\n\n请输入原因(必填 · 写入 audit log):`);
    if (!reason || reason.trim().length < 3) return;
    try {
      await api.post(`/admin/shows/${s.id}/force-close`, { reason: reason.trim() });
      await load();
    } catch (err) {
      alert(err instanceof ApiClientError ? err.payload.message : String(err));
    }
  }

  const stats = {
    total: rows.length,
    open: rows.filter((s) => s.status === 'open').length,
    draft: rows.filter((s) => s.status === 'draft').length,
    closed: rows.filter((s) => s.status === 'closed').length,
  };

  return (
    <AdminShell>
      <div className="p-6 max-w-7xl mx-auto">
        <h1 className="text-xl font-bold mb-2">节目监控</h1>
        <div className="text-sm text-gray-600 mb-4">
          所有技师发布的节目 · admin 可强制下架违规节目 · 操作写 audit log
        </div>

        {/* 统计 */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <Stat label="总数" value={stats.total} />
          <Stat label="开放中" value={stats.open} color="text-green-700" />
          <Stat label="草稿" value={stats.draft} color="text-gray-700" />
          <Stat label="已下架" value={stats.closed} color="text-yellow-700" />
        </div>

        {/* 筛选 */}
        <div className="flex gap-2 mb-3">
          {(['all', 'open', 'draft', 'closed', 'completed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1 rounded text-sm ${
                statusFilter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {f === 'all' ? '全部' : f === 'open' ? '开放中' : f === 'draft' ? '草稿' : f === 'closed' ? '已下架' : '已结束'}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-3 text-sm">
            {error}
          </div>
        )}

        <div className="bg-white border rounded-lg overflow-hidden">
          {loading && <div className="p-4 text-center text-gray-400 text-sm">加载中…</div>}
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2">技师 / 类型</th>
                <th className="text-left px-3 py-2">时段</th>
                <th className="text-center px-3 py-2">价格</th>
                <th className="text-center px-3 py-2">名额</th>
                <th className="text-left px-3 py-2">城市</th>
                <th className="text-center px-3 py-2">状态</th>
                <th className="text-right px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {s.therapist_avatar_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.therapist_avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                      )}
                      <div>
                        <div className="font-medium">{s.therapist_display_name ?? '(无名)'}</div>
                        <div className="text-xs text-gray-500">{s.category_name_zh ?? s.category_code}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-xs text-gray-700">
                    {new Date(s.start_time).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    <div className="text-gray-400">{s.duration_min}分钟</div>
                  </td>
                  <td className="text-center font-semibold">{s.price_points}</td>
                  <td className="text-center">{s.slots_remaining}/{s.slots_total}</td>
                  <td className="text-xs text-gray-600">{s.service_city ?? '—'}</td>
                  <td className="text-center">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="text-right">
                    {(s.status === 'open' || s.status === 'draft') && (
                      <button
                        onClick={() => void handleForceClose(s)}
                        className="text-red-600 hover:underline text-xs"
                      >
                        强制下架
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr><td colSpan={7} className="text-center text-gray-400 py-8">没有节目</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}

function Stat({ label, value, color = '' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white border rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    draft: { label: '草稿', cls: 'bg-gray-200 text-gray-700' },
    open: { label: '开放中', cls: 'bg-green-100 text-green-700' },
    closed: { label: '已下架', cls: 'bg-yellow-100 text-yellow-700' },
    completed: { label: '已结束', cls: 'bg-gray-100 text-gray-500' },
  };
  const c = cfg[status] ?? cfg.draft!;
  return <span className={`px-2 py-0.5 rounded text-xs ${c.cls}`}>{c.label}</span>;
}
