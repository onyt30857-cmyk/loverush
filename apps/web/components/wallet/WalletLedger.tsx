'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

// 流水类型 → 中文标签(展示层,后端只回原始 type)
const TYPE_LABEL: Record<string, string> = {
  RECHARGE: '充值到账',
  PAYWALL_UNLOCK: '解锁内容',
  TIP_GIVE: '打赏',
  TIP_RECEIVE: '收到打赏',
  CHAT_SPEND: '陪聊消费',
  CHAT_EARN: '陪聊收入',
  SHOP_PURCHASE: '橱窗购买',
  SHOP_COMMISSION: '橱窗分成',
  INVITE_REWARD: '邀请奖励',
  WITHDRAW: '提现',
  REFUND: '退款',
  FROZEN: '订单冻结',
  UNFROZEN: '冻结退回',
  EXPIRED: '积分过期',
  ADJUSTMENT: '平台调整',
  AGENT_WHOLESALE: '代理进货',
  AGENT_SELL: '代理售出',
  AGENT_BUY: '购入积分',
  AGENT_REDEEM_OUT: '回收转出',
  AGENT_REDEEM_IN: '回收入库',
};
function typeLabel(t: string): string {
  return TYPE_LABEL[t] ?? t;
}

interface Wallet {
  balance: number;
  frozen: number;
  totalIn: number;
  totalOut: number;
}
interface Txn {
  id: string;
  type: string;
  direction: 'IN' | 'OUT';
  amount: number;
  balanceAfter: number;
  description: string | null;
  orderNo: string | null;
  createdAt: string;
}

const FILTERS: Array<{ k: '' | 'IN' | 'OUT'; label: string }> = [
  { k: '', label: '全部' },
  { k: 'IN', label: '收入' },
  { k: 'OUT', label: '支出' },
];

const PAGE = 20;

function dateKey(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today.getTime() - 86400000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return '今天';
  if (sameDay(d, y)) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function WalletLedger({ unit = '积分' }: { unit?: string }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [items, setItems] = useState<Txn[] | null>(null);
  const [dir, setDir] = useState<'' | 'IN' | 'OUT'>('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    apiGet<Wallet>('/me/wallet')
      .then(setWallet)
      .catch(() => setWallet({ balance: 0, frozen: 0, totalIn: 0, totalOut: 0 }));
  }, []);

  const loadPage = useCallback(async (off: number, d: '' | 'IN' | 'OUT', replace: boolean) => {
    const q: Record<string, string | number> = { limit: PAGE, offset: off };
    if (d) q.direction = d;
    const res = await apiGet<{ items: Txn[]; hasMore: boolean }>('/me/transactions', q).catch(() => ({
      items: [] as Txn[],
      hasMore: false,
    }));
    setHasMore(res.hasMore);
    setItems((prev) => (replace || !prev ? res.items : [...prev, ...res.items]));
  }, []);

  // 切换筛选 → 重置分页
  useEffect(() => {
    setItems(null);
    setOffset(0);
    void loadPage(0, dir, true);
  }, [dir, loadPage]);

  async function more() {
    if (loadingMore) return;
    setLoadingMore(true);
    const next = offset + PAGE;
    await loadPage(next, dir, false);
    setOffset(next);
    setLoadingMore(false);
  }

  // 按日期分组
  const groups: Array<{ key: string; rows: Txn[] }> = [];
  for (const t of items ?? []) {
    const k = dateKey(t.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.rows.push(t);
    else groups.push({ key: k, rows: [t] });
  }

  return (
    <div className="pb-8">
      {/* 余额卡 */}
      <div className="px-4 pt-4">
        <div className="overflow-hidden rounded-2xl bg-gradient-cta p-5 text-white shadow-rose-lg">
          <div className="label-cormorant text-[10px] text-white/80">BALANCE · 可用余额</div>
          <div className="mt-1 flex items-end gap-1.5">
            <div className="text-display text-4xl font-bold num">
              {wallet ? wallet.balance.toLocaleString() : '—'}
            </div>
            <div className="pb-1 text-[12px] text-white/80">{unit}</div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-white/15 pt-3 text-[11px] text-white/85">
            <span>
              冻结中{' '}
              <span className="text-display font-bold num">{wallet ? wallet.frozen.toLocaleString() : '—'}</span>
            </span>
            <span>
              累计入{' '}
              <span className="text-display font-bold num">{wallet ? wallet.totalIn.toLocaleString() : '—'}</span>
              {' · '}累计出{' '}
              <span className="text-display font-bold num">{wallet ? wallet.totalOut.toLocaleString() : '—'}</span>
            </span>
          </div>
        </div>
      </div>

      {/* 筛选 chip */}
      <div className="flex gap-2 px-4 pb-1 pt-4">
        {FILTERS.map((f) => (
          <button
            key={f.k || 'all'}
            type="button"
            onClick={() => setDir(f.k)}
            className={`rounded-full px-4 py-1.5 text-[13px] transition active:scale-95 ${
              dir === f.k ? 'bg-primary text-white' : 'bg-white text-ink-600 shadow-warm-xs'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 流水列表 */}
      {items === null ? (
        <div className="px-4 py-10 text-center text-[13px] text-ink-400">加载中…</div>
      ) : items.length === 0 ? (
        <div className="px-4 py-14 text-center">
          <div className="text-3xl">🧾</div>
          <div className="mt-2 text-[14px] text-ink-600">还没有流水</div>
          <div className="mt-1 text-[12px] text-ink-400">充值、消费、收入都会记在这里</div>
        </div>
      ) : (
        <div className="px-4">
          {groups.map((g) => (
            <div key={g.key} className="mt-4">
              <div className="mb-1.5 px-1 text-[11px] font-medium text-ink-400">{g.key}</div>
              <div className="overflow-hidden rounded-2xl bg-white shadow-warm-xs divide-y divide-warm-50">
                {g.rows.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] text-ink-800">{typeLabel(t.type)}</div>
                      <div className="mt-0.5 truncate text-[11px] text-ink-400">
                        {t.description || (t.orderNo ? `订单 ${t.orderNo}` : hhmm(t.createdAt))}
                        {t.description && t.orderNo ? ` · ${t.orderNo}` : ''}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className={`text-display text-[15px] font-bold num ${
                          t.direction === 'IN' ? 'text-success-500' : 'text-ink-800'
                        }`}
                      >
                        {t.direction === 'IN' ? '+' : '-'}
                        {t.amount.toLocaleString()}
                      </div>
                      <div className="mt-0.5 text-[10px] text-ink-300">余额 {t.balanceAfter.toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {hasMore && (
            <button
              type="button"
              onClick={() => void more()}
              className="mx-auto mt-5 block rounded-full bg-white px-6 py-2 text-[13px] text-ink-600 shadow-warm-xs transition active:scale-95"
            >
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
