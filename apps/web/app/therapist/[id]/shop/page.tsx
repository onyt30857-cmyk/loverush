'use client';

/**
 * 技师橱窗(storefront)· M09a · 商品列表
 *
 * 点商品 → 进商品详情页 /therapist/[id]/shop/[itemId](下单流程在详情页)。
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, PackageOpen } from 'lucide-react';
import { apiGet, ApiClientError } from '@/lib/api';
import { ErrorBanner, LoadingFull } from '@/components/ui';
import { pointsToFiatLabel, type CurrencyMini } from '@/lib/fiat';
import type { ShopEntry, TherapistMini } from '@/components/shop/PurchaseModals';

export default function TherapistShopPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [therapist, setTherapist] = useState<TherapistMini | null>(null);
  const [shopEntries, setShopEntries] = useState<ShopEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currencies, setCurrencies] = useState<CurrencyMini[]>([]);

  useEffect(() => {
    void (async () => {
      try { setCurrencies(await apiGet<CurrencyMini[]>('/currencies')); } catch { /* 静默 */ }
    })();
  }, []);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try { setTherapist(await apiGet<TherapistMini>(`/therapists/${id}`)); } catch { /* 静默 */ }
    })();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        setShopEntries(await apiGet<ShopEntry[]>(`/shop/by-therapist/${id}`));
      } catch (err) {
        if (err instanceof ApiClientError) setLoadError(err.payload.message);
        else setLoadError('加载橱窗失败');
        setShopEntries([]);
      }
    })();
  }, [id]);

  if (shopEntries === null) {
    return (
      <div className="mobile-container bg-white">
        {loadError ? <div className="p-4"><ErrorBanner message={loadError} /></div> : <LoadingFull />}
      </div>
    );
  }

  const defaultCurrencyCode = therapist?.defaultCurrencyCode;

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-white/85 px-4 backdrop-blur-md">
        <button type="button" onClick={() => router.back()} className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-cta text-white shadow-warm-md active:scale-95">
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

      {loadError && <div className="px-4 pt-3"><ErrorBanner message={loadError} /></div>}

      {/* 商品列表 */}
      <main className="px-4 py-4">
        {shopEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warm-100">
              <PackageOpen className="h-7 w-7 text-ink-300" />
            </div>
            <div className="text-serif-cn text-[15px] font-semibold text-ink-700">该技师所在地区暂无可购商品</div>
            <div className="mt-1.5 text-[12px] text-ink-400">橱窗商品因国家/地区上架，敬请期待</div>
            <button type="button" onClick={() => router.back()} className="mt-5 rounded-full border border-warm-300 bg-white px-6 py-2 text-[13px] text-ink-600 active:bg-warm-50">返回</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {shopEntries.map(({ listing, item }) => {
              const soldOut = item.stockQty <= 0;
              const priceLabel = pointsToFiatLabel(item.pricePoints, defaultCurrencyCode, currencies);
              return (
                <button
                  key={listing.id}
                  type="button"
                  onClick={() => router.push(`/therapist/${id}/shop/${item.id}`)}
                  className="flex flex-col overflow-hidden rounded-2xl border border-warm-100 bg-white text-left shadow-warm-xs transition active:scale-[0.98] hover:border-warm-300"
                >
                  {/* 封面图 */}
                  <div className="relative aspect-square w-full overflow-hidden bg-warm-50">
                    {item.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center"><PackageOpen className="h-8 w-8 text-ink-200" /></div>
                    )}
                    {soldOut && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-ink-600">已售罄</span>
                      </div>
                    )}
                  </div>
                  {/* 信息区 */}
                  <div className="flex flex-1 flex-col p-3">
                    <div className="flex-1 text-[12.5px] font-semibold leading-snug text-ink-900 line-clamp-2">{item.title}</div>
                    {listing.therapistNote && (
                      <div className="mt-1 text-[10.5px] leading-4 text-ink-500 line-clamp-2">{listing.therapistNote}</div>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="num text-[14px] font-bold text-primary">{priceLabel}</span>
                      {item.soldCount > 0 && <span className="text-[9px] text-ink-400">{item.soldCount} 件已售</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
