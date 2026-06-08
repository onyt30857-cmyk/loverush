'use client';

/**
 * 客户「我的橱窗订单」· M09a Task 10
 *
 * 隐私设计：
 *   - 列表仅显示「成人用品」类目，不直接展示具体商品名（防止旁人看到手机屏幕暴露隐私）
 *   - 不显示累计总金额
 *   - 状态中文化：已下单 / 已发货 / 已送达 / 已退款
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Package, Truck, CheckCircle, RefreshCcw, ShoppingBag } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { LoadingFull } from '@/components/ui';
import { AppShell } from '@/components/AppShell';

// ──────────────── 类型 ────────────────

interface ShopOrderRow {
  id: string;
  orderNo: string;
  status: string;
  qty: number;
  totalPoints: number;
  itemCategory: string | null;
  therapistDisplayName: string | null;
  trackingNumber: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

// ──────────────── 状态标签 ────────────────

const STATUS_LABEL: Record<string, string> = {
  pending: '待支付',
  paid: '已下单',
  shipped: '已发货',
  delivered: '已送达',
  cancelled: '已取消',
  refunded: '已退款',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-ink-400 bg-ink-50',
  paid: 'text-blue-600 bg-blue-50',
  shipped: 'text-amber-600 bg-amber-50',
  delivered: 'text-emerald-600 bg-emerald-50',
  cancelled: 'text-ink-400 bg-ink-50',
  refunded: 'text-ink-400 bg-ink-50',
};

function StatusIcon({ status }: { status: string }) {
  if (status === 'shipped') return <Truck className="h-4 w-4 text-amber-500" />;
  if (status === 'delivered') return <CheckCircle className="h-4 w-4 text-emerald-500" />;
  if (status === 'refunded') return <RefreshCcw className="h-4 w-4 text-ink-400" />;
  return <Package className="h-4 w-4 text-blue-400" />;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ──────────────── 订单卡片 ────────────────

function OrderCard({ order, onClick }: { order: ShopOrderRow; onClick: () => void }) {
  const labelColor = STATUS_COLOR[order.status] ?? 'text-ink-500 bg-ink-50';
  const statusText = STATUS_LABEL[order.status] ?? order.status;

  // 脱敏：商品类目映射为中文展示，不直接显示 title
  const categoryLabel =
    order.itemCategory === 'adult_toys'
      ? '成人用品'
      : order.itemCategory === 'health'
        ? '健康产品'
        : order.itemCategory === 'massage_oil'
          ? '按摩油'
          : order.itemCategory ?? '商品';

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full overflow-hidden rounded-2xl border border-warm-100 bg-white text-left shadow-warm-xs transition active:scale-[0.99]"
    >
      {/* 顶部：类目 + 状态 */}
      <div className="flex items-center justify-between border-b border-warm-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusIcon status={order.status} />
          <span className="text-[13.5px] font-semibold text-ink-800">
            {categoryLabel} · {order.qty > 1 ? `×${order.qty}` : ''}
          </span>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${labelColor}`}>
          {statusText}
        </span>
      </div>

      {/* 中部：订单信息 */}
      <div className="px-4 py-3 space-y-1.5">
        {order.therapistDisplayName && (
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-ink-500">来自技师</span>
            <span className="text-ink-800">{order.therapistDisplayName}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-ink-500">订单号</span>
          <span className="font-mono text-[11px] text-ink-600">{order.orderNo}</span>
        </div>
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-ink-500">积分</span>
          <span className="num font-semibold text-ink-800">{order.totalPoints.toLocaleString()}</span>
        </div>
        {order.trackingNumber && (
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-ink-500">快递单号</span>
            <span className="font-mono text-[11px] text-amber-700">{order.trackingNumber}</span>
          </div>
        )}
      </div>

      {/* 底部：时间线 */}
      <div className="flex items-center gap-3 border-t border-warm-50 px-4 py-2 text-[10.5px] text-ink-400">
        <span>下单 {fmtDate(order.paidAt ?? order.createdAt)}</span>
        {order.shippedAt && <><span>·</span><span>发货 {fmtDate(order.shippedAt)}</span></>}
        {order.deliveredAt && <><span>·</span><span>送达 {fmtDate(order.deliveredAt)}</span></>}
        {order.refundedAt && <><span>·</span><span>退款 {fmtDate(order.refundedAt)}</span></>}
      </div>
    </button>
  );
}

// ──────────────── 主页面 ────────────────

export default function MeShopOrdersPage() {
  const router = useRouter();

  // 所有 hook 必须在 early return 前无条件声明（Rules of Hooks）
  const [orders, setOrders] = useState<ShopOrderRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<ShopOrderRow[]>('/shop/me/orders');
        setOrders(data);
      } catch {
        setLoadError('加载订单失败，请稍后重试');
        setOrders([]);
      }
    })();
  }, []);

  if (orders === null) {
    return (
      <div className="mobile-container bg-gradient-soft">
        <LoadingFull />
      </div>
    );
  }

  return (
    <AppShell>
      {/* 顶部导航 */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-white/85 px-4 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-cta text-white shadow-warm-md active:scale-95"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center">
          <div className="text-serif-cn text-[14px] font-semibold text-ink-900">我的橱窗订单</div>
          <div className="font-cormorant italic text-[9px] tracking-[0.3em] text-ink-500">MY ORDERS</div>
        </div>
        <div className="h-9 w-9" />
      </header>

      {/* 错误提示 */}
      {loadError && (
        <div className="mx-4 mt-3 rounded-xl border border-warning-500/30 bg-warning-500/10 px-4 py-3 text-[12px] text-warning-700">
          {loadError}
        </div>
      )}

      {/* 订单列表 */}
      <main className="px-4 py-4">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warm-100">
              <ShoppingBag className="h-7 w-7 text-ink-300" />
            </div>
            <div className="text-serif-cn text-[15px] font-semibold text-ink-700">暂无橱窗订单</div>
            <div className="mt-1.5 text-[12px] text-ink-400">在技师橱窗下单后，订单将在这里显示</div>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} onClick={() => router.push(`/me/shop-orders/${order.id}`)} />
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
