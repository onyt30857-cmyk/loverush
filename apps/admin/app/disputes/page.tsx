'use client';

/**
 * Admin · 心动金仲裁 · 0027
 *
 * 列出所有 deposit_status='HOLDING' 的订单 · 按下单时间倒序
 * 三个仲裁动作:
 *   - [全退客户](release):等同自动完单 · 客户 frozen 回 balance
 *   - [客户鸽子](forfeit):50/50 分账 · 技师拿一半 · 平台拿一半
 *   - [技师鸽子](refund):全退客户 · 技师不降信用(admin 主裁不连带降分)
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface DisputeRow {
  depositId: string;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  depositPoints: number;
  customerId: string;
  customerName: string | null;
  therapistUserId: string;
  therapistName: string | null;
  currencyCode: string | null;
  totalFiat: string | null;
  scheduledAt: string | null;
  createdAt: string;
}

type Resolution = 'release' | 'forfeit' | 'refund';

const RESOLUTION_LABEL: Record<Resolution, { label: string; desc: string; btnClass: string }> = {
  release: {
    label: '全退客户(无责)',
    desc: '等同自动完单 · 心动金回客户余额 · 技师/平台不分账',
    btnClass: 'bg-green-600 hover:bg-green-700',
  },
  forfeit: {
    label: '判客户鸽子',
    desc: '50% 给技师 + 50% 给平台 · 客户损失心动金',
    btnClass: 'bg-orange-600 hover:bg-orange-700',
  },
  refund: {
    label: '判技师鸽子(admin 仲裁)',
    desc: '全退客户 · admin 主裁不连带降分 · 如要降分走 therapist-no-show',
    btnClass: 'bg-red-600 hover:bg-red-700',
  },
};

export default function DisputesPage() {
  const [list, setList] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<DisputeRow | null>(null);
  const [resolution, setResolution] = useState<Resolution>('release');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<DisputeRow[]>('/admin/disputes', { limit: 100 });
      setList(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function open(row: DisputeRow) {
    setPicked(row);
    setResolution('release');
    setNote('');
  }

  async function resolve() {
    if (!picked) return;
    if (!note.trim()) {
      setError('请填仲裁说明(双方可见)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/disputes/${picked.depositId}/resolve`, {
        resolution,
        note: note.trim(),
      });
      setPicked(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // 时段已过 N 小时
  function hoursSinceScheduled(scheduledAt: string | null): number | null {
    if (!scheduledAt) return null;
    const ms = Date.now() - new Date(scheduledAt).getTime();
    return Math.floor(ms / 3_600_000);
  }

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">心动金仲裁</h1>
          <p className="text-sm text-ink-500 mt-1">
            所有 HOLDING 中的心动金 · 重点关注时段已过 24h 未流转的(需 admin 主动裁决)
          </p>
        </div>
        <button onClick={() => void load()} className="btn-ghost text-xs">刷新</button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-ink-500">加载中…</div>
      ) : list.length === 0 ? (
        <div className="card text-center py-12 text-ink-500">
          <div className="text-3xl mb-2">✅</div>
          没有待仲裁的心动金
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>订单号</th>
                <th>客户</th>
                <th>技师</th>
                <th>订单状态</th>
                <th>线下应付</th>
                <th>心动金</th>
                <th>时段</th>
                <th>下单时间</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const hours = hoursSinceScheduled(r.scheduledAt);
                const overdue = hours != null && hours > 24;
                return (
                  <tr key={r.depositId} className={overdue ? 'bg-amber-50/50' : ''}>
                    <td className="font-mono text-xs">{r.orderNo}</td>
                    <td className="text-xs">{r.customerName ?? '—'}</td>
                    <td className="text-xs">{r.therapistName ?? '—'}</td>
                    <td className="text-xs">{r.orderStatus}</td>
                    <td className="text-xs">
                      {r.currencyCode ? `${r.currencyCode} ${r.totalFiat ?? '—'}` : '—'}
                    </td>
                    <td className="text-xs font-medium">{r.depositPoints.toLocaleString()} 积分</td>
                    <td className="text-xs">
                      {r.scheduledAt ? (
                        <div>
                          <div>{new Date(r.scheduledAt).toLocaleString('zh-CN', { hour12: false })}</div>
                          {hours != null && (
                            <div className={`text-[10px] ${overdue ? 'text-amber-600 font-medium' : 'text-ink-400'}`}>
                              {hours >= 0 ? `已过 ${hours}h` : `${-hours}h 后`}
                            </div>
                          )}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-xs">{new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => open(r)}
                        className="btn-primary h-7 px-3 text-xs"
                      >
                        仲裁
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {picked && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={() => setPicked(null)}>
          <div className="bg-white rounded-lg p-6 w-full max-w-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-2">仲裁心动金 · {picked.orderNo}</h2>
            <div className="mb-4 grid grid-cols-2 gap-2 text-xs text-ink-600">
              <div>客户:{picked.customerName ?? '—'}</div>
              <div>技师:{picked.therapistName ?? '—'}</div>
              <div>心动金:<strong>{picked.depositPoints.toLocaleString()} 积分</strong></div>
              <div>线下应付:{picked.currencyCode ? `${picked.currencyCode} ${picked.totalFiat}` : '—'}</div>
            </div>

            <div className="mb-3 text-sm font-semibold">选择裁决</div>
            <div className="space-y-2 mb-4">
              {(Object.entries(RESOLUTION_LABEL) as Array<[Resolution, typeof RESOLUTION_LABEL.release]>).map(([key, info]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setResolution(key)}
                  className={`w-full text-left rounded-lg border px-3 py-2 transition ${
                    resolution === key ? 'border-primary bg-primary/5' : 'border-ink-200 hover:border-ink-300'
                  }`}
                >
                  <div className="text-sm font-medium">{info.label}</div>
                  <div className="text-xs text-ink-500 mt-0.5">{info.desc}</div>
                </button>
              ))}
            </div>

            <label className="block text-xs text-ink-600 mb-1">仲裁说明(必填 · 进 audit log)</label>
            <textarea
              className="w-full h-20 rounded-lg border border-ink-200 p-2 text-sm mb-4"
              placeholder="例:客户提供拍照证据未匹配描述 · 退一半"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            <div className="flex justify-end gap-2">
              <button onClick={() => setPicked(null)} className="px-4 py-1.5 rounded text-sm border">取消</button>
              <button
                onClick={() => void resolve()}
                disabled={busy || !note.trim()}
                className={`text-white px-4 py-1.5 rounded text-sm disabled:opacity-50 ${RESOLUTION_LABEL[resolution].btnClass}`}
              >
                {busy ? '裁决中…' : `确认 · ${RESOLUTION_LABEL[resolution].label}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
