'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface OrderRow {
  id: string;
  orderNo: string;
  customerId: string;
  customerName: string | null;
  therapistUserId: string;
  therapistName: string | null;
  status: string;
  pricePoints: number;
  durationMin: number;
  disputeOpenedAt: string | null;
  disputeReason: string | null;
  refundPoints: number | null;
  createdAt: string;
}

const STATUS_OPTIONS = [
  'DRAFT',
  'PENDING_CONFIRM',
  'LOCKED',
  'PAID',
  'IN_SERVICE',
  'COMPLETED',
  'REVIEWED',
  'CANCELLED',
  'DISPUTED',
  'REFUNDED',
  'CLOSED',
] as const;

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  PENDING_CONFIRM: '待技师确认',
  LOCKED: '已锁价待付',
  PAID: '已支付',
  IN_SERVICE: '服务中',
  COMPLETED: '已完成',
  REVIEWED: '已评价',
  CANCELLED: '已取消',
  DISPUTED: '争议中',
  REFUNDED: '已退款',
  CLOSED: '已关闭',
};

const STATUS_COLOR: Record<string, string> = {
  DISPUTED: 'bg-red-100 text-red-700',
  REFUNDED: 'bg-orange-100 text-orange-700',
  CANCELLED: 'bg-ink-100 text-ink-600',
  CLOSED: 'bg-ink-100 text-ink-500',
  COMPLETED: 'bg-green-100 text-green-700',
  REVIEWED: 'bg-green-100 text-green-700',
  PAID: 'bg-blue-100 text-blue-700',
  IN_SERVICE: 'bg-blue-100 text-blue-700',
};

interface OrderDetail extends OrderRow {
  serviceSkills: string[];
  paidAt: string | null;
  completedAt: string | null;
}

export default function OrdersPage() {
  const [list, setList] = useState<OrderRow[]>([]);
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState<'refund_full' | 'refund_partial' | 'reject'>('refund_full');
  const [refundPoints, setRefundPoints] = useState('');
  const [resolveNote, setResolveNote] = useState('');
  const [disputedOnly, setDisputedOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await api.get<OrderRow[]>('/admin/orders', {
        status: disputedOnly ? 'DISPUTED' : status || undefined,
        search: search || undefined,
        limit: 100,
      });
      setList(rows);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }, [status, search, disputedOnly]);

  useEffect(() => {
    void load();
  }, [status, disputedOnly, load]);

  async function openDetail(id: string) {
    try {
      const d = await api.get<OrderDetail>(`/admin/orders/${id}`);
      setDetail(d);
      setResolution('refund_full');
      setRefundPoints('');
      setResolveNote('');
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  async function resolve() {
    if (!detail) return;
    if (!resolveNote.trim()) return;
    setResolving(true);
    try {
      const body: Record<string, unknown> = { resolution, note: resolveNote.trim() };
      if (resolution === 'refund_partial') {
        const n = parseInt(refundPoints, 10);
        if (!Number.isFinite(n) || n <= 0) {
          setError('部分退款需填积分数');
          setResolving(false);
          return;
        }
        body.refund_points = n;
      }
      await api.post(`/admin/orders/${detail.id}/resolve`, body);
      setDetail(null);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setResolving(false);
    }
  }

  const disputedCount = list.filter((o) => o.status === 'DISPUTED').length;

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">订单管理</h1>
        <div className="text-sm text-ink-500">
          共 {list.length} 单
          {disputedCount > 0 && (
            <span className="ml-3 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">争议 {disputedCount}</span>
          )}
        </div>
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={disputedOnly}
              onChange={(e) => setDisputedOnly(e.target.checked)}
            />
            <span className="text-red-600">仅看争议中</span>
          </label>
          <select
            className="input w-44"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={disputedOnly}
          >
            <option value="">所有状态</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]} ({s})
              </option>
            ))}
          </select>
          <input
            className="input flex-1"
            placeholder="按订单号搜索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
          />
          <button type="button" onClick={() => void load()} className="btn-primary">
            搜索
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>订单号</th>
              <th>客户</th>
              <th>技师</th>
              <th>状态</th>
              <th>金额</th>
              <th>时长</th>
              <th>创建时间</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-ink-500">
                  没有符合条件的订单
                </td>
              </tr>
            )}
            {list.map((o) => (
              <tr key={o.id} className={o.status === 'DISPUTED' ? 'bg-red-50/50' : ''}>
                <td className="font-mono text-xs">{o.orderNo}</td>
                <td className="text-xs">{o.customerName ?? '—'}</td>
                <td className="text-xs">{o.therapistName ?? '—'}</td>
                <td>
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLOR[o.status] ?? 'bg-ink-100 text-ink-700'}`}>
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                </td>
                <td className="text-xs">{o.pricePoints.toLocaleString()} 积分</td>
                <td className="text-xs">{o.durationMin} min</td>
                <td className="text-xs">{new Date(o.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => void openDetail(o.id)}
                    className="btn-ghost h-7 px-3 text-xs"
                  >
                    详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="card w-full max-w-2xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">订单 {detail.orderNo}</h3>
                <div className="mt-1 text-xs font-mono text-ink-500">{detail.id}</div>
              </div>
              <span className={`rounded px-2.5 py-1 text-xs ${STATUS_COLOR[detail.status] ?? 'bg-ink-100'}`}>
                {STATUS_LABEL[detail.status] ?? detail.status}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="客户" value={detail.customerName ?? '—'} sub={detail.customerId.slice(0, 12) + '…'} />
              <Info label="技师" value={detail.therapistName ?? '—'} sub={detail.therapistUserId.slice(0, 12) + '…'} />
              <Info label="金额" value={`${detail.pricePoints.toLocaleString()} 积分`} />
              <Info label="时长" value={`${detail.durationMin} 分钟`} />
              <Info label="服务" value={detail.serviceSkills.join(' · ') || '—'} />
              <Info label="创建" value={new Date(detail.createdAt).toLocaleString('zh-CN', { hour12: false })} />
              {detail.paidAt && <Info label="支付" value={new Date(detail.paidAt).toLocaleString('zh-CN', { hour12: false })} />}
              {detail.completedAt && <Info label="完成" value={new Date(detail.completedAt).toLocaleString('zh-CN', { hour12: false })} />}
              {detail.refundPoints && <Info label="已退款" value={`${detail.refundPoints.toLocaleString()} 积分`} />}
            </div>

            {detail.status === 'DISPUTED' && (
              <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
                <div className="mb-2 text-sm font-semibold text-red-800">争议详情</div>
                <div className="mb-3 text-sm text-red-700">
                  开启时间:{detail.disputeOpenedAt ? new Date(detail.disputeOpenedAt).toLocaleString('zh-CN') : '—'}
                  <br />
                  原因:{detail.disputeReason ?? '—'}
                </div>

                <div className="mb-2 text-sm font-semibold">仲裁裁决</div>
                <div className="mb-2 grid grid-cols-3 gap-2">
                  {(['refund_full', 'refund_partial', 'reject'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setResolution(r)}
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        resolution === r ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-ink-200 bg-white'
                      }`}
                    >
                      {r === 'refund_full' ? '全额退款' : r === 'refund_partial' ? '部分退款' : '驳回'}
                    </button>
                  ))}
                </div>
                {resolution === 'refund_partial' && (
                  <input
                    type="number"
                    className="input mb-2 w-full"
                    placeholder={`退款积分(订单 ${detail.pricePoints.toLocaleString()})`}
                    value={refundPoints}
                    onChange={(e) => setRefundPoints(e.target.value)}
                  />
                )}
                <textarea
                  className="mb-3 h-20 w-full rounded-lg border border-ink-200 p-3 text-sm"
                  placeholder="仲裁说明(双方可见)"
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => void resolve()}
                  disabled={resolving || !resolveNote.trim()}
                  className={resolution === 'reject' ? 'btn-danger w-full' : 'btn-primary w-full'}
                >
                  确认裁决
                </button>
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setDetail(null)} className="btn-ghost">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function Info({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-ink-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-ink-900">{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[10px] text-ink-400">{sub}</div>}
    </div>
  );
}
