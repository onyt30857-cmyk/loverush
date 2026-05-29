'use client';

// build-stamp 2026-05-30T01:00 强制 Next.js 重新编译此 module,绕 Railpack cache reuse

/**
 * 用户详情共享组件 · 客户 + 技师 一套数据,自动按 user_type 切换可见区块
 *
 * Tab 模式:
 *   档案    — 基础信息 + 状态 + 角色 + 积分账户 + (技师)资料完整度/真人核验
 *   订单    — 最近 20 单 + 聚合(总数/支付/完成/争议/退款 + 累计积分)
 *   流水    — 最近 30 条积分流水(直接看资金动向)
 *   评价    — 客户:他写的;技师:他收到的(含申诉状态)
 *   工单    — 双向(作为投诉人 + 被投诉人)
 *   收益+   — 仅技师:therapist_earnings + 提现记录
 *   风控    — 仅技师:risk_events
 *
 * 客服动作:右上角下拉 — 暂停/封禁/解封 + 备注必填
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiClientError } from '@/lib/api';

interface UserDetail {
  user: {
    id: string;
    user_type: 'customer' | 'therapist' | 'admin' | 'agent';
    status: 'pending' | 'active' | 'suspended' | 'banned';
    display_name: string | null;
    avatar_url: string | null;
    locale: string;
    gender: string | null;
    created_at: string;
    last_active_at: string | null;
    banned_at: string | null;
  };
  points: { balance: number; frozen: number; total_in: number; total_out: number } | null;
  roles: Array<{ role: string; granted_at: string; revoked_at: string | null }>;
  therapist: null | {
    id: string;
    verification_status: string;
    profile_completeness: number;
    score_service: number | null;
    completed_orders: number;
    cooling_status: string;
    online_status: string;
    service_city: string | null;
    service_area: string | null;
    nationality: string | null;
  };
  order_summary: null | {
    total: number;
    paid: number;
    completed: number;
    cancelled: number;
    disputed: number;
    refunded: number;
    gross_points: number;
  };
  recent_orders: Array<{
    id: string;
    order_no: string;
    status: string;
    price_points: number;
    created_at: string;
    paid_at: string | null;
  }>;
  recent_transactions: Array<{
    id: string;
    type: string;
    direction: 'IN' | 'OUT';
    amount: number;
    balance_after: number;
    related_order_id: string | null;
    description: string | null;
    created_at: string;
  }>;
  tickets: Array<{
    id: string;
    ticket_no: string;
    status: string;
    category: string;
    reporter_user_id: string;
    target_user_id: string | null;
    opened_at: string;
    closed_at: string | null;
  }>;
  reviews: Array<{
    id: string;
    order_id: string;
    score_service: number;
    score_appearance: number | null;
    score_body: number | null;
    content: string | null;
    is_hidden: number;
    appeal_status: string | null;
    created_at: string;
  }>;
  earnings: null | {
    available_cents: number;
    pending_cents: number;
    withdrawn_cents: number;
    tip_earnings_cents: number;
    shop_commission_cents: number;
    invite_rewards_cents: number;
  };
  withdrawals: Array<{
    id: string;
    amount_cents: number;
    status: string;
    method: string;
    requested_at: string;
    paid_at: string | null;
  }>;
  risk_events: Array<{
    id: string;
    event_type: string;
    severity: number;
    resolution: string | null;
    created_at: string;
  }>;
}

type Tab = 'profile' | 'orders' | 'transactions' | 'reviews' | 'tickets' | 'earnings' | 'risk' | 'assistant' | 'media';

const STATUS_META: Record<UserDetail['user']['status'], { label: string; cls: string }> = {
  pending: { label: '待激活', cls: 'bg-ink-100 text-ink-700' },
  active: { label: '正常', cls: 'bg-green-100 text-green-700' },
  suspended: { label: '暂停', cls: 'bg-yellow-100 text-yellow-700' },
  banned: { label: '封禁', cls: 'bg-red-100 text-red-700' },
};

export function UserDetail({ userId, scope }: { userId: string; scope: 'customer' | 'therapist' }) {
  const router = useRouter();
  const [data, setData] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const [acting, setActing] = useState<'suspend' | 'ban' | 'restore' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<UserDetail>(`/admin/users/${userId}`);
      setData(d);
      setError(null);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String(err));
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function doAct() {
    if (!acting) return;
    if ((acting === 'suspend' || acting === 'ban') && !reason.trim()) return;
    setBusy(true);
    try {
      const body = acting === 'restore' ? undefined : { reason };
      await api.post(`/admin/users/${userId}/${acting}`, body);
      setActing(null);
      setReason('');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>;
  }
  if (!data) {
    return <div className="text-sm text-ink-500">加载中…</div>;
  }

  const isTherapist = data.user.user_type === 'therapist';
  const TABS: Array<{ key: Tab; label: string; badge?: number }> = [
    { key: 'profile', label: '档案' },
    { key: 'orders', label: '订单', badge: data.order_summary?.total },
    { key: 'transactions', label: '积分流水', badge: data.recent_transactions.length },
    { key: 'reviews', label: '评价', badge: data.reviews.length },
    { key: 'tickets', label: '工单', badge: data.tickets.length },
    // 客户专属:AI 助理记忆面板(M03 C1)
    ...(!isTherapist ? [{ key: 'assistant' as Tab, label: 'AI 助理记忆' }] : []),
    // 媒体库(技师 + 客户都可看 · T1)
    { key: 'media' as Tab, label: '媒体库' },
    ...(isTherapist ? [{ key: 'earnings' as Tab, label: '收益+提现', badge: data.withdrawals.length }] : []),
    ...(isTherapist ? [{ key: 'risk' as Tab, label: '风控', badge: data.risk_events.length }] : []),
  ];

  return (
    <div>
      {/* 头部:返回 + 标题 + 客服动作 */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <button
            type="button"
            onClick={() => router.push(`/users/${scope}s`)}
            className="text-xs text-ink-500 hover:text-rose-600"
          >
            ← 返回{scope === 'customer' ? '客户' : '技师'}列表
          </button>
          <h1 className="mt-1 text-2xl font-bold">
            {data.user.display_name ?? '(未填昵称)'}
            <span className={`ml-3 rounded px-2 py-0.5 text-xs ${STATUS_META[data.user.status].cls}`}>
              {STATUS_META[data.user.status].label}
            </span>
          </h1>
          <div className="mt-1 font-mono text-xs text-ink-400">{data.user.id}</div>
        </div>
        <div className="flex gap-2">
          {data.user.status === 'active' && (
            <>
              <button type="button" onClick={() => setActing('suspend')} className="btn-ghost text-xs">
                暂停账号
              </button>
              <button type="button" onClick={() => setActing('ban')} className="btn-danger text-xs">
                封禁账号
              </button>
            </>
          )}
          {(data.user.status === 'suspended' || data.user.status === 'banned') && (
            <button type="button" onClick={() => setActing('restore')} className="btn-primary text-xs">
              解封账号
            </button>
          )}
        </div>
      </div>

      {/* 顶部 KPI 卡片 */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="注册" value={new Date(data.user.created_at).toLocaleDateString('zh-CN')} />
        <Stat
          label="最近活跃"
          value={data.user.last_active_at ? new Date(data.user.last_active_at).toLocaleDateString('zh-CN') : '—'}
        />
        <Stat
          label="积分余额"
          value={data.points ? `${data.points.balance.toLocaleString()}` : '—'}
          sub={data.points && data.points.frozen > 0 ? `冻结 ${data.points.frozen}` : undefined}
          accent={!!data.points && data.points.balance > 0}
        />
        <Stat
          label={isTherapist ? '完成订单' : '订单数'}
          value={(data.order_summary?.total ?? 0).toLocaleString()}
          sub={
            data.order_summary
              ? `支付 ${data.order_summary.paid} · 争议 ${data.order_summary.disputed} · 退款 ${data.order_summary.refunded}`
              : undefined
          }
        />
      </div>

      {/* Tab 切换 */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-ink-100">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`relative px-4 py-2 text-sm transition ${
              tab === t.key
                ? 'font-semibold text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary'
                : 'text-ink-500 hover:text-ink-700'
            }`}
          >
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span className="ml-1.5 rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px]">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {tab === 'profile' && <ProfileTab data={data} onReload={load} />}
      {tab === 'orders' && <OrdersTab data={data} />}
      {tab === 'transactions' && <TransactionsTab data={data} />}
      {tab === 'reviews' && <ReviewsTab data={data} isTherapist={isTherapist} />}
      {tab === 'tickets' && <TicketsTab data={data} userId={userId} />}
      {tab === 'earnings' && data.earnings && <EarningsTab data={data} />}
      {tab === 'risk' && <RiskTab data={data} />}
      {tab === 'assistant' && <AssistantTab userId={userId} />}
      {tab === 'media' && <MediaTab userId={userId} />}

      {/* 客服动作弹层 */}
      {acting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="card w-full max-w-md">
            <h3 className="text-base font-semibold">
              {acting === 'suspend' ? '暂停' : acting === 'ban' ? '封禁' : '解封'}账号
            </h3>
            {acting !== 'restore' && (
              <textarea
                className="mt-3 h-24 w-full rounded-lg border border-ink-100 p-3 text-sm"
                placeholder="请填写原因(记录到审计日志,用户可见)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setActing(null);
                  setReason('');
                }}
                className="btn-ghost flex-1"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void doAct()}
                disabled={busy || (acting !== 'restore' && !reason.trim())}
                className={acting === 'ban' ? 'btn-danger flex-1' : 'btn-primary flex-1'}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────── Tab 子组件 ────────────────

function ProfileTab({ data, onReload }: { data: UserDetail; onReload: () => Promise<void> }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold">基础信息</h3>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Field label="类型">{data.user.user_type}</Field>
          <Field label="locale">{data.user.locale}</Field>
          <Field label="性别">{data.user.gender ?? '—'}</Field>
          <Field label="被封时间">
            {data.user.banned_at ? new Date(data.user.banned_at).toLocaleString('zh-CN') : '—'}
          </Field>
        </dl>
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold">角色 ({data.roles.length})</h3>
        {data.roles.length === 0 ? (
          <div className="text-xs text-ink-400">未授予任何角色</div>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.roles.map((r) => (
              <li key={r.role} className="flex items-center justify-between">
                <span className="font-mono text-xs">{r.role}</span>
                <span className="text-xs text-ink-500">
                  {new Date(r.granted_at).toLocaleDateString('zh-CN')}
                  {r.revoked_at && ' · 已撤销'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.points && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">积分账户</h3>
            <PointsAdjuster userId={data.user.id} onAdjusted={onReload} />
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Field label="可用">{data.points.balance.toLocaleString()}</Field>
            <Field label="冻结">{data.points.frozen.toLocaleString()}</Field>
            <Field label="累计入账">{data.points.total_in.toLocaleString()}</Field>
            <Field label="累计出账">{data.points.total_out.toLocaleString()}</Field>
          </dl>
        </div>
      )}

      {data.therapist && (
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">技师档案</h3>
            <PrivateInfoViewer userId={data.user.id} />
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Field label="核验">{data.therapist.verification_status}</Field>
            <Field label="档案完整度">{data.therapist.profile_completeness}%</Field>
            <Field label="服务评分">{data.therapist.score_service?.toFixed(2) ?? '—'}</Field>
            <Field label="完成订单">{data.therapist.completed_orders}</Field>
            <Field label="降温状态">{data.therapist.cooling_status}</Field>
            <Field label="在线状态">{data.therapist.online_status}</Field>
            <Field label="国籍">{data.therapist.nationality ?? '—'}</Field>
            <Field label="服务区域">
              {data.therapist.service_city ?? '—'}
              {data.therapist.service_area && ` · ${data.therapist.service_area}`}
            </Field>
          </dl>
        </div>
      )}
    </div>
  );
}

function OrdersTab({ data }: { data: UserDetail }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>订单号</th>
            <th>状态</th>
            <th className="text-right">积分</th>
            <th>创建</th>
            <th>支付</th>
          </tr>
        </thead>
        <tbody>
          {data.recent_orders.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-ink-500">
                暂无订单
              </td>
            </tr>
          )}
          {data.recent_orders.map((o) => (
            <tr key={o.id}>
              <td>
                <Link href={`/orders?search=${o.order_no}`} className="font-mono text-xs text-rose-600 hover:underline">
                  {o.order_no}
                </Link>
              </td>
              <td>
                <span className="rounded bg-ink-100 px-2 py-0.5 text-xs">{o.status}</span>
              </td>
              <td className="text-right font-mono">{o.price_points.toLocaleString()}</td>
              <td className="text-xs">{new Date(o.created_at).toLocaleString('zh-CN')}</td>
              <td className="text-xs">{o.paid_at ? new Date(o.paid_at).toLocaleString('zh-CN') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.order_summary && (
        <div className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500">
          累计 {data.order_summary.total} 单 · 累计 GMV{' '}
          <span className="font-mono font-semibold text-ink-900">
            {data.order_summary.gross_points.toLocaleString()} 积分
          </span>
        </div>
      )}
    </div>
  );
}

function TransactionsTab({ data }: { data: UserDetail }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>类型</th>
            <th>方向</th>
            <th className="text-right">金额</th>
            <th className="text-right">余额</th>
            <th>描述</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          {data.recent_transactions.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-ink-500">
                暂无流水
              </td>
            </tr>
          )}
          {data.recent_transactions.map((t) => (
            <tr key={t.id}>
              <td className="font-mono text-xs">{t.type}</td>
              <td>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    t.direction === 'IN' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {t.direction}
                </span>
              </td>
              <td
                className={`text-right font-mono ${t.direction === 'IN' ? 'text-green-700' : 'text-rose-700'}`}
              >
                {t.direction === 'IN' ? '+' : '−'}
                {t.amount.toLocaleString()}
              </td>
              <td className="text-right font-mono text-xs">{t.balance_after.toLocaleString()}</td>
              <td className="text-xs text-ink-500">{t.description ?? '—'}</td>
              <td className="text-xs">{new Date(t.created_at).toLocaleString('zh-CN')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewsTab({ data, isTherapist }: { data: UserDetail; isTherapist: boolean }) {
  return (
    <div className="space-y-3">
      <div className="text-xs text-ink-500">
        {isTherapist ? '此技师收到的评价' : '此客户写过的评价'}
      </div>
      {data.reviews.length === 0 && (
        <div className="card py-8 text-center text-sm text-ink-500">暂无评价</div>
      )}
      {data.reviews.map((r) => (
        <div key={r.id} className="card">
          <div className="flex items-start justify-between">
            <div className="flex gap-3 text-sm">
              <span className="font-mono text-xs text-rose-600">
                服务 {r.score_service.toFixed(1)}
              </span>
              {r.score_appearance !== null && (
                <span className="font-mono text-xs text-ink-500">外貌 {r.score_appearance.toFixed(1)}</span>
              )}
              {r.score_body !== null && (
                <span className="font-mono text-xs text-ink-500">身材 {r.score_body.toFixed(1)}</span>
              )}
              {r.is_hidden === 1 && (
                <span className="rounded bg-ink-100 px-2 py-0.5 text-xs">已隐藏</span>
              )}
              {r.appeal_status && r.appeal_status !== 'none' && (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                  申诉:{r.appeal_status}
                </span>
              )}
            </div>
            <div className="text-xs text-ink-400">{new Date(r.created_at).toLocaleString('zh-CN')}</div>
          </div>
          <p className="mt-2 text-sm text-ink-700">{r.content ?? '(无文字)'}</p>
        </div>
      ))}
    </div>
  );
}

function TicketsTab({ data, userId }: { data: UserDetail; userId: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>工单号</th>
            <th>身份</th>
            <th>状态</th>
            <th>类别</th>
            <th>提交</th>
            <th>结案</th>
          </tr>
        </thead>
        <tbody>
          {data.tickets.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-ink-500">
                无工单关联
              </td>
            </tr>
          )}
          {data.tickets.map((t) => (
            <tr key={t.id}>
              <td>
                <Link href={`/tickets?search=${t.ticket_no}`} className="font-mono text-xs text-rose-600 hover:underline">
                  {t.ticket_no}
                </Link>
              </td>
              <td>
                {t.reporter_user_id === userId ? (
                  <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">投诉人</span>
                ) : (
                  <span className="rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-700">被投诉</span>
                )}
              </td>
              <td className="text-xs">{t.status}</td>
              <td className="text-xs">{t.category}</td>
              <td className="text-xs">{new Date(t.opened_at).toLocaleString('zh-CN')}</td>
              <td className="text-xs">{t.closed_at ? new Date(t.closed_at).toLocaleDateString('zh-CN') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EarningsTab({ data }: { data: UserDetail }) {
  const e = data.earnings!;
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="可提现" value={`$${(e.available_cents / 100).toFixed(2)}`} accent />
        <Stat label="待解冻" value={`$${(e.pending_cents / 100).toFixed(2)}`} />
        <Stat label="累计已提" value={`$${(e.withdrawn_cents / 100).toFixed(2)}`} />
        <Stat label="累计小费" value={`$${(e.tip_earnings_cents / 100).toFixed(2)}`} />
        <Stat label="累计橱窗分成" value={`$${(e.shop_commission_cents / 100).toFixed(2)}`} />
        <Stat label="累计邀请" value={`$${(e.invite_rewards_cents / 100).toFixed(2)}`} />
      </div>

      <h3 className="mb-2 text-sm font-semibold">提现记录</h3>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>金额</th>
              <th>方式</th>
              <th>状态</th>
              <th>申请</th>
              <th>到账</th>
            </tr>
          </thead>
          <tbody>
            {data.withdrawals.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-ink-500">
                  尚未发起过提现
                </td>
              </tr>
            )}
            {data.withdrawals.map((w) => (
              <tr key={w.id}>
                <td className="font-mono">${(w.amount_cents / 100).toFixed(2)}</td>
                <td className="text-xs">{w.method}</td>
                <td>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      w.status === 'paid'
                        ? 'bg-green-100 text-green-700'
                        : w.status === 'pending' || w.status === 'processing'
                          ? 'bg-yellow-100 text-yellow-700'
                          : w.status === 'rejected'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-ink-100'
                    }`}
                  >
                    {w.status}
                  </span>
                </td>
                <td className="text-xs">{new Date(w.requested_at).toLocaleString('zh-CN')}</td>
                <td className="text-xs">{w.paid_at ? new Date(w.paid_at).toLocaleString('zh-CN') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RiskTab({ data }: { data: UserDetail }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>事件类型</th>
            <th className="text-right">严重度</th>
            <th>处置</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          {data.risk_events.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-ink-500">
                无风控事件 ✓
              </td>
            </tr>
          )}
          {data.risk_events.map((r) => (
            <tr key={r.id}>
              <td className="font-mono text-xs">{r.event_type}</td>
              <td className="text-right">
                <span
                  className={`font-mono text-xs ${
                    r.severity >= 80 ? 'text-rose-600' : r.severity >= 50 ? 'text-amber-600' : 'text-ink-500'
                  }`}
                >
                  {r.severity}
                </span>
              </td>
              <td className="text-xs">
                {r.resolution ?? <span className="rounded bg-rose-100 px-2 py-0.5 text-rose-700">未处理</span>}
              </td>
              <td className="text-xs">{new Date(r.created_at).toLocaleString('zh-CN')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={`card ${accent ? 'bg-gradient-to-br from-rose-50 to-white' : ''}`}>
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${accent ? 'text-rose-700' : 'text-ink-900'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

// ──────────────── AI 助理记忆 Tab(M03 C1) ────────────────

interface AssistantData {
  user: { id: string; displayName: string | null; userType: string; locale: string; createdAt: string };
  profile: {
    id: string;
    assistantName: string;
    assistantAvatar: string | null;
    personalityProfile: { tone: string; warmth: number; proactivity: number; humor: number } | null;
    systemPromptOverride: string | null;
    memoryWindowDays: number | null;
    longTermMemory: boolean | null;
    proactiveGreetingEnabled: boolean | null;
    learningEnabled: boolean | null;
    updatedAt: string;
  } | null;
  savedMemory: {
    facts: Record<string, unknown> | null;
    stablePrefs: Record<string, unknown> | null;
    shameSafePrefs: Record<string, unknown> | null;
    tabooZones: Record<string, unknown> | null;
    exportedAt: string | null;
    deletionScheduledAt: string | null;
    updatedAt: string;
  } | null;
  referenceMemory: {
    rotating: RefMemRow[];
    relation: RefMemRow[];
    diff: RefMemRow[];
  };
  interestClusters: Array<{
    clusterIdx: number;
    label: string | null;
    sampleSize: number;
    topEntities: Record<string, unknown> | null;
    weight: number;
    updatedAt: string;
  }>;
  sessionPreferences: {
    currentMood: string | null;
    currentIntent: string | null;
    contextSummary: string | null;
    lastNTurns: unknown[] | null;
    expiresAt: string | null;
    updatedAt: string;
  } | null;
  behavior: {
    behaviorMode: string;
    modeConfidence: number;
    totalOrders: number;
    repeatRate: number;
    updatedAt: string;
  } | null;
  outreach: {
    proactiveEnabled: boolean;
    silentRecallEnabled: boolean;
    weeklyPushCount: number;
    monthlyRecallCount: number;
    lastPushAt: string | null;
    lastRecallAt: string | null;
    regularTimeSlot: string | null;
    updatedAt: string;
  } | null;
  sessions: {
    count: number;
    recent: Array<{ id: string; preview: string | null; turnsCount: number; createdAt: string; updatedAt: string }>;
  };
  chatLog: {
    count: number;
    recent: Array<{
      id: string;
      sessionId: string | null;
      turnIdx: number;
      scenario: string;
      jokeLevel: number;
      llmProvider: string | null;
      llmModel: string | null;
      filterAttempts: number;
      latencyMs: number;
      createdAt: string;
      userInputPreview: string | null;
      finalContentPreview: string | null;
    }>;
  };
}

interface RefMemRow {
  id: string;
  memoryType: string;
  importance: number;
  content: string | null;
  entities: unknown;
  clusterId: number | null;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
}

function AssistantTab({ userId }: { userId: string }) {
  const [data, setData] = useState<AssistantData | null>(null);
  const [contentMasked, setContentMasked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AssistantData>(`/admin/users/${userId}/assistant`)
      .then((res) => {
        // api.get 解包 data,但我们还要 meta — 兼容两种返回
        const raw = res as unknown as { data?: AssistantData; meta?: { contentMasked: boolean } };
        if (raw.data) {
          setData(raw.data);
          setContentMasked(raw.meta?.contentMasked ?? false);
        } else {
          setData(res);
        }
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiClientError) setError(err.payload.message);
        else setError(String(err));
      });
  }, [userId]);

  if (error) return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>;
  if (!data) return <div className="text-sm text-ink-500">加载中…</div>;

  const profile = data.profile;
  const saved = data.savedMemory;
  const ref = data.referenceMemory;
  const clusters = data.interestClusters;
  const sess = data.sessionPreferences;
  const behavior = data.behavior;
  const outreach = data.outreach;

  return (
    <div className="space-y-5">
      {contentMasked && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ 你的角色为 ops · 仅 metadata 可见,具体记忆内容已遮盖(需 admin / cs / auditor 权限)
        </div>
      )}

      {/* ── 助理身份 ───────────────────── */}
      <section className="card">
        <h3 className="mb-3 text-sm font-semibold">🤖 助理身份</h3>
        {profile ? (
          <dl className="grid grid-cols-2 gap-y-2 sm:grid-cols-4">
            <Field label="助理名">{profile.assistantName}</Field>
            <Field label="记忆窗口">{profile.memoryWindowDays} 天</Field>
            <Field label="长期记忆">{profile.longTermMemory ? '开' : '关'}</Field>
            <Field label="主动打招呼">{profile.proactiveGreetingEnabled ? '开' : '关'}</Field>
            <Field label="学习开关">{profile.learningEnabled ? '开' : '关'}</Field>
            {profile.personalityProfile && (
              <>
                <Field label="语气">{profile.personalityProfile.tone}</Field>
                <Field label="温度 / 主动 / 幽默">
                  {profile.personalityProfile.warmth} / {profile.personalityProfile.proactivity} /{' '}
                  {profile.personalityProfile.humor}
                </Field>
              </>
            )}
          </dl>
        ) : (
          <p className="text-xs text-ink-400">— 客户从未与助理对话 —</p>
        )}
      </section>

      {/* ── 行为画像 + Outreach 配置 并排 ───────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="card">
          <h3 className="mb-3 text-sm font-semibold">🧭 行为画像</h3>
          {behavior ? (
            <dl className="grid grid-cols-2 gap-y-2">
              <Field label="模式">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] ${
                    behavior.behaviorMode === 'steady'
                      ? 'bg-emerald-100 text-emerald-700'
                      : behavior.behaviorMode === 'exploratory'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-ink-100 text-ink-700'
                  }`}
                >
                  {behavior.behaviorMode === 'steady'
                    ? '稳定型'
                    : behavior.behaviorMode === 'exploratory'
                    ? '探索型'
                    : '混合型'}
                </span>
                <span className="ml-1 text-[10px] text-ink-400">
                  置信 {(behavior.modeConfidence * 100).toFixed(0)}%
                </span>
              </Field>
              <Field label="总订单">{behavior.totalOrders}</Field>
              <Field label="复购率">{(behavior.repeatRate * 100).toFixed(0)}%</Field>
              <Field label="更新于">{new Date(behavior.updatedAt).toLocaleString('zh-CN', { hour12: false })}</Field>
            </dl>
          ) : (
            <p className="text-xs text-ink-400">— 还没积累足够数据 —</p>
          )}
        </section>

        <section className="card">
          <h3 className="mb-3 text-sm font-semibold">📡 主动 Outreach</h3>
          {outreach ? (
            <dl className="grid grid-cols-2 gap-y-2">
              <Field label="主动 push">{outreach.proactiveEnabled ? '开' : '关'}</Field>
              <Field label="沉默召回">{outreach.silentRecallEnabled ? '开' : '关'}</Field>
              <Field label="本周 push">{outreach.weeklyPushCount} 次</Field>
              <Field label="本月召回">{outreach.monthlyRecallCount} 次</Field>
              <Field label="上次 push">
                {outreach.lastPushAt ? new Date(outreach.lastPushAt).toLocaleString('zh-CN') : '—'}
              </Field>
              <Field label="常规时段">{outreach.regularTimeSlot ?? '—'}</Field>
            </dl>
          ) : (
            <p className="text-xs text-ink-400">— 未配置 outreach —</p>
          )}
        </section>
      </div>

      {/* ── L1 Facts + L2 Stable Prefs ───────────────────── */}
      <section className="card">
        <h3 className="mb-3 text-sm font-semibold">
          🗂 Saved Memory · L1 facts + L2 stable_prefs
          {saved?.deletionScheduledAt && (
            <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-[10px] text-red-700">
              ⚠ 删除计划于 {new Date(saved.deletionScheduledAt).toLocaleDateString()}
            </span>
          )}
        </h3>
        {saved ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium text-ink-500">L1 Facts</div>
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-ink-50 p-3 text-xs text-ink-800">
                {saved.facts == null
                  ? '— 无权限 —'
                  : Object.keys(saved.facts).length === 0
                  ? '— 空 —'
                  : JSON.stringify(saved.facts, null, 2)}
              </pre>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-ink-500">L2 Stable Prefs</div>
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-ink-50 p-3 text-xs text-ink-800">
                {saved.stablePrefs == null
                  ? '— 无权限 —'
                  : Object.keys(saved.stablePrefs).length === 0
                  ? '— 空 —'
                  : JSON.stringify(saved.stablePrefs, null, 2)}
              </pre>
            </div>
            {saved.shameSafePrefs && Object.keys(saved.shameSafePrefs as object).length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-ink-500">羞耻偏好(端侧 mirror)</div>
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-rose-50 p-3 text-xs text-rose-800">
                  {JSON.stringify(saved.shameSafePrefs, null, 2)}
                </pre>
              </div>
            )}
            {saved.tabooZones && Object.keys(saved.tabooZones as object).length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-ink-500">永久禁忌</div>
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-red-50 p-3 text-xs text-red-800">
                  {JSON.stringify(saved.tabooZones, null, 2)}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-ink-400">— 客户还没产生 saved memory —</p>
        )}
      </section>

      {/* ── L3/L4/L5 Reference Memory ───────────────────── */}
      <section className="card">
        <h3 className="mb-3 text-sm font-semibold">🧠 Reference Memory · L3 / L4 / L5</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <RefMemList title="L3 Rotating · 近期偏好" rows={ref.rotating} tone="bg-amber-50 ring-amber-100" />
          <RefMemList title="L4 Relation · 技师关系" rows={ref.relation} tone="bg-emerald-50 ring-emerald-100" />
          <RefMemList title="L5 Diff · 跨次比对" rows={ref.diff} tone="bg-rose-50 ring-rose-100" />
        </div>
      </section>

      {/* ── 兴趣簇 ───────────────────── */}
      <section className="card">
        <h3 className="mb-3 text-sm font-semibold">🎯 兴趣簇(KMeans 3-5)</h3>
        {clusters.length === 0 ? (
          <p className="text-xs text-ink-400">— 样本不足,未生成簇 —</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {clusters.map((c) => (
              <div key={c.clusterIdx} className="rounded-lg ring-1 ring-ink-100 bg-ink-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink-700">#{c.clusterIdx}</span>
                  <span className="text-[10px] text-ink-400">权重 {(c.weight * 100).toFixed(0)}%</span>
                </div>
                <div className="mt-1 text-sm">{c.label ?? '— 未命名 —'}</div>
                <div className="mt-0.5 text-[10px] text-ink-500">样本 {c.sampleSize}</div>
                {c.topEntities && (
                  <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] text-ink-600">
                    {JSON.stringify(c.topEntities, null, 0).slice(0, 120)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Session 当前状态 ───────────────────── */}
      <section className="card">
        <h3 className="mb-3 text-sm font-semibold">⚡ 当前 Session 状态</h3>
        {sess ? (
          <dl className="grid grid-cols-2 gap-y-2 sm:grid-cols-4">
            <Field label="情绪">{sess.currentMood ?? '—'}</Field>
            <Field label="意图">{sess.currentIntent ?? '—'}</Field>
            <Field label="过期于">
              {sess.expiresAt ? new Date(sess.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '—'}
            </Field>
            <Field label="更新于">{new Date(sess.updatedAt).toLocaleString('zh-CN', { hour12: false })}</Field>
            {sess.contextSummary && (
              <div className="col-span-full">
                <div className="text-xs text-ink-500">上下文摘要</div>
                <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-ink-50 p-3 text-xs text-ink-800">
                  {sess.contextSummary}
                </pre>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-xs text-ink-400">— 无活跃 session —</p>
        )}
      </section>

      {/* ── 会话历史 + 对话日志 ───────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="card">
          <h3 className="mb-3 text-sm font-semibold">💬 会话历史({data.sessions.count})</h3>
          {data.sessions.recent.length === 0 ? (
            <p className="text-xs text-ink-400">— 无 —</p>
          ) : (
            <ul className="space-y-2">
              {data.sessions.recent.map((s) => (
                <li key={s.id} className="rounded-lg bg-ink-50 p-2 text-xs">
                  <div className="flex justify-between text-ink-500">
                    <span>{s.turnsCount} turns</span>
                    <span>{new Date(s.updatedAt).toLocaleString('zh-CN', { hour12: false })}</span>
                  </div>
                  {s.preview && <div className="mt-1 truncate text-ink-700">{s.preview}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h3 className="mb-3 text-sm font-semibold">
            📜 对话日志({data.chatLog.count}) ·{' '}
            <Link
              href={`/ai/assistant/sessions?user_id=${userId}`}
              className="text-xs text-rose-600 hover:underline"
            >
              全量回放 →
            </Link>
          </h3>
          {data.chatLog.recent.length === 0 ? (
            <p className="text-xs text-ink-400">
              — 还没有日志(0008 migration 未 apply 时 0;apply 后新对话会自动入库)—
            </p>
          ) : (
            <ul className="space-y-2">
              {data.chatLog.recent.map((t) => (
                <li key={t.id} className="rounded-lg bg-ink-50 p-2 text-xs">
                  <div className="flex justify-between text-ink-500">
                    <span>
                      {t.scenario} · 😄{t.jokeLevel} · {t.llmModel ?? '—'}
                    </span>
                    <span>{new Date(t.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                  </div>
                  {t.userInputPreview && (
                    <div className="mt-1 truncate text-ink-700">{t.userInputPreview}</div>
                  )}
                  {t.finalContentPreview && (
                    <div className="mt-0.5 truncate text-ink-500">→ {t.finalContentPreview}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ──────────────── 手动调整积分 ────────────────

function PointsAdjuster({ userId, onAdjusted }: { userId: string; onAdjusted: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState<string>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const amount = parseInt(delta, 10);
    if (!Number.isFinite(amount) || amount === 0) {
      setError('金额必须是非零整数(正数加积分,负数扣积分)');
      return;
    }
    if (!reason.trim()) {
      setError('必须填写原因(进审计日志)');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/users/${userId}/points/adjust`, { amount, reason });
      setOpen(false);
      setDelta('');
      setReason('');
      await onAdjusted();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex gap-1.5">
        <button
          type="button"
          className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-100"
          onClick={() => {
            setDelta('100');
            setReason('');
            setOpen(true);
          }}
        >
          + 加积分
        </button>
        <button
          type="button"
          className="rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-100"
          onClick={() => {
            setDelta('-100');
            setReason('');
            setOpen(true);
          }}
        >
          − 扣积分
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}>
          <div className="card w-full max-w-md">
            <h3 className="text-base font-semibold">调整积分</h3>
            <p className="mt-1 text-xs text-ink-500">
              客户 / 技师 UID:
              <span className="ml-1 font-mono">{userId.slice(0, 12)}…</span>
            </p>

            {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-ink-500">金额(正数加 / 负数扣)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input w-full font-mono"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value.replace(/[^0-9-]/g, ''))}
                  placeholder="比如 100 或 -50"
                />
                <div className="mt-1 text-[10px] text-ink-400">
                  当前输入会
                  {parseInt(delta, 10) > 0
                    ? <span className="ml-1 text-emerald-700">+{parseInt(delta, 10).toLocaleString()}(加)</span>
                    : parseInt(delta, 10) < 0
                    ? <span className="ml-1 text-rose-700">{parseInt(delta, 10).toLocaleString()}(扣)</span>
                    : <span className="ml-1 text-ink-400">— 请填非零整数 —</span>}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-ink-500">
                  原因 <span className="text-red-500">*</span>(进审计日志,用户可见)
                </label>
                <textarea
                  className="input h-20 w-full"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="比如:活动补偿 / 客诉退款 / 内部测试 / 误扣回滚"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void submit()}
                disabled={busy || !delta || !reason.trim()}
              >
                {busy ? '提交中…' : '确认调整'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ──────────────── 隐私字段查看(T2) ────────────────

interface PrivateInfoResult {
  social?: Record<string, string> | null;
  socialUnlockPricePoints?: number | null;
  address?: string | null;
  body?: {
    heightCm: number | null;
    weightKg: number | null;
    bustCm: number | null;
    hipCm: number | null;
    bodyFatPct: number | string | null;
    education: string | null;
  } | null;
}

function PrivateInfoViewer({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<'social' | 'address' | 'body' | 'all'>('all');
  const [result, setResult] = useState<PrivateInfoResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(30);

  // 解密成功后开始 30 秒倒计时
  useEffect(() => {
    if (!result) return;
    setRemaining(30);
    const t = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setResult(null);
          return 30;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [result]);

  async function submit() {
    setError(null);
    if (!reason.trim()) {
      setError('必须填写原因(进审计日志)');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<PrivateInfoResult>(
        `/admin/users/${userId}/decrypt-private`,
        { scope, reason },
      );
      setResult(res);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-100"
        onClick={() => {
          setOpen(true);
          setResult(null);
          setReason('');
          setError(null);
        }}
      >
        🔐 查看私密信息
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOpen(false);
              setResult(null);
            }
          }}
        >
          <div className="card w-full max-w-2xl">
            <h3 className="text-base font-semibold">🔐 查看私密信息</h3>
            <p className="mt-1 text-xs text-ink-500">
              社交账号 / 精确地址 / 身体数据 均为私密字段,查看会写审计日志。
              admin 角色可看全部;cs 角色仅可看社交账号。
            </p>

            {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

            {!result ? (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-ink-500">查看范围</label>
                  <select className="input w-full" value={scope} onChange={(e) => setScope(e.target.value as never)}>
                    <option value="all">全部(社交 + 地址 + 身体)</option>
                    <option value="social">仅社交账号</option>
                    <option value="address">仅精确地址</option>
                    <option value="body">仅身体数据</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink-500">
                    原因 <span className="text-red-500">*</span>(进审计日志)
                  </label>
                  <textarea
                    className="input h-20 w-full"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="比如:客诉调查 / 风控核实 / 合规审核"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void submit()}
                    disabled={busy || !reason.trim()}
                  >
                    {busy ? '查询中…' : '查看'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  ⏱ {remaining}s 后自动关闭 · 此操作已记入审计日志
                </div>

                {result.social && Object.keys(result.social).length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-semibold text-ink-700">
                      💬 社交账号(解锁价 {result.socialUnlockPricePoints ?? '—'} 积分)
                    </div>
                    <pre className="rounded-lg bg-amber-50 p-3 font-mono text-xs ring-1 ring-amber-200">
                      {JSON.stringify(result.social, null, 2)}
                    </pre>
                  </div>
                )}

                {result.address && (
                  <div>
                    <div className="mb-1 text-xs font-semibold text-ink-700">📍 精确地址</div>
                    <pre className="rounded-lg bg-amber-50 p-3 font-mono text-xs ring-1 ring-amber-200">
                      {result.address}
                    </pre>
                  </div>
                )}

                {result.body && (
                  <div>
                    <div className="mb-1 text-xs font-semibold text-ink-700">📐 身体数据</div>
                    <dl className="grid grid-cols-3 gap-2 rounded-lg bg-amber-50 p-3 text-xs ring-1 ring-amber-200">
                      <Field label="身高">{result.body.heightCm ? `${result.body.heightCm} cm` : '—'}</Field>
                      <Field label="体重">{result.body.weightKg ? `${result.body.weightKg} kg` : '—'}</Field>
                      <Field label="胸围">{result.body.bustCm ? `${result.body.bustCm} cm` : '—'}</Field>
                      <Field label="腰围">{result.body.hipCm ? `${result.body.hipCm} cm` : '—'}</Field>
                      <Field label="体脂率">{result.body.bodyFatPct != null ? `${result.body.bodyFatPct}%` : '—'}</Field>
                      <Field label="教育">{result.body.education ?? '—'}</Field>
                    </dl>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setOpen(false);
                      setResult(null);
                    }}
                  >
                    立即关闭
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setRemaining(30)}
                  >
                    再延 30s
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ──────────────── 媒体库 Tab(T1) ────────────────

interface MediaItem {
  id: string;
  type: 'sticker' | 'gif' | 'photo' | 'video' | 'audio';
  purpose: string;
  visibility: 'public' | 'paid_unlock' | 'platform_only';
  unlockPricePoints: number | null;
  r2Key: string | null;
  publicUrl: string | null;
  thumbnailUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  widthPx: number | null;
  heightPx: number | null;
  auditStatus: 'pending' | 'approved' | 'rejected';
  auditedAt: string | null;
  isEncrypted: number | null;
  watermarkApplied: number | null;
  deletedAt: string | null;
  createdAt: string;
}

interface MediaResp {
  list: MediaItem[];
  totals: {
    total: number;
    public_n: number;
    paid_n: number;
    platform_n: number;
    pending_n: number;
    approved_n: number;
    rejected_n: number;
  };
  meta: { content_masked: boolean; liveness_visible: boolean };
}

const VIS_LABEL: Record<string, { label: string; cls: string; icon: string }> = {
  public: { label: '公开', cls: 'bg-emerald-100 text-emerald-700', icon: '🌐' },
  paid_unlock: { label: '付费解锁', cls: 'bg-amber-100 text-amber-700', icon: '🔓' },
  platform_only: { label: '平台仅用', cls: 'bg-rose-100 text-rose-700', icon: '🔒' },
};

const AUDIT_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: '待审', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: '已通过', cls: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: '已拒绝', cls: 'bg-rose-100 text-rose-700' },
};

function formatBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function MediaTab({ userId }: { userId: string }) {
  const [resp, setResp] = useState<MediaResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visFilter, setVisFilter] = useState<'' | 'public' | 'paid_unlock' | 'platform_only'>('');
  const [auditFilter, setAuditFilter] = useState<'' | 'pending' | 'approved' | 'rejected'>('');
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<MediaResp>(`/admin/users/${userId}/media`, {
        visibility: visFilter || undefined,
        audit_status: auditFilter || undefined,
        limit: 200,
      });
      setResp(data);
      setError(null);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String(err));
    }
  }, [userId, visFilter, auditFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>;
  if (!resp) return <div className="text-sm text-ink-500">加载中…</div>;

  return (
    <div className="space-y-4">
      {/* 顶部统计 + 筛选 */}
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-ink-500">
            共 {resp.totals.total} 个媒体 ·
            <span className="ml-1">🌐 {resp.totals.public_n} 公开</span>
            <span className="ml-1">· 🔓 {resp.totals.paid_n} 付费</span>
            <span className="ml-1">· 🔒 {resp.totals.platform_n} 平台仅</span>
            <span className="ml-2 text-amber-700">· ⏳ 待审 {resp.totals.pending_n}</span>
            <span className="ml-1 text-emerald-700">· ✓ 通过 {resp.totals.approved_n}</span>
            <span className="ml-1 text-rose-700">· ✗ 拒绝 {resp.totals.rejected_n}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <select className="input" value={visFilter} onChange={(e) => setVisFilter(e.target.value as never)}>
              <option value="">全部可见性</option>
              <option value="public">🌐 公开</option>
              <option value="paid_unlock">🔓 付费解锁</option>
              <option value="platform_only">🔒 平台仅用</option>
            </select>
            <select className="input" value={auditFilter} onChange={(e) => setAuditFilter(e.target.value as never)}>
              <option value="">全部审核状态</option>
              <option value="pending">⏳ 待审</option>
              <option value="approved">✓ 已通过</option>
              <option value="rejected">✗ 已拒绝</option>
            </select>
          </div>
        </div>
        {!resp.meta.liveness_visible && (
          <div className="mt-2 rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
            ⚠ 你的角色看不到 liveness 视频(仅 admin / auditor 可见)
          </div>
        )}
      </section>

      {/* 媒体网格 */}
      {resp.list.length === 0 ? (
        <div className="card text-center text-xs text-ink-400">— 没有匹配的媒体 —</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {resp.list.map((m) => {
            const vis = VIS_LABEL[m.visibility] ?? { label: m.visibility, cls: 'bg-ink-100 text-ink-700', icon: '?' };
            const audit = AUDIT_LABEL[m.auditStatus] ?? { label: m.auditStatus, cls: 'bg-ink-100 text-ink-700' };
            const isImage = m.type === 'photo' || m.type === 'sticker' || m.type === 'gif';
            const isVideo = m.type === 'video';
            const isAudio = m.type === 'audio';
            return (
              <div
                key={m.id}
                className="card flex cursor-pointer flex-col gap-2 p-2 hover:shadow-md"
                onClick={() => setPreviewItem(m)}
              >
                {/* 预览区 */}
                <div className="relative aspect-square overflow-hidden rounded-lg bg-ink-100">
                  {isImage && (m.thumbnailUrl || m.publicUrl) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.thumbnailUrl || m.publicUrl || ''}
                      alt={m.purpose}
                      className="h-full w-full object-cover"
                    />
                  ) : isVideo ? (
                    <div className="flex h-full w-full items-center justify-center text-3xl text-ink-400">▶</div>
                  ) : isAudio ? (
                    <div className="flex h-full w-full items-center justify-center text-3xl text-ink-400">🎙</div>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-ink-400">{m.type}</div>
                  )}
                  {/* 角标 visibility */}
                  <span className={`absolute left-1 top-1 rounded px-1 py-0.5 text-[9px] ${vis.cls}`}>
                    {vis.icon} {vis.label}
                  </span>
                  {/* 角标 audit */}
                  <span className={`absolute right-1 top-1 rounded px-1 py-0.5 text-[9px] ${audit.cls}`}>
                    {audit.label}
                  </span>
                  {/* 加密标 */}
                  {m.isEncrypted ? (
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
                      🔐 加密
                    </span>
                  ) : null}
                </div>
                {/* metadata */}
                <div className="space-y-0.5 text-[10px]">
                  <div className="font-mono text-ink-700">
                    {m.purpose} · {m.type}
                  </div>
                  <div className="text-ink-400">
                    {formatBytes(m.sizeBytes)} · {isVideo || isAudio ? formatDuration(m.durationMs) : ''}
                    {isImage && m.widthPx ? ` · ${m.widthPx}×${m.heightPx}` : ''}
                  </div>
                  <div className="text-ink-400">{new Date(m.createdAt).toLocaleDateString('zh-CN')}</div>
                  {m.visibility === 'paid_unlock' && m.unlockPricePoints != null && (
                    <div className="text-amber-700">💰 {m.unlockPricePoints} 积分</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 大图 / 视频 / 音频 预览 modal */}
      {previewItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewItem(null);
          }}
        >
          <div className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl bg-white">
            {/* 关闭 */}
            <button
              type="button"
              onClick={() => setPreviewItem(null)}
              className="absolute right-2 top-2 z-10 rounded-full bg-black/50 px-3 py-1 text-xs text-white hover:bg-black/70"
            >
              关闭 ✕
            </button>
            {/* 内容 */}
            <div className="flex max-h-[90vh] max-w-[90vw] flex-col">
              <div className="flex max-h-[60vh] items-center justify-center bg-black">
                {previewItem.type === 'video' && previewItem.publicUrl ? (
                  <video src={previewItem.publicUrl} controls className="max-h-[60vh] max-w-full" />
                ) : previewItem.type === 'audio' && previewItem.publicUrl ? (
                  <audio src={previewItem.publicUrl} controls className="w-[400px]" />
                ) : previewItem.publicUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewItem.publicUrl} alt="" className="max-h-[60vh] max-w-full object-contain" />
                ) : (
                  <div className="p-12 text-sm text-white/60">— 无 URL · 可能加密或无权限 —</div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 p-4 text-xs sm:grid-cols-3">
                <Field label="purpose">{previewItem.purpose}</Field>
                <Field label="type">{previewItem.type}</Field>
                <Field label="visibility">{VIS_LABEL[previewItem.visibility]?.label ?? previewItem.visibility}</Field>
                <Field label="audit">{AUDIT_LABEL[previewItem.auditStatus]?.label ?? previewItem.auditStatus}</Field>
                <Field label="size">{formatBytes(previewItem.sizeBytes)}</Field>
                <Field label="duration">{formatDuration(previewItem.durationMs)}</Field>
                <Field label="dim">
                  {previewItem.widthPx ? `${previewItem.widthPx}×${previewItem.heightPx}` : '—'}
                </Field>
                <Field label="mime">{previewItem.mimeType ?? '—'}</Field>
                <Field label="encrypted">{previewItem.isEncrypted ? '是' : '否'}</Field>
                <Field label="watermark">{previewItem.watermarkApplied ? '是' : '否'}</Field>
                <Field label="audited">
                  {previewItem.auditedAt ? new Date(previewItem.auditedAt).toLocaleString('zh-CN') : '—'}
                </Field>
                <Field label="created">{new Date(previewItem.createdAt).toLocaleString('zh-CN')}</Field>
                {previewItem.r2Key && (
                  <div className="col-span-full">
                    <dt className="text-xs text-ink-500">r2Key</dt>
                    <dd className="mt-0.5 font-mono text-[10px] text-ink-700 break-all">{previewItem.r2Key}</dd>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RefMemList({ title, rows, tone }: { title: string; rows: RefMemRow[]; tone: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-500">
        {title}({rows.length})
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-ink-400">— 空 —</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className={`rounded-lg p-2 text-[11px] ring-1 ${tone}`}>
              <div className="flex justify-between text-[9px] text-ink-500">
                <span>重要度 {r.importance}</span>
                <span>{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>
              {r.content ? (
                <div className="mt-0.5 break-words text-ink-800">{r.content}</div>
              ) : (
                <div className="mt-0.5 text-ink-400">— 无权限或为空 —</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
