'use client';

import { useEffect, useState, useCallback } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface OrderRow {
  id: string;
  orderNo: string;
  customerId: string;
  customerName: string | null;
  therapistUserId: string;
  therapistName: string | null;
  status: string;
  pricePoints: number;
  durationMin: number;
  disputeOpenedAt: string | null;
  disputeReason: string | null;
  refundPoints: number | null;
  createdAt: string;
  // 0027 法币模型 · 老积分订单字段为 null
  currencyCode: string | null;
  totalFiat: string | null;
  depositPoints: number | null;
  depositStatus: string | null;
  offlinePaidAt: string | null;
  // 地区 / 金额 / 支付 / 评价(后端 join + 派生)
  therapistCountryCode: string | null;
  therapistCityName: string | null;
  therapistAreaName: string | null;
  customerRating: number | null;
  paymentState: 'offline_paid' | 'online_paid' | 'unpaid';
  amountLabel: string;
  isLegacyPoints: boolean;
  fiatEstimated: boolean;
  // 异常单监控模式额外字段
  alertType?: string;
  hoursStuck?: number;
}

interface OrderDetail extends OrderRow {
  serviceSkills: string[];
  customerReview: string | null;
  paymentTxnId: string | null;
  priceLockedAt: string | null;
  paidAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  reviewedAt: string | null;
  refundedAt: string | null;
}

interface OrdersSummary {
  total: number;
  byStatus: Record<string, number>;
  completed: number;
  completionRate: number;
  cancelled: number;
  disputed: number;
  disputeRate: number;
  gmvByCurrency: Array<{ code: string; sum: number; label: string; count: number }>;
  legacyPointsGmv: number;
  depositHeldPoints: number;
  reviewedCount: number;
  avgRating: number | null;
}

interface CountryOpt { country: string; flag: string; label: string }
interface CityOpt { id: string; name: string }
interface CurrencyOpt { code: string; symbol: string; nameZh: string; decimals: number }

const ALERT_TYPE_LABEL: Record<string, string> = {
  dispute_pending: '争议待处理',
  pending_confirm: '待确认即将超时',
  locked_unpaid: '锁价后久未付款',
  paid_no_start: '已付款久未开始',
  deposit_overdue: '心动金超期未流转',
};

const DEPOSIT_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  HOLDING: { label: '冻结中', color: 'bg-blue-100 text-blue-700' },
  RELEASED: { label: '已退还', color: 'bg-green-100 text-green-700' },
  FORFEITED_TO_THERAPIST: { label: '判技师', color: 'bg-orange-100 text-orange-700' },
  FORFEITED_TO_PLATFORM: { label: '判平台', color: 'bg-red-100 text-red-700' },
  REFUNDED: { label: '全退', color: 'bg-gray-100 text-gray-700' },
};

const PAYMENT_STATE_LABEL: Record<string, { label: string; color: string }> = {
  offline_paid: { label: '已收(线下)', color: 'bg-green-100 text-green-700' },
  online_paid: { label: '已付(线上)', color: 'bg-blue-100 text-blue-700' },
  unpaid: { label: '未收', color: 'bg-ink-100 text-ink-500' },
};

// 国家 code → 国旗(前端展示,后端只回 countryCode)
const COUNTRY_FLAG: Record<string, string> = {
  TH: '🇹🇭', MY: '🇲🇾', VN: '🇻🇳', ID: '🇮🇩', CN: '🇨🇳',
};

const STATUS_OPTIONS = [
  'DRAFT',
  'PENDING_CONFIRM',
  'LOCKED',
  'PAID',
  'IN_SERVICE',
  'COMPLETED',
  'REVIEWED',
  'CANCELLED',
  'DISPUTED',
  'REFUNDED',
  'CLOSED',
] as const;

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  PENDING_CONFIRM: '待技师确认',
  LOCKED: '已锁价待付',
  PAID: '已支付',
  IN_SERVICE: '服务中',
  COMPLETED: '已完成',
  REVIEWED: '已评价',
  CANCELLED: '已取消',
  DISPUTED: '争议中',
  REFUNDED: '已退款',
  CLOSED: '已关闭',
};

const STATUS_COLOR: Record<string, string> = {
  DISPUTED: 'bg-red-100 text-red-700',
  REFUNDED: 'bg-orange-100 text-orange-700',
  CANCELLED: 'bg-ink-100 text-ink-600',
  CLOSED: 'bg-ink-100 text-ink-500',
  COMPLETED: 'bg-green-100 text-green-700',
  REVIEWED: 'bg-green-100 text-green-700',
  PAID: 'bg-blue-100 text-blue-700',
  IN_SERVICE: 'bg-blue-100 text-blue-700',
};

const PAGE_SIZE = 50;

function depositChip(status: string | null) {
  if (!status) return null;
  const d = DEPOSIT_STATUS_LABEL[status];
  if (!d) return null;
  return <span className={`rounded px-2 py-0.5 text-xs ${d.color}`}>{d.label}</span>;
}

function fmtMoney(amount: number, code: string, map: Record<string, CurrencyOpt>): string {
  const c = map[code];
  const sym = c?.symbol ?? code;
  const dec = c?.decimals ?? 2;
  return sym + amount.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtTime(s: string | null): string {
  return s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function regionLabel(o: OrderRow): string {
  const flag = o.therapistCountryCode ? COUNTRY_FLAG[o.therapistCountryCode] ?? '🌍' : '';
  const parts = [o.therapistCityName, o.therapistAreaName].filter(Boolean);
  if (parts.length === 0) return flag ? `${flag} 未设区域` : '未设区域';
  return `${flag} ${parts.join('·')}`;
}

export default function OrdersPage() {
  const [list, setList] = useState<OrderRow[]>([]);
  const [summary, setSummary] = useState<OrdersSummary | null>(null);
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [cityId, setCityId] = useState('');
  const [currencyCode, setCurrencyCode] = useState('');
  const [paidState, setPaidState] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState<'refund_full' | 'refund_partial' | 'reject'>('refund_full');
  const [refundPoints, setRefundPoints] = useState('');
  const [resolveNote, setResolveNote] = useState('');
  const [disputedOnly, setDisputedOnly] = useState(false);
  const [alertsMode, setAlertsMode] = useState(false);
  const [chain, setChain] = useState<Array<{ seq: number; event: string; actorRole: string | null; createdAt: string }>>([]);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  // 筛选下拉数据
  const [countries, setCountries] = useState<CountryOpt[]>([]);
  const [cities, setCities] = useState<CityOpt[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOpt[]>([]);

  const currencyMap: Record<string, CurrencyOpt> = Object.fromEntries(currencies.map((c) => [c.code, c]));

  // 公共筛选参数(list + summary 共用)
  const filterParams = useCallback(
    () => ({
      status: disputedOnly ? 'DISPUTED' : status || undefined,
      search: search || undefined,
      country: country || undefined,
      city_id: cityId || undefined,
      currency_code: currencyCode || undefined,
      paid_state: paidState || undefined,
      created_from: dateFrom || undefined,
      created_to: dateTo ? dateTo + 'T23:59:59' : undefined,
    }),
    [status, search, country, cityId, currencyCode, paidState, dateFrom, dateTo, disputedOnly],
  );

  const load = useCallback(async () => {
    try {
      if (alertsMode) {
        const rows = await api.get<Array<{ id: string; orderNo: string; status: string; depositStatus: string | null; customerName: string | null; therapistName: string | null; alertType: string; hoursStuck: number; createdAt: string }>>('/admin/orders/alerts');
        setSummary(null);
        setList(rows.map((r) => ({
          ...r, customerId: '', therapistUserId: '', pricePoints: 0, durationMin: 0,
          disputeOpenedAt: null, disputeReason: null, refundPoints: null,
          currencyCode: null, totalFiat: null, depositPoints: null, offlinePaidAt: null,
          therapistCountryCode: null, therapistCityName: null, therapistAreaName: null,
          customerRating: null, paymentState: 'unpaid' as const,
          amountLabel: '—', isLegacyPoints: false, fiatEstimated: false,
        })));
        return;
      }
      const params = filterParams();
      const [rows, sum] = await Promise.all([
        api.get<OrderRow[]>('/admin/orders', { ...params, limit: PAGE_SIZE, offset }),
        api.get<OrdersSummary>('/admin/orders/summary', params),
      ]);
      setList(rows);
      setSummary(sum);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }, [filterParams, offset, alertsMode]);

  useEffect(() => {
    void load();
  }, [load]);

  // 筛选变化(非翻页)回到第一页
  useEffect(() => {
    setOffset(0);
  }, [status, country, cityId, currencyCode, paidState, dateFrom, dateTo, disputedOnly, alertsMode]);

  // 加载筛选下拉数据(一次)
  useEffect(() => {
    void (async () => {
      try {
        const [co, cu] = await Promise.all([
          api.get<CountryOpt[]>('/geo/countries').catch(() => []),
          api.get<CurrencyOpt[]>('/currencies').catch(() => []),
        ]);
        setCountries(co);
        setCurrencies(cu);
      } catch {
        /* 下拉数据失败不阻断主列表 */
      }
    })();
  }, []);

  // 国家变 → 拉该国城市
  useEffect(() => {
    setCityId('');
    if (!country) {
      setCities([]);
      return;
    }
    void api
      .get<CityOpt[]>('/geo/cities', { country })
      .then(setCities)
      .catch(() => setCities([]));
  }, [country]);

  async function openDetail(id: string) {
    try {
      const [d, ch] = await Promise.all([
        api.get<OrderDetail>(`/admin/orders/${id}`),
        api.get<Array<{ seq: number; event: string; actorRole: string | null; createdAt: string }>>(`/admin/orders/${id}/chain`).catch(() => []),
      ]);
      setDetail(d);
      setChain(ch);
      setCancelReason('');
      setResolution('refund_full');
      setRefundPoints('');
      setResolveNote('');
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  // 终态:不可再强制取消
  const TERMINAL = ['CANCELLED', 'REFUNDED', 'CLOSED', 'COMPLETED', 'REVIEWED'];
  async function forceCancel() {
    if (!detail || !cancelReason.trim()) return;
    setCancelling(true);
    try {
      await api.post(`/admin/orders/${detail.id}/cancel`, { reason: cancelReason.trim() });
      setDetail(null);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setCancelling(false);
    }
  }

  async function resolve() {
    if (!detail) return;
    if (!resolveNote.trim()) return;
    setResolving(true);
    try {
      const body: Record<string, unknown> = { resolution, note: resolveNote.trim() };
      if (resolution === 'refund_partial') {
        const n = parseInt(refundPoints, 10);
        if (!Number.isFinite(n) || n <= 0) {
          setError('部分退款需填积分数');
          setResolving(false);
          return;
        }
        body.refund_points = n;
      }
      await api.post(`/admin/orders/${detail.id}/resolve`, body);
      setDetail(null);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setResolving(false);
    }
  }

  const gmv0 = summary?.gmvByCurrency[0] ?? null;

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">订单管理</h1>
        <div className="text-sm text-ink-500">
          {summary ? `共 ${summary.total} 单` : `${list.length} 单`}
          {summary && summary.disputed > 0 && (
            <span className="ml-3 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">争议 {summary.disputed}</span>
          )}
        </div>
      </div>

      {/* 运营指标卡(跟随筛选) */}
      {!alertsMode && summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Kpi label="订单总数" value={summary.total} />
          <Kpi label="完成" value={summary.completed} sub={`完成率 ${summary.completionRate}%`} />
          <Kpi label="争议" value={summary.disputed} sub={`争议率 ${summary.disputeRate}%`} accent={summary.disputed > 0} />
          <Kpi
            label={`GMV${gmv0 ? ` · ${gmv0.code}` : ''}`}
            value={gmv0 ? gmv0.label : '—'}
            sub={
              gmv0
                ? `${gmv0.count}单${summary.gmvByCurrency.length > 1 ? ` +${summary.gmvByCurrency.length - 1}币种` : ''}`
                : summary.legacyPointsGmv > 0
                  ? `${summary.legacyPointsGmv.toLocaleString()} 积分(旧制)`
                  : '暂无成交'
            }
            accent
          />
          <Kpi
            label="客单价"
            value={gmv0 && gmv0.count > 0 ? fmtMoney(gmv0.sum / gmv0.count, gmv0.code, currencyMap) : '—'}
          />
          <Kpi label="心动金冻结中" value={`${summary.depositHeldPoints.toLocaleString()}`} sub="积分" />
          <Kpi
            label="平均评分"
            value={summary.avgRating != null ? `★ ${summary.avgRating}` : '—'}
            sub={`${summary.reviewedCount} 条评价`}
          />
        </div>
      )}

      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={alertsMode} onChange={(e) => setAlertsMode(e.target.checked)} />
            <span className="font-medium text-orange-600">⚠ 异常单监控</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={disputedOnly}
              onChange={(e) => setDisputedOnly(e.target.checked)}
              disabled={alertsMode}
            />
            <span className="text-red-600">仅看争议中</span>
          </label>
          <select className="input w-36" value={status} onChange={(e) => setStatus(e.target.value)} disabled={disputedOnly || alertsMode}>
            <option value="">所有状态</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select className="input w-32" value={country} onChange={(e) => setCountry(e.target.value)} disabled={alertsMode}>
            <option value="">所有国家</option>
            {countries.map((c) => (
              <option key={c.country} value={c.country}>
                {c.flag} {c.label}
              </option>
            ))}
          </select>
          <select className="input w-32" value={cityId} onChange={(e) => setCityId(e.target.value)} disabled={alertsMode || !country}>
            <option value="">{country ? '所有城市' : '先选国家'}</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="input w-28" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} disabled={alertsMode}>
            <option value="">所有币种</option>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.symbol} {c.code}
              </option>
            ))}
          </select>
          <select className="input w-28" value={paidState} onChange={(e) => setPaidState(e.target.value)} disabled={alertsMode}>
            <option value="">收款不限</option>
            <option value="paid">已收款</option>
            <option value="unpaid">未收款</option>
          </select>
          <input type="date" className="input w-36" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} disabled={alertsMode} title="创建起" />
          <input type="date" className="input w-36" value={dateTo} onChange={(e) => setDateTo(e.target.value)} disabled={alertsMode} title="创建止" />
          <input
            className="input min-w-[160px] flex-1"
            placeholder="搜订单号 / 客户名 / 技师名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
            disabled={alertsMode}
          />
          <button type="button" onClick={() => void load()} className="btn-primary">
            搜索
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>订单号</th>
              <th>地区</th>
              <th>客户 → 技师</th>
              <th>金额(法币)</th>
              <th>状态</th>
              <th>支付</th>
              <th>创建时间</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-ink-500">
                  没有符合条件的订单
                </td>
              </tr>
            )}
            {list.map((o) => (
              <tr key={o.id} className={o.status === 'DISPUTED' ? 'bg-red-50/50' : ''}>
                <td className="font-mono text-xs">{o.orderNo}</td>
                <td className="text-xs">{alertsMode ? '—' : regionLabel(o)}</td>
                <td className="text-xs">
                  <span className="text-ink-700">{o.customerName ?? '—'}</span>
                  <span className="text-ink-300"> → </span>
                  <span className="text-ink-700">{o.therapistName ?? '—'}</span>
                </td>
                <td className="text-xs">
                  {alertsMode ? (
                    '—'
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="font-medium">{o.amountLabel}</span>
                      {o.isLegacyPoints && (
                        <span className="rounded bg-ink-100 px-1 text-[9px] text-ink-400">旧制</span>
                      )}
                      {o.fiatEstimated && !o.isLegacyPoints && (
                        <span className="rounded bg-amber-50 px-1 text-[9px] text-amber-500">估算</span>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLOR[o.status] ?? 'bg-ink-100 text-ink-700'}`}>
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                  {o.alertType && (
                    <div className="mt-1 text-[10px] font-medium text-orange-600">
                      {ALERT_TYPE_LABEL[o.alertType] ?? o.alertType} · 卡 {o.hoursStuck}h
                    </div>
                  )}
                </td>
                <td className="text-xs">
                  {alertsMode ? (
                    '—'
                  ) : (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${PAYMENT_STATE_LABEL[o.paymentState]?.color}`}>
                      {PAYMENT_STATE_LABEL[o.paymentState]?.label ?? o.paymentState}
                    </span>
                  )}
                </td>
                <td className="text-xs">{fmtTime(o.createdAt)}</td>
                <td className="text-right">
                  <button type="button" onClick={() => void openDetail(o.id)} className="btn-ghost h-7 px-3 text-xs">
                    详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 分页(非异常单模式) */}
        {!alertsMode && (offset > 0 || list.length >= PAGE_SIZE) && (
          <div className="flex items-center justify-end gap-2 border-t border-ink-100 px-3 py-2 text-xs">
            <span className="text-ink-400">第 {offset + 1}–{offset + list.length} 条</span>
            <button
              type="button"
              className="btn-ghost h-7 px-3"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              上一页
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-3"
              disabled={list.length < PAGE_SIZE}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              下一页
            </button>
          </div>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="card max-h-[88vh] w-full max-w-2xl overflow-y-auto">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">订单 {detail.orderNo}</h3>
                <div className="mt-1 font-mono text-xs text-ink-500">{detail.id}</div>
              </div>
              <span className={`rounded px-2.5 py-1 text-xs ${STATUS_COLOR[detail.status] ?? 'bg-ink-100'}`}>
                {STATUS_LABEL[detail.status] ?? detail.status}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="客户" value={detail.customerName ?? '—'} sub={detail.customerId ? detail.customerId.slice(0, 12) + '…' : undefined} />
              <Info label="技师" value={detail.therapistName ?? '—'} sub={detail.therapistUserId ? detail.therapistUserId.slice(0, 12) + '…' : undefined} />
              <Info label="地区" value={regionLabel(detail)} />
              <Info
                label={detail.isLegacyPoints ? '金额(旧积分制)' : '金额(法币·线下当面收)'}
                value={detail.amountLabel}
                sub={detail.fiatEstimated && !detail.isLegacyPoints ? '按当前汇率估算' : undefined}
              />
              <Info label="服务" value={detail.serviceSkills.join(' · ') || '—'} />
              <Info label="时长" value={`${detail.durationMin} 分钟`} />
              {detail.depositPoints != null && (
                <div className="rounded-lg bg-ink-50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-ink-400">心动金(保证金)</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="text-sm font-medium text-ink-900">{detail.depositPoints.toLocaleString()} 积分</span>
                    {depositChip(detail.depositStatus)}
                  </div>
                </div>
              )}
              {detail.customerRating != null && (
                <Info label="客户评价" value={`★ ${detail.customerRating}`} sub={detail.customerReview ?? undefined} />
              )}
              {detail.paymentTxnId && <Info label="支付凭证" value={detail.paymentTxnId} />}
              {detail.refundPoints ? <Info label="已退款" value={`${detail.refundPoints.toLocaleString()} 积分`} /> : null}
            </div>

            {/* 关键时间线 */}
            <div className="mt-4">
              <div className="mb-2 text-sm font-semibold">关键时间</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-ink-50 p-3 text-xs text-ink-600 md:grid-cols-3">
                <TimeItem label="创建" value={detail.createdAt} />
                <TimeItem label="锁价" value={detail.priceLockedAt} />
                <TimeItem label="线上支付" value={detail.paidAt} />
                <TimeItem label="线下收款" value={detail.offlinePaidAt} />
                <TimeItem label="开始服务" value={detail.startedAt} />
                <TimeItem label="完成" value={detail.completedAt} />
                <TimeItem label="评价" value={detail.reviewedAt} />
                <TimeItem label="退款" value={detail.refundedAt} />
              </div>
            </div>

            {detail.status === 'DISPUTED' && (
              <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
                <div className="mb-2 text-sm font-semibold text-red-800">争议详情</div>
                <div className="mb-3 text-sm text-red-700">
                  开启时间:{detail.disputeOpenedAt ? new Date(detail.disputeOpenedAt).toLocaleString('zh-CN') : '—'}
                  <br />
                  原因:{detail.disputeReason ?? '—'}
                </div>

                <div className="mb-2 text-sm font-semibold">仲裁裁决</div>
                <div className="mb-2 grid grid-cols-3 gap-2">
                  {(['refund_full', 'refund_partial', 'reject'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setResolution(r)}
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        resolution === r ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-ink-200 bg-white'
                      }`}
                    >
                      {r === 'refund_full' ? '全额退款' : r === 'refund_partial' ? '部分退款' : '驳回'}
                    </button>
                  ))}
                </div>
                {resolution === 'refund_partial' && (
                  <input
                    type="number"
                    className="input mb-2 w-full"
                    placeholder={`退款积分(心动金 ${detail.depositPoints?.toLocaleString() ?? detail.pricePoints.toLocaleString()})`}
                    value={refundPoints}
                    onChange={(e) => setRefundPoints(e.target.value)}
                  />
                )}
                <textarea
                  className="mb-3 h-20 w-full rounded-lg border border-ink-200 p-3 text-sm"
                  placeholder="仲裁说明(双方可见)"
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => void resolve()}
                  disabled={resolving || !resolveNote.trim()}
                  className={resolution === 'reject' ? 'btn-danger w-full' : 'btn-primary w-full'}
                >
                  确认裁决
                </button>
              </div>
            )}

            {/* 订单时间线(凭证链) */}
            {chain.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 text-sm font-semibold">凭证链</div>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-ink-50 p-3">
                  {chain.map((e) => (
                    <div key={e.seq} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-ink-400">{e.seq}</span>
                      <span className="font-medium text-ink-800">{e.event}</span>
                      {e.actorRole && <span className="rounded bg-ink-200 px-1.5 text-[10px] text-ink-600">{e.actorRole}</span>}
                      <span className="ml-auto text-[10px] text-ink-400">{fmtTime(e.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* admin 强制取消(非终态)· 退还冻结心动金 */}
            {!TERMINAL.includes(detail.status) && (
              <div className="mt-5 rounded-lg border border-orange-200 bg-orange-50 p-4">
                <div className="mb-2 text-sm font-semibold text-orange-800">强制取消订单</div>
                <div className="mb-2 text-xs text-orange-700">取消后订单置为已取消，冻结的心动金全额退还客户。用于卡住/异常订单干预。</div>
                <input
                  className="input mb-2 w-full"
                  placeholder="取消原因(必填，记入审计)"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => void forceCancel()}
                  disabled={cancelling || !cancelReason.trim()}
                  className="btn-danger w-full"
                >
                  {cancelling ? '取消中…' : '强制取消并退款'}
                </button>
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setDetail(null)} className="btn-ghost">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-rose-200 bg-gradient-to-br from-rose-50 to-white' : 'border-ink-100 bg-white'}`}>
      <div className="text-[11px] text-ink-500">{label}</div>
      <div className="mt-1 truncate text-xl font-bold text-ink-900">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-ink-400">{sub}</div>}
    </div>
  );
}

function Info({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-ink-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-ink-900">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-ink-400">{sub}</div>}
    </div>
  );
}

function TimeItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-400">{label}</span>
      <span className={value ? 'text-ink-700' : 'text-ink-300'}>{value ? fmtTime(value) : '—'}</span>
    </div>
  );
}
