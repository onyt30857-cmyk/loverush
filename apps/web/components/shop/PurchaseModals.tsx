'use client';

/**
 * 橱窗下单流程共享弹窗(成年确认 / 收货地址 / 下单确认)· M09a
 * storefront 与商品详情页共用,避免重复。纯展示组件,逻辑由父组件编排。
 */
import { useState } from 'react';
import { ShoppingBag, Heart, AlertCircle, ChevronRight, MapPin, PackageOpen, Check } from 'lucide-react';
import { pointsToFiatLabel, type CurrencyMini } from '@/lib/fiat';

// ─── 共享类型 ───────────────────────────────────────────

export interface ShopItemFull {
  id: string;
  sku: string;
  title: string;
  description: string | null;
  category: string;
  pricePoints: number;
  coverUrl: string | null;
  mediaUrls: string[] | null;
  stockQty: number;
  soldCount: number;
  isActive: number;
  specLabel?: string | null;
  specOptions?: string[] | null;
}

export interface ListingRow {
  id: string;
  shopItemId: string;
  therapistNote: string | null;
  displayOrder: number;
}

export interface ShopEntry {
  listing: ListingRow;
  item: ShopItemFull;
}

export interface TherapistMini {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  defaultCurrencyCode?: string | null;
}

// ─── 成人确认弹窗 ────────────────────────────────────────

export function AgeGateModal({
  onConfirm,
  onCancel,
  confirming,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
      <div className="w-full max-w-[390px] rounded-t-3xl bg-white px-5 pb-8 pt-5 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-200" />
        <div className="mb-1 text-center text-2xl">🔞</div>
        <h2 className="mb-1 text-center text-serif-cn text-[18px] font-semibold text-ink-900">成人商品确认</h2>
        <p className="mb-4 text-center text-[12px] leading-5 text-ink-500">
          本橱窗含成人用品，请确认你已年满 18 周岁。
          <br />
          一经确认将记录到你的账户，后续购买无需重复确认。
        </p>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirming}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-cta py-3.5 text-white shadow-warm-md transition active:scale-[0.98] disabled:opacity-60"
        >
          <Check className="h-4 w-4" />
          <span className="text-serif-cn text-sm font-medium tracking-wider">
            {confirming ? '确认中…' : '我已年满 18 周岁，继续购买'}
          </span>
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex w-full items-center justify-center rounded-2xl border border-ink-200 py-3 text-[13px] text-ink-500 active:bg-ink-50"
        >
          取消
        </button>
      </div>
    </div>
  );
}

// ─── 地址采集弹窗 ────────────────────────────────────────

export function AddressModal({
  onSubmit,
  onCancel,
  submitting,
  error,
}: {
  onSubmit: (addr: string) => void;
  onCancel: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const [addr, setAddr] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
      <div className="w-full max-w-[390px] rounded-t-3xl bg-white px-5 pb-8 pt-5 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-200" />
        <div className="mb-1 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          <h2 className="text-serif-cn text-[16px] font-semibold text-ink-900">填写收货地址</h2>
        </div>
        <p className="mb-3 text-[11px] leading-5 text-ink-500">
          请务必填写<span className="font-medium text-ink-700">可联系的手机号</span>,用于物流派送联系。平台将以隐私包装发货,地址仅用于物流,不会对外透露商品内容。
        </p>
        <textarea
          value={addr}
          onChange={(e) => setAddr(e.target.value.slice(0, 300))}
          placeholder="收货人姓名 + 手机号 + 完整地址（省市区 + 街道门牌）"
          rows={4}
          className="mb-1 w-full resize-none rounded-xl border border-ink-100 px-3 py-2.5 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-primary focus:outline-none"
        />
        <div className="mb-3 text-right text-[10px] text-ink-400">{addr.length}/300</div>
        {error && (
          <div className="mb-2 flex items-start gap-1.5 rounded-xl border border-warning-500/40 bg-warning-500/10 px-3 py-2 text-[12px] text-warning-700">
            <AlertCircle className="mt-px h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => onSubmit(addr)}
          disabled={submitting || addr.trim().length < 10}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-cta py-3.5 text-white shadow-warm-md transition active:scale-[0.98] disabled:opacity-50"
        >
          <ShoppingBag className="h-4 w-4" />
          <span className="text-serif-cn text-sm font-medium tracking-wider">
            {submitting ? '下单中…' : '确认地址 · 立即下单'}
          </span>
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex w-full items-center justify-center rounded-2xl border border-ink-200 py-3 text-[13px] text-ink-500 active:bg-ink-50"
        >
          取消
        </button>
      </div>
    </div>
  );
}

// ─── 下单确认弹窗 ────────────────────────────────────────

interface ConfirmOrderModalProps {
  item: ShopItemFull;
  listing: ListingRow;
  qty: number;
  selectedSpec?: string | null;
  balance: number | null;
  currencies: CurrencyMini[];
  defaultCurrencyCode: string | null | undefined;
  onProceed: () => void;
  onCancel: () => void;
  onRecharge: () => void;
}

export function ConfirmOrderModal({
  item,
  listing,
  qty,
  selectedSpec,
  balance,
  currencies,
  defaultCurrencyCode,
  onProceed,
  onCancel,
  onRecharge,
}: ConfirmOrderModalProps) {
  const totalPoints = item.pricePoints * qty;
  const priceLabel = pointsToFiatLabel(item.pricePoints, defaultCurrencyCode, currencies);
  const totalLabel = pointsToFiatLabel(totalPoints, defaultCurrencyCode, currencies);
  const insufficient = balance !== null && balance < totalPoints;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
      <div className="w-full max-w-[390px] rounded-t-3xl bg-white px-5 pb-8 pt-5 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-200" />
        <div className="mb-3 flex gap-3">
          {item.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.coverUrl} alt={item.title} className="h-16 w-16 flex-shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-warm-50">
              <PackageOpen className="h-6 w-6 text-ink-300" />
            </div>
          )}
          <div className="flex-1">
            <div className="text-[14px] font-semibold text-ink-900">{item.title}</div>
            {selectedSpec && <div className="mt-0.5 text-[11px] text-ink-500">{item.specLabel ?? '规格'}:{selectedSpec}</div>}
            {listing.therapistNote && <div className="mt-0.5 text-[11px] text-ink-500">{listing.therapistNote}</div>}
            <div className="mt-1 text-[12px] text-ink-500">
              {priceLabel} × {qty} = <span className="text-[15px] font-bold text-primary">{totalLabel}</span>
            </div>
          </div>
        </div>

        {balance !== null && (
          <div
            className={`mb-3 flex items-center justify-between rounded-xl px-3 py-2 text-[12px] ${
              insufficient ? 'border border-warning-500/30 bg-warning-500/10' : 'bg-emerald-50/60 border border-emerald-100'
            }`}
          >
            <span className={insufficient ? 'text-warning-700' : 'text-ink-700'}>
              <Heart className={`mr-1 inline h-3 w-3 ${insufficient ? 'text-warning-500' : 'fill-emerald-500 text-emerald-500'}`} />
              心动金余额
            </span>
            <span className={`num font-semibold ${insufficient ? 'text-warning-700' : 'text-ink-900'}`}>
              {balance.toLocaleString()} 积分
            </span>
          </div>
        )}

        {insufficient ? (
          <>
            <div className="mb-2 rounded-xl border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-center text-[11px] text-warning-700">
              余额不足 · 需 <span className="num font-semibold">{totalPoints}</span> 积分 · 还差{' '}
              <span className="num font-semibold">{totalPoints - (balance ?? 0)}</span> 积分
            </div>
            <button
              type="button"
              onClick={onRecharge}
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-cta py-3.5 text-white shadow-warm-md transition active:scale-[0.98]"
            >
              <Heart className="h-4 w-4 fill-white" />
              <span className="text-serif-cn text-sm font-medium tracking-wider">去充值心动金</span>
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onProceed}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-cta py-3.5 text-white shadow-warm-md transition active:scale-[0.98]"
          >
            <ShoppingBag className="h-4 w-4" />
            <span className="text-serif-cn text-sm font-medium tracking-wider">确认购买 · {totalLabel}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="flex w-full items-center justify-center rounded-2xl border border-ink-200 py-3 text-[13px] text-ink-500 active:bg-ink-50"
        >
          取消
        </button>
      </div>
    </div>
  );
}
