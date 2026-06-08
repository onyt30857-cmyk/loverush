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

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  paid: 'bg-blue-100 text-blue-700',
  shipped: 'bg-amber-100 text-amber-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
  refunded: 'bg-orange-100 text-orange-700',
};

const COMMISSION_STATUS_LABEL: Record<string, string> = {
  PENDING: '待结算',
  SETTLED: '已结算',
  VOID: '已作废',
};

const COMMISSION_STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  SETTLED: 'bg-green-100 text-green-700',
  VOID: 'bg-red-100 text-red-600',
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

  return (
    <AdminShell>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">橱窗订单</h1>
            <p className="text-sm text-gray-500 mt-1">
              技师橱窗带货订单履约 · 发货 / 送达结算 / 退款
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm"
            >
              {STATUS_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => void load()}
              className="border rounded px-4 py-1.5 text-sm hover:bg-gray-50"
            >
              刷新
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-3 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-500">加载中…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-600">
                  <th className="px-3 py-2 border-b whitespace-nowrap">订单号</th>
                  <th className="px-3 py-2 border-b whitespace-nowrap">客户</th>
                  <th className="px-3 py-2 border-b whitespace-nowrap">技师</th>
                  <th className="px-3 py-2 border-b whitespace-nowrap">商品</th>
                  <th className="px-3 py-2 border-b whitespace-nowrap">数量</th>
                  <th className="px-3 py-2 border-b whitespace-nowrap">积分</th>
                  <th className="px-3 py-2 border-b whitespace-nowrap">订单状态</th>
                  <th className="px-3 py-2 border-b whitespace-nowrap">佣金状态</th>
                  <th className="px-3 py-2 border-b min-w-[200px]">收货地址</th>
                  <th className="px-3 py-2 border-b whitespace-nowrap">快递单号</th>
                  <th className="px-3 py-2 border-b whitespace-nowrap">下单时间</th>
                  <th className="px-3 py-2 border-b whitespace-nowrap text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && (
                  <tr>
                    <td colSpan={12} className="py-8 text-center text-sm text-gray-400">
                      暂无订单
                    </td>
                  </tr>
                )}
                {list.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50 align-top">
                    <td className="px-3 py-2 border-b font-mono text-xs whitespace-nowrap">
                      {order.orderNo}
                    </td>
                    <td className="px-3 py-2 border-b whitespace-nowrap">
                      {order.customerName ?? (
                        <span className="text-gray-400 font-mono text-xs">
                          {order.customerId.slice(0, 8)}…
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-b whitespace-nowrap">
                      {order.therapistName ?? (
                        <span className="text-gray-400 font-mono text-xs">
                          {order.therapistUserId.slice(0, 8)}…
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-b max-w-[160px]">
                      <span className="truncate block">
                        {order.itemTitle ?? (
                          <span className="text-gray-400 font-mono text-xs">{order.shopItemId.slice(0, 8)}…</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-b">{order.qty}</td>
                    <td className="px-3 py-2 border-b font-mono">
                      {order.totalPoints.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 border-b whitespace-nowrap">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${STATUS_COLOR[order.status] ?? 'bg-gray-100 text-gray-700'}`}
                      >
                        {STATUS_LABEL[order.status] ?? order.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-b whitespace-nowrap">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${COMMISSION_STATUS_COLOR[order.commissionStatus] ?? 'bg-gray-100 text-gray-700'}`}
                      >
                        {COMMISSION_STATUS_LABEL[order.commissionStatus] ?? order.commissionStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-b text-xs text-gray-600 max-w-[200px]">
                      <span className="block whitespace-pre-wrap break-words">
                        {parseAddress(order.shippingAddressEncrypted)}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-b font-mono text-xs">
                      {order.trackingNumber ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 border-b text-xs whitespace-nowrap">
                      {fmtTime(order.createdAt)}
                    </td>
                    <td className="px-3 py-2 border-b whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1">
                        {order.status === 'paid' && (
                          <button
                            onClick={() => {
                              setShipOrder(order);
                              setTrackingInput('');
                            }}
                            disabled={busy}
                            className="bg-amber-500 hover:bg-amber-600 text-white text-xs px-2 py-1 rounded disabled:opacity-50"
                          >
                            标记发货
                          </button>
                        )}
                        {order.status === 'shipped' && (
                          <button
                            onClick={() => void handleDeliver(order)}
                            disabled={busy}
                            className="bg-green-600 hover:bg-green-700 text-white text-xs px-2 py-1 rounded disabled:opacity-50"
                          >
                            标记送达
                          </button>
                        )}
                        {order.status !== 'refunded' &&
                          order.status !== 'cancelled' &&
                          order.status !== 'delivered' && (
                            <button
                              onClick={() => setRefundOrder(order)}
                              disabled={busy}
                              className="bg-red-50 hover:bg-red-100 text-red-600 text-xs px-2 py-1 rounded border border-red-200 disabled:opacity-50"
                            >
                              退款
                            </button>
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

      {/* 发货弹窗 */}
      {shipOrder && (
        <div
          className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center"
          onClick={() => setShipOrder(null)}
        >
          <div
            className="bg-white rounded-lg p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-1">标记发货</h2>
            <p className="text-sm text-gray-500 mb-4">
              订单 <span className="font-mono">{shipOrder.orderNo}</span>
            </p>
            <div className="mb-4">
              <label className="block text-xs text-gray-600 mb-1">快递单号(必填)</label>
              <input
                type="text"
                value={trackingInput}
                onChange={(e) => setTrackingInput(e.target.value)}
                placeholder="SF1234567890 / 顺丰 / 极兔 / ..."
                className="border rounded px-3 py-1.5 w-full font-mono"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && void handleShip()}
              />
            </div>
            <div className="mb-3 rounded bg-gray-50 p-2 text-xs text-gray-500">
              <span className="font-medium">收货地址：</span>
              {parseAddress(shipOrder.shippingAddressEncrypted)}
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-3 text-sm">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShipOrder(null)}
                className="px-4 py-1.5 rounded text-sm border"
              >
                取消
              </button>
              <button
                onClick={() => void handleShip()}
                disabled={busy || !trackingInput.trim()}
                className="bg-amber-500 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50"
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
          className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center"
          onClick={() => setRefundOrder(null)}
        >
          <div
            className="bg-white rounded-lg p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-1 text-red-700">确认退款</h2>
            <p className="text-sm text-gray-600 mb-3">
              订单 <span className="font-mono font-medium">{refundOrder.orderNo}</span>
              <br />
              商品：{refundOrder.itemTitle ?? refundOrder.shopItemId}
              <br />
              积分：<span className="font-mono font-medium">{refundOrder.totalPoints.toLocaleString()}</span>
            </p>
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
              退款后积分将退还给客户，技师佣金将置为作废。此操作不可撤销。
            </p>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-3 text-sm">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRefundOrder(null)}
                className="px-4 py-1.5 rounded text-sm border"
              >
                取消
              </button>
              <button
                onClick={() => void handleRefund()}
                disabled={busy}
                className="bg-red-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50"
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
