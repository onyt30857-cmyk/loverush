/**
 * 技师选品管理 · M09a Task 9
 *
 * 两区：
 * - 「可选商品」：该技师所在国可售品 (GET /shop/me/available)，可加入橱窗
 * - 「我的橱窗」：已上架项 (GET /shop/me/listings)，可下架 / 改备注 / 调顺序
 *
 * hooks 必须全在 early return 之前无条件调用（规避 React #310）。
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TherapistShell } from '@/components/AppShell';
import { LoadingFull, Section } from '@/components/ui';
import { apiGet, apiPut, ApiClientError } from '@/lib/api';

// ──── 类型 ────────────────────────────────────────────────────────────

interface ShopItem {
  id: string;
  sku: string;
  title: string;
  description: string | null;
  category: string;
  pricePoints: number;
  commissionBpsDefault: number;
  coverUrl: string | null;
  stockQty: number;
  soldCount: number;
  countryCodes: string[];
}

interface Listing {
  id: string;
  therapistId: string;
  therapistUserId: string;
  shopItemId: string;
  displayOrder: number;
  therapistNote: string | null;
  commissionBpsOverride: number | null;
  soldCount: number;
  isActive: number;
  createdAt: string;
}

interface ListingRow {
  listing: Listing;
  item: ShopItem;
}

interface AvailableMeta {
  countryCode?: string;
  noCity?: boolean;
}

// ──── 页面主体 ────────────────────────────────────────────────────────

export default function TherapistShopPage() {
  // ── state（全部在 early return 之前，无条件声明）──
  const [available, setAvailable] = useState<ShopItem[]>([]);
  const [availMeta, setAvailMeta] = useState<AvailableMeta>({});
  const [myListings, setMyListings] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null); // shopItemId being saved
  // 编辑备注
  const [editNote, setEditNote] = useState<{ shopItemId: string; note: string } | null>(null);
  const [noteInput, setNoteInput] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const reload = useCallback(async () => {
    const [availRes, listRes] = await Promise.all([
      fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'}/shop/me/available`,
        { headers: { Authorization: `Bearer ${typeof window !== 'undefined' ? window.localStorage.getItem('access_token') : ''}` } },
      ).then((r) => r.json()) as Promise<{ data: ShopItem[]; meta?: AvailableMeta }>,
      apiGet<ListingRow[]>('/shop/me/listings').catch(() => [] as ListingRow[]),
    ]);
    setAvailable(availRes.data ?? []);
    setAvailMeta(availRes.meta ?? {});
    setMyListings(Array.isArray(listRes) ? listRes : []);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await reload();
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

  // ── early return（loading）── all hooks above ──
  if (loading) return <TherapistShell title="我的橱窗" showBack><LoadingFull /></TherapistShell>;

  // ── 无服务城市兜底 ──
  if (availMeta.noCity) {
    return (
      <TherapistShell title="我的橱窗" showBack>
        <div className="px-5 py-16 text-center space-y-4">
          <div className="text-4xl">📦</div>
          <div className="text-[15px] font-semibold text-ink-800">请先设置服务城市</div>
          <div className="text-[12px] text-ink-500 leading-5">
            系统需要知道你的服务城市才能为你过滤可售商品，<br />
            避免上架无法在当地发货的商品。
          </div>
          <Link
            href="/t/me/profile"
            className="inline-block rounded-full bg-gradient-cta px-6 py-2.5 text-[13px] font-semibold text-white shadow-rose-md active:scale-95"
          >
            去完善档案 →
          </Link>
        </div>
      </TherapistShell>
    );
  }

  // ── 已上架的 shopItemId 集合（用于标记「已在橱窗」）──
  const activeItemIds = new Set(
    myListings.filter((r) => r.listing.isActive === 1).map((r) => r.listing.shopItemId),
  );
  const listedItemIds = new Set(myListings.map((r) => r.listing.shopItemId));

  // ── 上架商品 ──
  async function handleAddListing(item: ShopItem) {
    setSaving(item.id);
    try {
      await apiPut('/shop/me/listings', {
        shop_item_id: item.id,
        is_active: true,
        display_order: 0,
      });
      await reload();
      showToast(`「${item.title}」已加入橱窗`);
    } catch (err) {
      showToast(err instanceof ApiClientError ? err.payload.message : '操作失败');
    } finally {
      setSaving(null);
    }
  }

  // ── 下架 / 重新上架 ──
  async function handleToggleActive(row: ListingRow) {
    const next = row.listing.isActive === 1 ? false : true;
    const label = next ? '重新上架' : '下架';
    setSaving(row.listing.shopItemId);
    // 乐观更新
    setMyListings((prev) =>
      prev.map((r) =>
        r.listing.shopItemId === row.listing.shopItemId
          ? { ...r, listing: { ...r.listing, isActive: next ? 1 : 0 } }
          : r,
      ),
    );
    try {
      await apiPut('/shop/me/listings', {
        shop_item_id: row.listing.shopItemId,
        is_active: next,
        display_order: row.listing.displayOrder,
        therapist_note: row.listing.therapistNote ?? undefined,
      });
      showToast(`已${label}「${row.item.title}」`);
    } catch (err) {
      // 回滚乐观更新
      await reload();
      showToast(err instanceof ApiClientError ? err.payload.message : `${label}失败`);
    } finally {
      setSaving(null);
    }
  }

  // ── 调整顺序 ──
  async function handleOrderChange(row: ListingRow, newOrder: number) {
    setSaving(row.listing.shopItemId);
    setMyListings((prev) =>
      prev.map((r) =>
        r.listing.shopItemId === row.listing.shopItemId
          ? { ...r, listing: { ...r.listing, displayOrder: newOrder } }
          : r,
      ),
    );
    try {
      await apiPut('/shop/me/listings', {
        shop_item_id: row.listing.shopItemId,
        is_active: row.listing.isActive === 1,
        display_order: newOrder,
        therapist_note: row.listing.therapistNote ?? undefined,
      });
    } catch {
      await reload();
      showToast('顺序调整失败');
    } finally {
      setSaving(null);
    }
  }

  // ── 保存备注 ──
  async function handleSaveNote() {
    if (!editNote) return;
    setSaving(editNote.shopItemId);
    const row = myListings.find((r) => r.listing.shopItemId === editNote.shopItemId);
    if (!row) { setSaving(null); setEditNote(null); return; }
    setMyListings((prev) =>
      prev.map((r) =>
        r.listing.shopItemId === editNote.shopItemId
          ? { ...r, listing: { ...r.listing, therapistNote: noteInput || null } }
          : r,
      ),
    );
    try {
      await apiPut('/shop/me/listings', {
        shop_item_id: editNote.shopItemId,
        is_active: row.listing.isActive === 1,
        display_order: row.listing.displayOrder,
        therapist_note: noteInput || undefined,
      });
      showToast('备注已保存');
    } catch {
      await reload();
      showToast('保存失败');
    } finally {
      setSaving(null);
      setEditNote(null);
    }
  }

  // ──────────────────────────────────────────────────────
  return (
    <TherapistShell title="我的橱窗" showBack>
      {toast && (
        <div className="sticky top-0 z-20 mx-3 mt-2 rounded-xl border border-success-500/30 bg-success-500/5 px-3 py-2 text-[12px] text-success-500 shadow-warm-sm">
          {toast}
        </div>
      )}

      {/* 引导说明 */}
      <div className="mx-3 mt-3 rounded-2xl border border-primary-100 bg-gradient-to-br from-primary-50/60 to-warm-50/60 p-4">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-primary-700">
          <span>🛍️</span><span>橱窗带货</span>
          {availMeta.countryCode && (
            <span className="ml-auto rounded-full bg-white/80 px-2 py-0.5 text-[10px] text-ink-500">
              {availMeta.countryCode} 可售商品
            </span>
          )}
        </div>
        <div className="mt-1.5 text-[11.5px] leading-5 text-ink-600">
          选品上架后客户在你的页面可购买 · 每笔成交你拿平台佣金。
          仅展示你所在国家可发货的商品。
        </div>
      </div>

      {/* ── 区块一：可选商品 ── */}
      <Section title="可选商品" subtitle={`AVAILABLE · ${available.length} 款`}>
        {available.length === 0 ? (
          <div className="rounded-xl border border-dashed border-warm-200 bg-warm-50 px-3 py-6 text-center text-[12px] text-ink-500">
            暂无可售商品 · 管理员会持续上新
          </div>
        ) : (
          <div className="space-y-2">
            {available.map((item) => {
              const isListed = listedItemIds.has(item.id);
              const isActive = activeItemIds.has(item.id);
              const isSavingThis = saving === item.id;
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-2xl border border-warm-100 bg-white p-3 shadow-warm-xs"
                >
                  {item.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.coverUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-xl object-cover bg-warm-100"
                    />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-warm-100 text-2xl">
                      📦
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-ink-800">{item.title}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="rounded-full bg-ink-50 px-2 py-0.5 text-[10px] text-ink-500">
                        {item.category}
                      </span>
                      <span className="text-[11px] font-medium text-primary">
                        {item.pricePoints} 积分
                      </span>
                      <span className="text-[10px] text-ink-400">
                        佣金 {((item.commissionBpsDefault / 10000) * 100).toFixed(0)}%
                      </span>
                    </div>
                    {item.description && (
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-ink-500">
                        {item.description}
                      </div>
                    )}
                    <div className="mt-0.5 text-[10px] text-ink-400">
                      库存 {item.stockQty} · 已售 {item.soldCount}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {isActive ? (
                      <span className="inline-block rounded-full bg-success-500/10 px-2.5 py-1 text-[11px] font-medium text-success-500">
                        已在橱窗
                      </span>
                    ) : isListed ? (
                      <button
                        type="button"
                        disabled={isSavingThis}
                        onClick={() => void handleAddListing(item)}
                        className="rounded-full border border-primary bg-white px-2.5 py-1 text-[11px] font-medium text-primary active:bg-primary/5 disabled:opacity-50"
                      >
                        {isSavingThis ? '加入中…' : '重新上架'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isSavingThis}
                        onClick={() => void handleAddListing(item)}
                        className="rounded-full bg-gradient-cta px-2.5 py-1 text-[11px] font-medium text-white shadow-rose-sm active:scale-95 disabled:opacity-50"
                      >
                        {isSavingThis ? '加入中…' : '加入橱窗'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── 区块二：我的橱窗 ── */}
      <Section title="我的橱窗" subtitle={`MY LISTINGS · ${myListings.length} 件`}>
        {myListings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-warm-200 bg-warm-50 px-3 py-6 text-center text-[12px] text-ink-500">
            还没有上架商品 · 从上方选品加入橱窗
          </div>
        ) : (
          <div className="space-y-2">
            {myListings.map((row) => {
              const { listing, item } = row;
              const isSavingThis = saving === listing.shopItemId;
              const isActiveRow = listing.isActive === 1;
              const effectiveBps = listing.commissionBpsOverride ?? item.commissionBpsDefault;
              return (
                <div
                  key={listing.id}
                  className={`rounded-2xl border border-warm-100 bg-white p-3 shadow-warm-xs transition ${
                    !isActiveRow ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {item.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.coverUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-xl object-cover bg-warm-100"
                      />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warm-100 text-xl">
                        📦
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-ink-800">{item.title}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            isActiveRow
                              ? 'bg-success-500/10 text-success-500'
                              : 'bg-ink-100 text-ink-500'
                          }`}
                        >
                          {isActiveRow ? '上架中' : '已下架'}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-500">
                        <span>{item.pricePoints} 积分</span>
                        <span>·</span>
                        <span>佣金 {((effectiveBps / 10000) * 100).toFixed(0)}%</span>
                        <span>·</span>
                        <span>已售 {listing.soldCount}</span>
                      </div>
                    </div>
                  </div>

                  {/* 备注展示 */}
                  {listing.therapistNote && editNote?.shopItemId !== listing.shopItemId && (
                    <div className="mt-2 text-[11px] text-ink-600 bg-warm-50 rounded-xl px-2.5 py-1.5">
                      💬 {listing.therapistNote}
                    </div>
                  )}

                  {/* 备注编辑区 */}
                  {editNote?.shopItemId === listing.shopItemId && (
                    <div className="mt-2 space-y-1.5">
                      <textarea
                        value={noteInput}
                        onChange={(e) => setNoteInput(e.target.value)}
                        rows={2}
                        maxLength={200}
                        placeholder="给客户看的备注（选填，最多 200 字）"
                        className="w-full rounded-xl border border-warm-200 bg-warm-50 px-3 py-2 text-[12px] text-ink-800 outline-none focus:border-primary"
                      />
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditNote(null)}
                          className="flex-1 rounded-full border border-warm-300 bg-white py-1 text-[11px] text-warm-700 active:bg-warm-50"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          disabled={isSavingThis}
                          onClick={() => void handleSaveNote()}
                          className="flex-1 rounded-full bg-gradient-cta py-1 text-[11px] font-medium text-white disabled:opacity-50"
                        >
                          {isSavingThis ? '保存中…' : '保存备注'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 操作栏 */}
                  <div className="mt-2.5 flex items-center gap-1.5">
                    {/* 排序 */}
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-ink-400">顺序</span>
                      <input
                        type="number"
                        value={listing.displayOrder}
                        min={0}
                        max={1000}
                        disabled={isSavingThis}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(1000, parseInt(e.target.value, 10) || 0));
                          void handleOrderChange(row, v);
                        }}
                        className="num w-14 rounded-lg border border-warm-200 bg-warm-50 px-2 py-1 text-center text-[11px] text-ink-700 outline-none focus:border-primary disabled:opacity-50"
                      />
                    </div>

                    {/* 备注按钮 */}
                    {editNote?.shopItemId !== listing.shopItemId && (
                      <button
                        type="button"
                        onClick={() => {
                          setNoteInput(listing.therapistNote ?? '');
                          setEditNote({ shopItemId: listing.shopItemId, note: listing.therapistNote ?? '' });
                        }}
                        className="rounded-full border border-warm-200 px-2.5 py-1 text-[11px] text-ink-600 active:bg-warm-50"
                      >
                        {listing.therapistNote ? '改备注' : '加备注'}
                      </button>
                    )}

                    {/* 上架 / 下架切换 */}
                    <button
                      type="button"
                      disabled={isSavingThis}
                      onClick={() => void handleToggleActive(row)}
                      className={`ml-auto rounded-full px-3 py-1 text-[11px] font-medium transition disabled:opacity-50 ${
                        isActiveRow
                          ? 'border border-warning-500/40 text-warning-600 active:bg-warning-50'
                          : 'border border-success-500/40 text-success-600 active:bg-success-50'
                      }`}
                    >
                      {isSavingThis ? '操作中…' : isActiveRow ? '下架' : '重新上架'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <div className="h-8" />
    </TherapistShell>
  );
}
