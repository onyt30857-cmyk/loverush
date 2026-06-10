'use client';

/**
 * Admin · 橱窗订单履约
 *
 * 操作:
 *   - 列出橱窗订单(GET /admin/shop/orders?status=)
 *   - 标记发货(POST /admin/shop/orders/:id/ship · 填 tracking_number)
 *   - 标记送达结算(POST /admin/shop/orders/:id/deliver)
 *   - 退款(POST /admin/shop/orders/:id/refund · 二次确认)
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface ShopOrder {
  id: string;
  orderNo: string;
  customerId: string;
  customerName: string | null;
  therapistUserId: string;
  therapistName: string | null;
  shopItemId: string;
  itemTitle: string | null;
  qty: number;
  totalPoints: number;
  commissionBps: number;
  therapistCommissionPoints: number;
  status: 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  commissionStatus: 'PENDING' | 'SETTLED' | 'VOID';
  shippingAddressEncrypted: string | null;
  trackingNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待付款',
  paid: '已付款',
  shipped: '已发货',
  delivered: '已送达',
  cancelled: '已取消',
  refunded: '已退款',
};

// pill 柔和色(对齐 admin 设计:rounded-full + xx-50 底 + xx-700 文字 · 中性态走 ink)
const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-ink-100 text-ink-500',
  paid: 'bg-blue-50 text-blue-700',
  shipped: 'bg-amber-50 text-amber-700',
  delivered: 'bg-green-50 text-green-700',
  cancelled: 'bg-ink-100 text-ink-500',
  refunded: 'bg-orange-50 text-orange-600',
};

const COMMISSION_STATUS_LABEL: Record<string, string> = {
  PENDING: '待结算',
  SETTLED: '已结算',
  VOID: '已作废',
};

const COMMISSION_STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-ink-100 text-ink-500',
  SETTLED: 'bg-green-50 text-green-700',
  VOID: 'bg-red-50 text-red-600',
};

const STATUS_FILTER_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待付款' },
  { value: 'paid', label: '已付款' },
  { value: 'shipped', label: '已发货' },
  { value: 'delivered', label: '已送达' },
  { value: 'cancelled', label: '已取消' },
  { value: 'refunded', label: '已退款' },
];

const INPUT_CLS =
  'w-full rounded-lg border border-ink-100 px-3 py-2 text-sm text-ink-900 transition placeholder:text-ink-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15';

function fmtTime(s: string | null): string {
  return s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function parseAddress(raw: string | null): string {
  if (!raw) return '—';
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return (
      [obj.name, obj.phone, obj.address, obj.city, obj.country]
        .filter(Boolean)
        .join(' · ') || raw
    );
  } catch {
    return raw;
  }
}

export default function ShopOrdersPage() {
  const [list, setList] = useState<ShopOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 发货弹窗状态
  const [shipOrder, setShipOrder] = useState<ShopOrder | null>(null);
  const [trackingInput, setTrackingInput] = useState('');

  // 退款确认弹窗
  const [refundOrder, setRefundOrder] = useState<ShopOrder | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const data = await api.get<ShopOrder[]>('/admin/shop/orders', params);
      setList(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function handleShip() {
    if (!shipOrder || !trackingInput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/shop/orders/${shipOrder.id}/ship`, {
        tracking_number: trackingInput.trim(),
      });
      setShipOrder(null);
      setTrackingInput('');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeliver(order: ShopOrder) {
    if (!confirm(`确认将订单 ${order.orderNo} 标记为已送达并结算佣金？`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/shop/orders/${order.id}/deliver`);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRefund() {
    if (!refundOrder) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/shop/orders/${refundOrder.id}/refund`);
      setRefundOrder(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function statusPill(label: string, color: string) {
    return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{label}</span>;
  }

  function idFallback(id: string) {
    return <span className="font-mono text-xs text-ink-300">{id.slice(0, 8)}…</span>;
  }

  return (
    <AdminShell>
      <div className="mx-auto max-w-7xl p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-ink-900">橱窗订单</h1>
            <p className="mt-1 text-xs text-ink-500">技师橱窗带货订单履约 · 发货 / 送达结算 / 退款</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-ink-100 px-3 py-2 text-sm text-ink-700 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
            >
              {STATUS_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button onClick={() => void load()} className="btn btn-ghost">
              刷新
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
          {loading ? (
            <div className="p-10 text-center text-sm text-ink-500">加载中…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-100 bg-ink-50 text-xs text-ink-500">
                    <th className="whitespace-nowrap px-4 py-3 font-medium">订单号</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">客户</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">技师</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">商品</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">数量</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">积分</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">订单状态</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">佣金状态</th>
                    <th className="min-w-[200px] px-4 py-3 font-medium">收货地址</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">快递单号</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">下单时间</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {list.length === 0 && (
                    <tr>
                      <td colSpan={12} className="py-12 text-center text-sm text-ink-500">
                        暂无订单
                      </td>
                    </tr>
                  )}
                  {list.map((order) => (
                    <tr key={order.id} className="align-top transition hover:bg-ink-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-700">{order.orderNo}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-900">{order.customerName ?? idFallback(order.customerId)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-900">{order.therapistName ?? idFallback(order.therapistUserId)}</td>
                      <td className="max-w-[160px] px-4 py-3">
                        <span className="block truncate text-ink-900">{order.itemTitle ?? idFallback(order.shopItemId)}</span>
                      </td>
                      <td className="px-4 py-3 text-ink-700">{order.qty}</td>
                      <td className="px-4 py-3 font-mono text-ink-900">{order.totalPoints.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {statusPill(STATUS_LABEL[order.status] ?? order.status, STATUS_COLOR[order.status] ?? 'bg-ink-100 text-ink-500')}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {statusPill(
                          COMMISSION_STATUS_LABEL[order.commissionStatus] ?? order.commissionStatus,
                          COMMISSION_STATUS_COLOR[order.commissionStatus] ?? 'bg-ink-100 text-ink-500',
                        )}
                      </td>
                      <td className="max-w-[200px] px-4 py-3 text-xs text-ink-500">
                        <span className="block whitespace-pre-wrap break-words">{parseAddress(order.shippingAddressEncrypted)}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-700">
                        {order.trackingNumber ?? <span className="text-ink-300">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500">{fmtTime(order.createdAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {order.status === 'paid' && (
                            <button
                              onClick={() => {
                                setShipOrder(order);
                                setTrackingInput('');
                              }}
                              disabled={busy}
                              className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-amber-600 disabled:opacity-50"
                            >
                              标记发货
                            </button>
                          )}
                          {order.status === 'shipped' && (
                            <button
                              onClick={() => void handleDeliver(order)}
                              disabled={busy}
                              className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
                            >
                              标记送达
                            </button>
                          )}
                          {order.status !== 'refunded' && order.status !== 'cancelled' && order.status !== 'delivered' && (
                            <button
                              onClick={() => setRefundOrder(order)}
                              disabled={busy}
                              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                            >
                              退款
                            </button>
                          )}
                          {order.status !== 'paid' &&
                            order.status !== 'shipped' &&
                            (order.status === 'refunded' || order.status === 'cancelled' || order.status === 'delivered') && (
                              <span className="text-xs text-ink-300">—</span>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 发货弹窗 */}
      {shipOrder && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShipOrder(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-ink-100 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-ink-100 px-5 py-3.5">
              <h2 className="font-semibold text-ink-900">标记发货</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                订单 <span className="font-mono">{shipOrder.orderNo}</span>
              </p>
            </div>
            <div className="space-y-3 p-5">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-700">快递单号(必填)</label>
                <input
                  type="text"
                  value={trackingInput}
                  onChange={(e) => setTrackingInput(e.target.value)}
                  placeholder="SF1234567890 / 顺丰 / 极兔 / ..."
                  className={`${INPUT_CLS} font-mono`}
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && void handleShip()}
                />
              </div>
              <div className="rounded-lg bg-ink-50 p-2.5 text-xs text-ink-500">
                <span className="font-medium text-ink-700">收货地址：</span>
                {parseAddress(shipOrder.shippingAddressEncrypted)}
              </div>
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-ink-100 p-4">
              <button onClick={() => setShipOrder(null)} className="btn btn-ghost">
                取消
              </button>
              <button
                onClick={() => void handleShip()}
                disabled={busy || !trackingInput.trim()}
                className="btn bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {busy ? '提交中…' : '确认发货'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 退款二次确认弹窗 */}
      {refundOrder && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setRefundOrder(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-ink-100 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-ink-100 px-5 py-3.5">
              <h2 className="font-semibold text-red-600">确认退款</h2>
            </div>
            <div className="space-y-3 p-5">
              <p className="text-sm text-ink-700">
                订单 <span className="font-mono font-medium">{refundOrder.orderNo}</span>
                <br />
                商品：{refundOrder.itemTitle ?? refundOrder.shopItemId}
                <br />
                积分：<span className="font-mono font-medium">{refundOrder.totalPoints.toLocaleString()}</span>
              </p>
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                退款后积分将退还给客户，技师佣金将置为作废。此操作不可撤销。
              </p>
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-ink-100 p-4">
              <button onClick={() => setRefundOrder(null)} className="btn btn-ghost">
                取消
              </button>
              <button
                onClick={() => void handleRefund()}
                disabled={busy}
                className="btn btn-danger disabled:opacity-50"
              >
                {busy ? '处理中…' : '确认退款'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
