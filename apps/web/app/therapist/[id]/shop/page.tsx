'use client';

import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ShoppingBag,
  Heart,
  AlertCircle,
  ChevronRight,
  MapPin,
  PackageOpen,
  Check,
  X,
} from 'lucide-react';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';
import { ErrorBanner, LoadingFull } from '@/components/ui';
import { pointsToFiatLabel, type CurrencyMini } from '@/lib/fiat';

// ─── 类型 ───────────────────────────────────────────────

interface ShopItemFull {
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
}

interface ListingRow {
  id: string;
  shopItemId: string;
  therapistNote: string | null;
  displayOrder: number;
}

interface ShopEntry {
  listing: ListingRow;
  item: ShopItemFull;
}

interface TherapistMini {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  defaultCurrencyCode?: string | null;
}

// ─── 成人确认弹窗 ────────────────────────────────────────

function AgeGateModal({
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
        <h2 className="mb-1 text-center text-serif-cn text-[18px] font-semibold text-ink-900">
          成人商品确认
        </h2>
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

function AddressModal({
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
          平台将以隐私包装发货，地址仅用于物流，不会对外透露商品内容。
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
  balance: number | null;
  currencies: CurrencyMini[];
  defaultCurrencyCode: string | null | undefined;
  onProceed: () => void;
  onCancel: () => void;
  onRecharge: () => void;
}

function ConfirmOrderModal({
  item,
  listing,
  balance,
  currencies,
  defaultCurrencyCode,
  onProceed,
  onCancel,
  onRecharge,
}: ConfirmOrderModalProps) {
  const priceLabel = pointsToFiatLabel(item.pricePoints, defaultCurrencyCode, currencies);
  const insufficient = balance !== null && balance < item.pricePoints;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
      <div className="w-full max-w-[390px] rounded-t-3xl bg-white px-5 pb-8 pt-5 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-200" />
        <div className="mb-3 flex gap-3">
          {item.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.coverUrl}
              alt={item.title}
              className="h-16 w-16 flex-shrink-0 rounded-xl object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-xl bg-warm-50">
              <PackageOpen className="h-6 w-6 text-ink-300" />
            </div>
          )}
          <div className="flex-1">
            <div className="text-[14px] font-semibold text-ink-900">{item.title}</div>
            {listing.therapistNote && (
              <div className="mt-0.5 text-[11px] text-ink-500">{listing.therapistNote}</div>
            )}
            <div className="mt-1 text-[15px] font-bold text-primary">{priceLabel}</div>
          </div>
        </div>

        {/* 余额显示 */}
        {balance !== null && (
          <div
            className={`mb-3 flex items-center justify-between rounded-xl px-3 py-2 text-[12px] ${
              insufficient
                ? 'border border-warning-500/30 bg-warning-500/10'
                : 'bg-emerald-50/60 border border-emerald-100'
            }`}
          >
            <span className={insufficient ? 'text-warning-700' : 'text-ink-700'}>
              <Heart
                className={`mr-1 inline h-3 w-3 ${insufficient ? 'text-warning-500' : 'fill-emerald-500 text-emerald-500'}`}
              />
              心动金余额
            </span>
            <span
              className={`num font-semibold ${insufficient ? 'text-warning-700' : 'text-ink-900'}`}
            >
              {balance.toLocaleString()} 积分
            </span>
          </div>
        )}

        {insufficient ? (
          <>
            <div className="mb-2 rounded-xl border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-center text-[11px] text-warning-700">
              余额不足 · 需 <span className="num font-semibold">{item.pricePoints}</span> 积分 · 还差{' '}
              <span className="num font-semibold">{item.pricePoints - (balance ?? 0)}</span> 积分
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
            <span className="text-serif-cn text-sm font-medium tracking-wider">
              确认购买 · {priceLabel}
            </span>
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

// ─── 主页面 ──────────────────────────────────────────────

export default function TherapistShopPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();

  // === 所有 state hooks 必须在任何 early return 之前无条件声明（Rules of Hooks）===
  const [therapist, setTherapist] = useState<TherapistMini | null>(null);
  const [shopEntries, setShopEntries] = useState<ShopEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 货币字典
  const [currencies, setCurrencies] = useState<CurrencyMini[]>([]);

  // 当前用户余额 + 成年确认状态
  const [balance, setBalance] = useState<number | null>(null);
  const [adultConfirmedAt, setAdultConfirmedAt] = useState<string | null | undefined>(undefined); // undefined=未拉到

  // 下单流程状态
  const [selectedEntry, setSelectedEntry] = useState<ShopEntry | null>(null);
  // step: 'confirm_order' → 'age_gate' → 'address' → done
  const [orderStep, setOrderStep] = useState<'confirm_order' | 'age_gate' | 'address' | null>(null);
  const [ageConfirming, setAgeConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 拉货币字典
  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<CurrencyMini[]>('/currencies');
        setCurrencies(data);
      } catch {
        /* 静默 */
      }
    })();
  }, []);

  // 拉 /me：余额 + 成年确认状态
  useEffect(() => {
    void (async () => {
      try {
        const me = await apiGet<{
          points?: { balance?: number };
          user?: { adultConfirmedAt?: string | null };
        }>('/me');
        setBalance(Number(me.points?.balance ?? 0));
        setAdultConfirmedAt(me.user?.adultConfirmedAt ?? null);
      } catch {
        setBalance(null);
        setAdultConfirmedAt(null);
      }
    })();
  }, []);

  // 拉技师信息（显示名称/头像）
  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const data = await apiGet<TherapistMini>(`/therapists/${id}`);
        setTherapist(data);
      } catch (err) {
        if (err instanceof ApiClientError) setLoadError(err.payload.message);
        else setLoadError('加载失败');
      }
    })();
  }, [id]);

  // 拉橱窗商品
  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const data = await apiGet<ShopEntry[]>(`/shop/by-therapist/${id}`);
        setShopEntries(data);
      } catch (err) {
        if (err instanceof ApiClientError) setLoadError(err.payload.message);
        else setLoadError('加载橱窗失败');
        setShopEntries([]);
      }
    })();
  }, [id]);

  // ── 早返回：加载中 ──────────────────────────────────────
  if (shopEntries === null) {
    return (
      <div className="mobile-container bg-white">
        {loadError ? <div className="p-4"><ErrorBanner message={loadError} /></div> : <LoadingFull />}
      </div>
    );
  }

  // ── 事件处理 ──────────────────────────────────────────

  function openItem(entry: ShopEntry) {
    if (entry.item.stockQty <= 0) return; // 已售罄不可点
    setSelectedEntry(entry);
    setOrderError(null);
    setOrderStep('confirm_order');
  }

  function closeModal() {
    setSelectedEntry(null);
    setOrderStep(null);
    setOrderError(null);
  }

  /** 从 confirm_order 步：检查成年确认，再决定下一步 */
  function handleProceedFromConfirm() {
    if (!selectedEntry) return;
    if (!adultConfirmedAt) {
      // 需要先完成年龄确认
      setOrderStep('age_gate');
    } else {
      // 已确认成年，直接进地址
      setOrderStep('address');
    }
  }

  /** 年龄确认 */
  async function handleAgeConfirm() {
    setAgeConfirming(true);
    try {
      await apiPost('/me/adult-confirm', {});
      setAdultConfirmedAt(new Date().toISOString());
      setOrderStep('address');
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.payload.message : '确认失败，请稍后重试';
      setOrderError(msg);
      setOrderStep('confirm_order'); // 回退到确认步
    } finally {
      setAgeConfirming(false);
    }
  }

  /** 提交下单（带收货地址） */
  async function handleSubmitOrder(addr: string) {
    if (!selectedEntry) return;
    if (addr.trim().length < 10) {
      setOrderError('请填写完整收货地址（至少 10 个字）');
      return;
    }
    setSubmitting(true);
    setOrderError(null);
    try {
      await apiPost('/shop/orders', {
        therapist_id: id,
        shop_item_id: selectedEntry.item.id,
        qty: 1,
        shipping_address_encrypted: addr.trim(),
      });
      setSuccessMsg('下单成功，平台将隐私包装为你发货');
      closeModal();
      // 刷新余额
      try {
        const me = await apiGet<{ points?: { balance?: number } }>('/me');
        setBalance(Number(me.points?.balance ?? 0));
      } catch {
        /* 静默 */
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        const code = err.payload.code as string | undefined;
        if (code === 'E2030_ADULT_CONFIRM_REQUIRED') {
          // 后端认为未确认，重新走年龄确认
          setAdultConfirmedAt(null);
          setOrderStep('age_gate');
          return;
        }
        if (code === 'E2010_BALANCE_INSUFFICIENT' || err.payload.message.includes('insufficient')) {
          setOrderError('心动金余额不足，请充值后再购买');
        } else {
          setOrderError(err.payload.message);
        }
      } else {
        setOrderError('下单失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── 渲染 ──────────────────────────────────────────────

  const defaultCurrencyCode = therapist?.defaultCurrencyCode;

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* === 顶部导航 === */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-white/85 px-4 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-cta text-white shadow-warm-md active:scale-95"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center">
          <div className="text-serif-cn text-[14px] font-semibold text-ink-900">
            {therapist?.displayName ? `${therapist.displayName} 的橱窗` : 'TA 的橱窗'}
          </div>
          <div className="font-cormorant italic text-[9px] tracking-[0.3em] text-ink-500">STOREFRONT</div>
        </div>
        <div className="h-9 w-9" />
      </header>

      {/* 错误条 */}
      {loadError && <div className="px-4 pt-3"><ErrorBanner message={loadError} /></div>}

      {/* 下单成功提示 */}
      {successMsg && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div>
            <div className="text-[13px] font-semibold text-emerald-700">{successMsg}</div>
            <div className="mt-0.5 text-[11px] text-emerald-600">
              通常 3-7 个工作日送达，包装不体现商品内容
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="ml-auto shrink-0 text-emerald-400 active:text-emerald-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* === 商品列表 === */}
      <main className="px-4 py-4">
        {shopEntries.length === 0 ? (
          /* 空态 */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warm-100">
              <PackageOpen className="h-7 w-7 text-ink-300" />
            </div>
            <div className="text-serif-cn text-[15px] font-semibold text-ink-700">
              该技师所在地区暂无可购商品
            </div>
            <div className="mt-1.5 text-[12px] text-ink-400">橱窗商品因国家/地区上架，敬请期待</div>
            <button
              type="button"
              onClick={() => router.back()}
              className="mt-5 rounded-full border border-warm-300 bg-white px-6 py-2 text-[13px] text-ink-600 active:bg-warm-50"
            >
              返回
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {shopEntries.map(({ listing, item }) => {
              const soldOut = item.stockQty <= 0;
              const priceLabel = pointsToFiatLabel(
                item.pricePoints,
                defaultCurrencyCode,
                currencies,
              );
              return (
                <button
                  key={listing.id}
                  type="button"
                  onClick={() => openItem({ listing, item })}
                  disabled={soldOut}
                  className={`flex flex-col overflow-hidden rounded-2xl border bg-white text-left shadow-warm-xs transition active:scale-[0.98] disabled:opacity-60 ${
                    soldOut ? 'cursor-not-allowed' : 'border-warm-100 hover:border-warm-300'
                  }`}
                >
                  {/* 封面图 */}
                  <div className="relative aspect-square w-full overflow-hidden bg-warm-50">
                    {item.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.coverUrl}
                        alt={item.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <PackageOpen className="h-8 w-8 text-ink-200" />
                      </div>
                    )}
                    {soldOut && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-ink-600">
                          已售罄
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 信息区 */}
                  <div className="flex flex-1 flex-col p-3">
                    <div className="flex-1 text-[12.5px] font-semibold leading-snug text-ink-900 line-clamp-2">
                      {item.title}
                    </div>
                    {listing.therapistNote && (
                      <div className="mt-1 text-[10.5px] leading-4 text-ink-500 line-clamp-2">
                        {listing.therapistNote}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="num text-[14px] font-bold text-primary">{priceLabel}</span>
                      {item.soldCount > 0 && (
                        <span className="text-[9px] text-ink-400">{item.soldCount} 件已售</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>

      {/* === 成人确认弹窗 === */}
      {orderStep === 'age_gate' && (
        <AgeGateModal
          confirming={ageConfirming}
          onConfirm={() => void handleAgeConfirm()}
          onCancel={closeModal}
        />
      )}

      {/* === 下单确认弹窗 === */}
      {orderStep === 'confirm_order' && selectedEntry && (
        <ConfirmOrderModal
          item={selectedEntry.item}
          listing={selectedEntry.listing}
          balance={balance}
          currencies={currencies}
          defaultCurrencyCode={defaultCurrencyCode}
          onProceed={handleProceedFromConfirm}
          onCancel={closeModal}
          onRecharge={() => router.push(`/me/recharge?back=${encodeURIComponent(pathname)}`)}
        />
      )}

      {/* === 收货地址弹窗 === */}
      {orderStep === 'address' && selectedEntry && (
        <AddressModal
          submitting={submitting}
          error={orderError}
          onSubmit={(addr) => void handleSubmitOrder(addr)}
          onCancel={closeModal}
        />
      )}
    </div>
  );
}
