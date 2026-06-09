'use client';

/**
 * 橱窗商品详情页 · M09a
 *
 * 点商品先进详情(画廊/描述/价格/库存)→「立即购买」走原下单流程(成年门→地址→下单)。
 * 复用 /shop/by-therapist/:id(含每件商品全字段),无需新后端;下单弹窗复用 components/shop/PurchaseModals。
 */

import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { ArrowLeft, ShoppingBag, PackageOpen, Check, X } from 'lucide-react';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';
import { ErrorBanner, LoadingFull } from '@/components/ui';
import { pointsToFiatLabel, type CurrencyMini } from '@/lib/fiat';
import {
  AgeGateModal,
  AddressModal,
  ConfirmOrderModal,
  type ShopEntry,
  type TherapistMini,
} from '@/components/shop/PurchaseModals';

const CATEGORY_LABEL: Record<string, string> = {
  adult_toys: '成人用品',
  health: '健康产品',
  massage_oil: '按摩油',
};

export default function ShopItemDetailPage() {
  const { id, itemId } = useParams<{ id: string; itemId: string }>();
  const router = useRouter();
  const pathname = usePathname();

  const [therapist, setTherapist] = useState<TherapistMini | null>(null);
  const [entry, setEntry] = useState<ShopEntry | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currencies, setCurrencies] = useState<CurrencyMini[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [adultConfirmedAt, setAdultConfirmedAt] = useState<string | null | undefined>(undefined);

  // 画廊
  const [activeImg, setActiveImg] = useState(0);

  // 数量 + 型号
  const [qty, setQty] = useState(1);
  const [selectedSpec, setSelectedSpec] = useState<string | null>(null);

  // 下单流程
  const [orderRequestId, setOrderRequestId] = useState('');
  const [orderStep, setOrderStep] = useState<'confirm_order' | 'age_gate' | 'address' | null>(null);
  const [ageConfirming, setAgeConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ orderNo: string; itemTitle: string; priceLabel: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try { setCurrencies(await apiGet<CurrencyMini[]>('/currencies')); } catch { /* 静默 */ }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const me = await apiGet<{ points?: { balance?: number }; user?: { adult_confirmed_at?: string | null } }>('/me');
        setBalance(Number(me.points?.balance ?? 0));
        setAdultConfirmedAt(me.user?.adult_confirmed_at ?? null);
      } catch {
        setBalance(null);
        setAdultConfirmedAt(null);
      }
    })();
  }, []);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try { setTherapist(await apiGet<TherapistMini>(`/therapists/${id}`)); } catch { /* 静默 */ }
    })();
  }, [id]);

  // 复用 by-therapist 接口,从中找到本商品
  useEffect(() => {
    if (!id || !itemId) return;
    void (async () => {
      try {
        const list = await apiGet<ShopEntry[]>(`/shop/by-therapist/${id}`);
        const found = list.find((e) => e.item.id === itemId);
        if (found) setEntry(found);
        else setNotFound(true);
      } catch (err) {
        if (err instanceof ApiClientError) setLoadError(err.payload.message);
        else setLoadError('加载商品失败');
      }
    })();
  }, [id, itemId]);

  if (loadError) {
    return <div className="mobile-container bg-white"><div className="p-4"><ErrorBanner message={loadError} /></div></div>;
  }
  if (notFound) {
    return (
      <div className="mobile-container bg-gradient-soft">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <PackageOpen className="h-10 w-10 text-ink-300" />
          <div className="mt-3 text-serif-cn text-[15px] font-semibold text-ink-700">商品不存在或已下架</div>
          <button type="button" onClick={() => router.back()} className="mt-5 rounded-full border border-warm-300 bg-white px-6 py-2 text-[13px] text-ink-600 active:bg-warm-50">返回</button>
        </div>
      </div>
    );
  }
  if (!entry) {
    return <div className="mobile-container bg-white"><LoadingFull /></div>;
  }

  const { item, listing } = entry;
  const defaultCurrencyCode = therapist?.defaultCurrencyCode;
  const priceLabel = pointsToFiatLabel(item.pricePoints, defaultCurrencyCode, currencies);
  const soldOut = item.stockQty <= 0;
  const categoryLabel = CATEGORY_LABEL[item.category] ?? item.category;
  const images = [item.coverUrl, ...(item.mediaUrls ?? [])].filter((u): u is string => !!u);
  const specOptions = item.specOptions ?? [];
  const hasSpec = specOptions.length > 0;
  const maxQty = Math.min(item.stockQty, 20);
  const totalLabel = pointsToFiatLabel(item.pricePoints * qty, defaultCurrencyCode, currencies);

  function startBuy() {
    if (soldOut) return;
    if (hasSpec && !selectedSpec) {
      setOrderError(`请先选择${item.specLabel ?? '型号'}`);
      return;
    }
    setOrderRequestId(crypto.randomUUID());
    setOrderError(null);
    setOrderStep('confirm_order');
  }
  function closeModal() {
    setOrderStep(null);
    setOrderError(null);
  }
  function handleProceedFromConfirm() {
    setOrderStep(adultConfirmedAt ? 'address' : 'age_gate');
  }
  async function handleAgeConfirm() {
    setAgeConfirming(true);
    try {
      await apiPost('/me/adult-confirm', {});
      setAdultConfirmedAt(new Date().toISOString());
      setOrderStep('address');
    } catch (err) {
      setOrderError(err instanceof ApiClientError ? err.payload.message : '确认失败，请稍后重试');
      setOrderStep('confirm_order');
    } finally {
      setAgeConfirming(false);
    }
  }
  async function handleSubmitOrder(addr: string) {
    if (addr.trim().length < 10) {
      setOrderError('请填写完整收货地址（至少 10 个字）');
      return;
    }
    setSubmitting(true);
    setOrderError(null);
    try {
      const created = await apiPost<{ id?: string; orderNo?: string }>('/shop/orders', {
        therapist_id: id,
        shop_item_id: item.id,
        qty,
        shipping_address_encrypted: addr.trim(),
        ...(selectedSpec ? { selected_spec: selectedSpec } : {}),
        request_id: orderRequestId,
      });
      setSuccessInfo({ orderNo: created.orderNo ?? '', itemTitle: `${item.title}${selectedSpec ? ` · ${selectedSpec}` : ''} ×${qty}`, priceLabel: totalLabel });
      setSuccessMsg('下单成功，平台将隐私包装为你发货');
      closeModal();
      try {
        const me = await apiGet<{ points?: { balance?: number } }>('/me');
        setBalance(Number(me.points?.balance ?? 0));
      } catch { /* 静默 */ }
    } catch (err) {
      if (err instanceof ApiClientError) {
        const code = err.payload.code as string | undefined;
        if (code === 'E2030') { setAdultConfirmedAt(null); setOrderStep('age_gate'); return; }
        if (code === 'E2010' || err.payload.message.includes('insufficient')) setOrderError('心动金余额不足，请充值后再购买');
        else setOrderError(err.payload.message);
      } else {
        setOrderError('下单失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mobile-container bg-gradient-soft pb-24">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-white/85 px-4 backdrop-blur-md">
        <button type="button" onClick={() => router.back()} className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-cta text-white shadow-warm-md active:scale-95">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center">
          <div className="text-serif-cn text-[14px] font-semibold text-ink-900">商品详情</div>
          <div className="font-cormorant italic text-[9px] tracking-[0.3em] text-ink-500">PRODUCT</div>
        </div>
        <div className="h-9 w-9" />
      </header>

      {/* 下单成功提示 */}
      {successMsg && (
        <div className="mx-4 mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3">
          <div className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-emerald-700">{successMsg}</div>
              <div className="mt-0.5 text-[11px] text-emerald-600">通常 3-7 个工作日送达，包装不体现商品内容</div>
            </div>
            <button type="button" onClick={() => { setSuccessMsg(null); setSuccessInfo(null); }} className="shrink-0 text-emerald-400 active:text-emerald-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          {successInfo && (
            <div className="mt-2.5 rounded-xl bg-white/70 px-3 py-2 text-[12px] text-ink-700">
              <div className="flex items-center justify-between">
                <span className="truncate pr-2">{successInfo.itemTitle}</span>
                <span className="num shrink-0 font-semibold text-primary">{successInfo.priceLabel}</span>
              </div>
              {successInfo.orderNo && <div className="mt-0.5 font-mono text-[10.5px] text-ink-400">订单号 {successInfo.orderNo}</div>}
            </div>
          )}
          <button type="button" onClick={() => router.push('/me/shop-orders')} className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-cta py-2.5 text-[12.5px] font-medium text-white shadow-warm-sm active:scale-[0.98]">
            <ShoppingBag className="h-3.5 w-3.5" />查看我的橱窗订单
          </button>
        </div>
      )}

      {/* 图片画廊 · 点主图切下一张(多图时) */}
      <div
        className="relative aspect-square w-full overflow-hidden bg-warm-50"
        onClick={() => { if (images.length > 1) setActiveImg((i) => (i + 1) % images.length); }}
      >
        {images.length > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={images[activeImg]} alt={item.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center"><PackageOpen className="h-12 w-12 text-ink-200" /></div>
        )}
        {images.length > 1 && (
          <div className="absolute bottom-2 right-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] text-white">
            {activeImg + 1}/{images.length}
          </div>
        )}
        {soldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="rounded-full bg-white/90 px-3 py-1 text-[13px] font-semibold text-ink-600">已售罄</span>
          </div>
        )}
      </div>
      {/* 缩略图条 */}
      {images.length > 1 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-2">
          {images.map((u, i) => (
            <button key={u + i} type="button" onClick={() => setActiveImg(i)} className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg ring-2 ${i === activeImg ? 'ring-primary' : 'ring-transparent'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* 信息区 */}
      <div className="px-5 pt-3">
        <div className="text-serif-cn text-[17px] font-bold leading-snug text-ink-900">{item.title}</div>
        <div className="mt-2 flex items-end justify-between">
          <span className="num text-[22px] font-bold text-primary">{priceLabel}</span>
          <span className="text-[11px] text-ink-400">
            {item.soldCount > 0 ? `${item.soldCount} 件已售 · ` : ''}{soldOut ? '无库存' : `库存 ${item.stockQty}`}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-ink-400">{categoryLabel} · 隐私包装发货</div>

        {/* 型号/规格选择 */}
        {hasSpec && (
          <div className="mt-4">
            <div className="mb-1.5 text-[12px] font-semibold text-ink-700">{item.specLabel ?? '型号/规格'}</div>
            <div className="flex flex-wrap gap-2">
              {specOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => { setSelectedSpec(opt); setOrderError(null); }}
                  className={`rounded-full border px-3.5 py-1.5 text-[12.5px] transition active:scale-95 ${
                    selectedSpec === opt ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-warm-200 text-ink-600'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 购买数量 */}
        {!soldOut && (
          <div className="mt-4 flex items-center justify-between">
            <div className="text-[12px] font-semibold text-ink-700">购买数量</div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={qty <= 1}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-warm-200 text-[18px] text-ink-600 disabled:opacity-40 active:bg-warm-50"
              >−</button>
              <span className="num w-6 text-center text-[15px] font-semibold text-ink-900">{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                disabled={qty >= maxQty}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-warm-200 text-[18px] text-ink-600 disabled:opacity-40 active:bg-warm-50"
              >+</button>
            </div>
          </div>
        )}

        {orderError && !orderStep && (
          <div className="mt-3 rounded-xl border border-warning-500/40 bg-warning-500/10 px-3 py-2 text-[12px] text-warning-700">{orderError}</div>
        )}

        {listing.therapistNote && (
          <div className="mt-3 rounded-xl bg-warm-50 px-3 py-2 text-[12.5px] leading-5 text-ink-600">
            技师推荐语:{listing.therapistNote}
          </div>
        )}

        {item.description && (
          <div className="mt-4">
            <div className="mb-1.5 text-[12px] font-semibold text-ink-700">商品介绍</div>
            <div className="whitespace-pre-wrap text-[13px] leading-6 text-ink-600">{item.description}</div>
          </div>
        )}
      </div>

      {/* 底部购买条 */}
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[390px] border-t border-warm-100 bg-white/95 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={startBuy}
          disabled={soldOut}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-cta py-3.5 text-white shadow-warm-md transition active:scale-[0.98] disabled:opacity-50"
        >
          <ShoppingBag className="h-4 w-4" />
          <span className="text-serif-cn text-sm font-medium tracking-wider">{soldOut ? '已售罄' : `立即购买 · ${totalLabel}`}</span>
        </button>
      </div>

      {/* 下单流程弹窗 */}
      {orderStep === 'age_gate' && (
        <AgeGateModal confirming={ageConfirming} onConfirm={() => void handleAgeConfirm()} onCancel={closeModal} />
      )}
      {orderStep === 'confirm_order' && (
        <ConfirmOrderModal
          item={item}
          listing={listing}
          qty={qty}
          selectedSpec={selectedSpec}
          balance={balance}
          currencies={currencies}
          defaultCurrencyCode={defaultCurrencyCode}
          onProceed={handleProceedFromConfirm}
          onCancel={closeModal}
          onRecharge={() => router.push(`/me/recharge?back=${encodeURIComponent(pathname)}`)}
        />
      )}
      {orderStep === 'address' && (
        <AddressModal submitting={submitting} error={orderError} onSubmit={(addr) => void handleSubmitOrder(addr)} onCancel={closeModal} />
      )}
    </div>
  );
}
