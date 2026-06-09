'use client';

/**
 * 客户「橱窗订单详情」· M09a
 *
 * 本人可见全貌(列表脱敏,详情页本人看自己的不涉旁人看屏):
 *   商品图/名/类目 · 数量×单价=总积分 · 状态时间线 · 快递单号 · 收货地址 · 来自技师
 * 数据:GET /shop/me/orders/:id(后端做归属校验,非本人 404)
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Package, Truck, CheckCircle, RefreshCcw, PackageOpen, MapPin } from 'lucide-react';
import { apiGet, ApiClientError } from '@/lib/api';
import { LoadingFull, ErrorBanner } from '@/components/ui';
import { AppShell } from '@/components/AppShell';

interface ShopOrderDetail {
  id: string;
  orderNo: string;
  status: string;
  qty: number;
  unitPricePoints: number;
  totalPoints: number;
  selectedSpec: string | null;
  itemTitle: string | null;
  itemCover: string | null;
  itemCategory: string | null;
  itemDescription: string | null;
  therapistId: string | null;
  therapistDisplayName: string | null;
  shippingAddress: string | null;
  trackingNumber: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

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

const CATEGORY_LABEL: Record<string, string> = {
  adult_toys: '成人用品',
  health: '健康产品',
  massage_oil: '按摩油',
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

export default function ShopOrderDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<ShopOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        setOrder(await apiGet<ShopOrderDetail>(`/shop/me/orders/${id}`));
      } catch (err) {
        setError(err instanceof ApiClientError ? err.payload.message : '订单不存在或无权查看');
      }
    })();
  }, [id]);

  if (error) {
    return (
      <div className="mobile-container bg-gradient-soft">
        <div className="p-4"><ErrorBanner message={error} /></div>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="mobile-container bg-gradient-soft">
        <LoadingFull />
      </div>
    );
  }

  const statusText = STATUS_LABEL[order.status] ?? order.status;
  const labelColor = STATUS_COLOR[order.status] ?? 'text-ink-500 bg-ink-50';
  const categoryLabel = order.itemCategory ? CATEGORY_LABEL[order.itemCategory] ?? order.itemCategory : '商品';

  const timeline: Array<{ label: string; at: string | null }> = [
    { label: '下单', at: order.paidAt ?? order.createdAt },
    { label: '发货', at: order.shippedAt },
    { label: '送达', at: order.deliveredAt },
    { label: '退款', at: order.refundedAt },
  ].filter((t) => t.at);

  return (
    <AppShell>
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-white/85 px-4 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-cta text-white shadow-warm-md active:scale-95"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center">
          <div className="text-serif-cn text-[14px] font-semibold text-ink-900">订单详情</div>
          <div className="font-cormorant italic text-[9px] tracking-[0.3em] text-ink-500">ORDER DETAIL</div>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${labelColor}`}>{statusText}</span>
      </header>

      <main className="space-y-3 px-4 py-4">
        {/* 商品卡 */}
        <div className="flex gap-3 rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          {order.itemCover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={order.itemCover} alt={order.itemTitle ?? '商品'} className="h-20 w-20 flex-shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-xl bg-warm-50">
              <PackageOpen className="h-7 w-7 text-ink-300" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-semibold text-ink-900">{order.itemTitle ?? categoryLabel}</div>
            <div className="mt-0.5 text-[11px] text-ink-400">{categoryLabel}{order.selectedSpec ? ` · ${order.selectedSpec}` : ''}</div>
            {order.itemDescription && (
              <div className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-ink-500">{order.itemDescription}</div>
            )}
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="num text-[15px] font-bold text-primary">{order.totalPoints.toLocaleString()}</span>
              <span className="text-[11px] text-ink-400">
                积分 · {order.unitPricePoints.toLocaleString()} ×{order.qty}
              </span>
            </div>
          </div>
        </div>

        {/* 订单信息 */}
        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs space-y-2">
          <Row label="订单号" value={<span className="font-mono text-[11px] text-ink-600">{order.orderNo}</span>} />
          {order.therapistDisplayName && <Row label="来自技师" value={order.therapistDisplayName} />}
          <Row
            label="状态"
            value={
              <span className="inline-flex items-center gap-1.5">
                <StatusIcon status={order.status} />
                {statusText}
              </span>
            }
          />
          {order.trackingNumber && (
            <Row label="快递单号" value={<span className="font-mono text-[11px] text-amber-700">{order.trackingNumber}</span>} />
          )}
        </div>

        {/* 收货地址(本人可见) */}
        {order.shippingAddress && (
          <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-ink-700">
              <MapPin className="h-3.5 w-3.5 text-primary" />收货地址
            </div>
            <div className="whitespace-pre-wrap text-[12.5px] leading-5 text-ink-600">{order.shippingAddress}</div>
            <div className="mt-2 text-[10.5px] text-ink-400">平台隐私包装发货 · 地址仅用于物流</div>
          </div>
        )}

        {/* 时间线 */}
        {timeline.length > 0 && (
          <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
            <div className="mb-2 text-[12px] font-medium text-ink-700">物流进度</div>
            <div className="space-y-1.5">
              {timeline.map((t) => (
                <div key={t.label} className="flex items-center justify-between text-[12px]">
                  <span className="text-ink-500">{t.label}</span>
                  <span className="text-ink-700">{fmtDate(t.at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[12.5px]">
      <span className="text-ink-500">{label}</span>
      <span className="text-ink-800">{value}</span>
    </div>
  );
}
