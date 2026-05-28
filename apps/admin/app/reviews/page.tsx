'use client';

/**
 * 评价管理 · 运营总监视角
 *
 * 4 个 Tab + 4 个 KPI 卡:
 *   - 申诉中     pending 申诉 → admin 裁决 uphold(维持评价) / hide(支持申诉,软删评价)
 *   - 低分预警    score_service <= 4(满分 10),最近优先,运营主动看 reach-out
 *   - 已隐藏     软删历史,可点恢复
 *   - 全部       审计用,默认按时间倒序
 *
 * 单条动作:
 *   申诉中    → 维持(✓) / 支持申诉并隐藏(✗)
 *   其他状态   → 隐藏 / 恢复
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface ReviewRow {
  id: string;
  order_id: string;
  reviewer_user_id: string;
  target_user_id: string;
  score_service: number;
  score_appearance: number | null;
  score_body: number | null;
  content: string | null;
  tags: string[] | null;
  is_hidden: number;
  is_anonymous: number;
  appeal_status: string | null;
  appeal_reason: string | null;
  created_at: string;
  reviewer_name: string | null;
  target_name: string | null;
}

interface Stats {
  total: number;
  hidden: number;
  appeal_pending: number;
  low_score: number;
  recent_7d: number;
}

type Filter = 'appeal_pending' | 'low_score' | 'hidden' | 'all';

const FILTER_LABEL: Record<Filter, string> = {
  appeal_pending: '申诉中',
  low_score: '低分预警',
  hidden: '已隐藏',
  all: '全部',
};

export default function ReviewsPage() {
  const [filter, setFilter] = useState<Filter>('appeal_pending');
  const [list, setList] = useState<ReviewRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [acting, setActing] = useState<{ id: string; type: 'hide' | 'unhide' | 'resolve_uphold' | 'resolve_hide' } | null>(null);
  const [reason, setReason] = useState('');

  const loadStats = useCallback(async () => {
    try {
      const s = await api.get<Stats>('/admin/reviews/stats');
      setStats(s);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }, []);

  const loadList = useCallback(async () => {
    try {
      const rows = await api.get<ReviewRow[]>('/admin/reviews', { filter, limit: 100 });
      setList(rows);
      setError(null);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }, [filter]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function doAction() {
    if (!acting) return;
    if (!reason.trim()) return;
    setBusy(acting.id);
    try {
      if (acting.type === 'hide') {
        await api.post(`/admin/reviews/${acting.id}/hide`, { reason });
      } else if (acting.type === 'unhide') {
        await api.post(`/admin/reviews/${acting.id}/unhide`, { reason });
      } else if (acting.type === 'resolve_uphold') {
        await api.post(`/admin/reviews/${acting.id}/resolve`, { outcome: 'uphold', note: reason });
      } else if (acting.type === 'resolve_hide') {
        await api.post(`/admin/reviews/${acting.id}/resolve`, { outcome: 'hide', note: reason });
      }
      setActing(null);
      setReason('');
      await loadStats();
      await loadList();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">评价管理</h1>
        <p className="mt-1 text-xs text-ink-500">申诉裁决 + 低分预警 + 软删管理</p>
      </div>

      {/* KPI 卡 */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
          <Stat label="累计评价" value={stats.total} />
          <Stat label="近 7 天" value={stats.recent_7d} />
          <Stat label="待裁决申诉" value={stats.appeal_pending} accent={stats.appeal_pending > 0} />
          <Stat label="低分预警" value={stats.low_score} />
          <Stat label="已隐藏" value={stats.hidden} />
        </div>
      )}

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {/* Tab */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-ink-100">
        {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`relative px-4 py-2 text-sm transition ${
              filter === f
                ? 'font-semibold text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary'
                : 'text-ink-500 hover:text-ink-700'
            }`}
          >
            {FILTER_LABEL[f]}
            {stats && f === 'appeal_pending' && stats.appeal_pending > 0 && (
              <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] text-white">
                {stats.appeal_pending}
              </span>
            )}
            {stats && f === 'low_score' && stats.low_score > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] text-white">
                {stats.low_score}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 列表 */}
      <div className="space-y-3">
        {list.length === 0 && (
          <div className="card py-8 text-center text-sm text-ink-500">
            {filter === 'appeal_pending' ? '🎉 当前无待裁决申诉' : '暂无数据'}
          </div>
        )}
        {list.map((r) => (
          <div key={r.id} className="card">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                {/* 评分行 */}
                <div className="mb-2 flex items-center gap-3 text-sm">
                  <span
                    className={`font-mono font-semibold ${
                      r.score_service <= 40 ? 'text-rose-600' : r.score_service <= 70 ? 'text-amber-600' : 'text-green-700'
                    }`}
                  >
                    服务 {(r.score_service / 10).toFixed(1)}
                  </span>
                  {r.score_appearance !== null && (
                    <span className="font-mono text-xs text-ink-500">外貌 {(r.score_appearance / 10).toFixed(1)}</span>
                  )}
                  {r.score_body !== null && (
                    <span className="font-mono text-xs text-ink-500">身材 {(r.score_body / 10).toFixed(1)}</span>
                  )}
                  {r.is_hidden === 1 && (
                    <span className="rounded bg-ink-200 px-2 py-0.5 text-xs">已隐藏</span>
                  )}
                  {r.appeal_status === 'pending' && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">申诉待裁决</span>
                  )}
                  {r.appeal_status === 'resolved' && (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">申诉已维持</span>
                  )}
                  {r.appeal_status === 'rejected' && (
                    <span className="rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-700">申诉被驳回</span>
                  )}
                  {r.is_anonymous === 1 && (
                    <span className="rounded bg-ink-100 px-2 py-0.5 text-xs">匿名</span>
                  )}
                </div>

                {/* 内容 */}
                <p className="text-sm text-ink-700">{r.content ?? '(评论无文字)'}</p>

                {/* tags */}
                {r.tags && r.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.tags.map((t) => (
                      <span key={t} className="rounded bg-rose-50 px-2 py-0.5 text-[10px] text-rose-700">
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {/* 申诉理由 */}
                {r.appeal_reason && (
                  <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <strong className="font-semibold">技师申诉:</strong> {r.appeal_reason}
                  </div>
                )}

                {/* 元信息 */}
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-ink-500">
                  <span>
                    评价人:
                    <Link href={`/users/customers/${r.reviewer_user_id}`} className="ml-1 text-rose-600 hover:underline">
                      {r.reviewer_name ?? '(匿名)'}
                    </Link>
                  </span>
                  <span>
                    被评:
                    <Link href={`/users/therapists/${r.target_user_id}`} className="ml-1 text-rose-600 hover:underline">
                      {r.target_name ?? '—'}
                    </Link>
                  </span>
                  <span>
                    订单:
                    <Link href={`/orders?search=${r.order_id}`} className="ml-1 text-rose-600 hover:underline font-mono">
                      {r.order_id.slice(0, 8)}…
                    </Link>
                  </span>
                  <span>{new Date(r.created_at).toLocaleString('zh-CN')}</span>
                </div>
              </div>

              {/* 动作区 */}
              <div className="flex w-32 flex-shrink-0 flex-col gap-2">
                {r.appeal_status === 'pending' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setActing({ id: r.id, type: 'resolve_uphold' })}
                      disabled={busy === r.id}
                      className="btn-ghost h-8 text-xs"
                    >
                      维持评价
                    </button>
                    <button
                      type="button"
                      onClick={() => setActing({ id: r.id, type: 'resolve_hide' })}
                      disabled={busy === r.id}
                      className="btn-primary h-8 text-xs"
                    >
                      支持申诉(隐藏)
                    </button>
                  </>
                ) : r.is_hidden === 1 ? (
                  <button
                    type="button"
                    onClick={() => setActing({ id: r.id, type: 'unhide' })}
                    disabled={busy === r.id}
                    className="btn-primary h-8 text-xs"
                  >
                    恢复曝光
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActing({ id: r.id, type: 'hide' })}
                    disabled={busy === r.id}
                    className="btn-danger h-8 text-xs"
                  >
                    隐藏
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 动作弹层 */}
      {acting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="card w-full max-w-md">
            <h3 className="text-base font-semibold">
              {acting.type === 'hide' && '隐藏评价'}
              {acting.type === 'unhide' && '恢复评价'}
              {acting.type === 'resolve_uphold' && '维持评价(驳回申诉)'}
              {acting.type === 'resolve_hide' && '支持申诉 + 隐藏评价'}
            </h3>
            <textarea
              className="mt-3 h-24 w-full rounded-lg border border-ink-100 p-3 text-sm"
              placeholder={
                acting.type.startsWith('resolve')
                  ? '裁决理由(技师/客户均可见,记录到审计日志)'
                  : '操作原因(记录到审计日志)'
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
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
                onClick={() => void doAction()}
                disabled={busy === acting.id || !reason.trim()}
                className={
                  acting.type === 'hide' || acting.type === 'resolve_hide' ? 'btn-danger flex-1' : 'btn-primary flex-1'
                }
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`card ${accent ? 'bg-gradient-to-br from-rose-50 to-white' : ''}`}>
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ? 'text-rose-700' : 'text-ink-900'}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
