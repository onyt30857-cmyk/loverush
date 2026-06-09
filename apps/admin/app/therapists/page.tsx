'use client';

/**
 * 技师管控页
 *
 * - 全量技师列表(调 GET /admin/therapists/list)
 * - 状态 tab：全部 / 待审 / 已通过 / 已驳回
 * - 昵称搜索
 * - 每行操作：passed→撤下(reject); pending/in_review/failed→通过(approve); 所有→驳回
 * - 多选 + 批量通过(POST /admin/therapists/batch-verify)
 * - 撤下/驳回必填原因
 */

import { useEffect, useRef, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface TherapistListRow {
  therapist_id: string;
  user_id: string;
  display_name: string | null;
  verification_status: 'pending' | 'in_review' | 'passed' | 'failed';
  service_city: string | null;
  online_status: string;
  created_at: string;
}

interface ListResult {
  rows: TherapistListRow[];
  total: number;
}

type Tab = 'all' | 'pending' | 'passed' | 'failed';

const TAB_LABEL: Record<Tab, string> = {
  all: '全部',
  pending: '待审',
  passed: '已通过',
  failed: '已驳回',
};

// pending tab 传给后端 status=all 过滤 pending+in_review
const TAB_TO_STATUS: Record<Tab, string | undefined> = {
  all: 'all',
  pending: undefined, // 前端 tab pending 对应 pending+in_review，需要特殊处理
  passed: 'passed',
  failed: 'failed',
};

const STATUS_META: Record<TherapistListRow['verification_status'], { label: string; cls: string }> = {
  pending: { label: '待审', cls: 'bg-yellow-100 text-yellow-700' },
  in_review: { label: '审核中', cls: 'bg-blue-100 text-blue-700' },
  passed: { label: '已通过', cls: 'bg-green-100 text-green-700' },
  failed: { label: '已驳回', cls: 'bg-rose-100 text-rose-700' },
};

type ActionType = 'approve' | 'reject';

interface ConfirmState {
  userIds: string[];
  action: ActionType;
  isBatch: boolean;
}

const PAGE_SIZE = 50;

export default function TherapistsPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [list, setList] = useState<TherapistListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 多选
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 确认弹层
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // hooks 全在 early return 之前 (防 React #310)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(overrideOffset?: number) {
    const effectiveOffset = overrideOffset ?? offset;
    setLoading(true);
    setError(null);
    try {
      // pending tab 特殊处理：显示 pending+in_review
      const statusParam =
        tab === 'pending'
          ? 'pending'  // 后端 pending 分支 = pending + in_review
          : tab === 'all'
            ? 'all'
            : tab;
      const result = await api.get<ListResult>('/admin/therapists/list', {
        status: statusParam,
        q: search || undefined,
        limit: PAGE_SIZE,
        offset: effectiveOffset,
      });
      setList(result.rows);
      setTotal(result.total);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setOffset(0);
    setSelected(new Set());
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search]);

  function handleSearchChange(v: string) {
    setSearchInput(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(v), 400);
  }

  function toggleSelect(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === list.length && list.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(list.map((r) => r.user_id)));
    }
  }

  function openConfirm(userIds: string[], action: ActionType, isBatch = false) {
    setConfirm({ userIds, action, isBatch });
    setReason('');
  }

  function closeConfirm() {
    setConfirm(null);
    setReason('');
  }

  async function execAction() {
    if (!confirm) return;
    if (confirm.action === 'reject' && !reason.trim()) {
      alert('撤下/驳回必须填写原因');
      return;
    }
    setBusy(true);
    try {
      if (confirm.isBatch) {
        await api.post('/admin/therapists/batch-verify', {
          therapist_user_ids: confirm.userIds,
          decision: confirm.action,
          reason: confirm.action === 'reject' ? reason.trim() : undefined,
        });
      } else {
        await api.post(`/admin/therapists/${confirm.userIds[0]}/verify`, {
          decision: confirm.action,
          reason: confirm.action === 'reject' ? reason.trim() : undefined,
        });
      }
      closeConfirm();
      setSelected(new Set());
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const allSelected = list.length > 0 && selected.size === list.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">技师管控</h1>
          <p className="mt-1 text-sm text-ink-500">
            全量技师 · 状态筛选 · 一键撤下 / 通过 · 批量审核
          </p>
        </div>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => openConfirm([...selected], 'approve', true)}
            className="btn-primary"
          >
            批量通过 ({selected.size})
          </button>
        )}
      </div>

      {/* Tab + 搜索 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 border-b border-ink-100">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`relative px-4 py-2 text-sm transition ${
                tab === t
                  ? 'font-semibold text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary'
                  : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="搜昵称…"
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="h-8 rounded-lg border border-ink-200 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <span className="text-xs text-ink-400">共 {total} 人</span>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {/* 列表 */}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  aria-label="全选"
                />
              </th>
              <th>技师</th>
              <th>状态</th>
              <th>城市</th>
              <th>在线</th>
              <th>注册时间</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-ink-500">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-ink-500">
                  暂无数据
                </td>
              </tr>
            )}
            {list.map((r) => {
              const meta = STATUS_META[r.verification_status];
              const isSelected = selected.has(r.user_id);
              const isPassed = r.verification_status === 'passed';
              return (
                <tr key={r.user_id} className={isSelected ? 'bg-primary/5' : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(r.user_id)}
                      aria-label={`选择 ${r.display_name ?? r.user_id}`}
                    />
                  </td>
                  <td>
                    <div className="text-sm font-medium">{r.display_name ?? '(未填昵称)'}</div>
                    <div className="font-mono text-[10px] text-ink-400">{r.user_id.slice(0, 12)}…</div>
                  </td>
                  <td>
                    <span className={`rounded px-2 py-0.5 text-xs ${meta.cls}`}>{meta.label}</span>
                  </td>
                  <td className="text-xs">{r.service_city ?? '—'}</td>
                  <td>
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        r.online_status === 'online' ? 'bg-green-500' : 'bg-ink-300'
                      }`}
                    />
                  </td>
                  <td className="text-xs">{new Date(r.created_at).toLocaleString('zh-CN')}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {isPassed ? (
                        <button
                          type="button"
                          onClick={() => openConfirm([r.user_id], 'reject')}
                          className="btn-danger h-7 px-3 text-xs"
                        >
                          撤下
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openConfirm([r.user_id], 'approve')}
                          className="btn-primary h-7 px-3 text-xs"
                        >
                          通过
                        </button>
                      )}
                      {!isPassed ? (
                        <button
                          type="button"
                          onClick={() => openConfirm([r.user_id], 'reject')}
                          className="btn-danger h-7 px-3 text-xs"
                        >
                          驳回
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-ink-500">
            第 {currentPage} / {totalPages} 页
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => {
                const newOffset = Math.max(0, offset - PAGE_SIZE);
                setOffset(newOffset);
                void load(newOffset);
              }}
              className="btn-ghost h-8 px-3 text-xs disabled:opacity-40"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => {
                const newOffset = offset + PAGE_SIZE;
                setOffset(newOffset);
                void load(newOffset);
              }}
              className="btn-ghost h-8 px-3 text-xs disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {/* 确认弹层 */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
          <div className="card w-full max-w-md">
            <h3 className="text-lg font-bold">
              {confirm.action === 'approve'
                ? confirm.isBatch
                  ? `批量通过 ${confirm.userIds.length} 名技师`
                  : '通过核验'
                : confirm.isBatch
                  ? `批量驳回 ${confirm.userIds.length} 名技师`
                  : confirm.userIds.length === 1 &&
                      list.find((r) => r.user_id === confirm.userIds[0])?.verification_status === 'passed'
                    ? '撤下已通过技师'
                    : '驳回技师'}
            </h3>

            {confirm.action === 'approve' && (
              <p className="mt-2 text-sm text-ink-500">
                确认通过后技师将出现在客户端，可被搜索和推荐。
              </p>
            )}

            {confirm.action === 'reject' && (
              <div className="mt-3">
                <label className="text-sm font-medium">
                  原因 <span className="text-rose-500">*</span> (技师可见)
                </label>
                <textarea
                  className="mt-2 h-24 w-full rounded-lg border border-ink-200 p-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
                  placeholder="例：liveness 视频不符合要求 / 证件照片模糊 / 内容违规…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={closeConfirm}
                disabled={busy}
                className="btn-ghost flex-1"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void execAction()}
                disabled={busy || (confirm.action === 'reject' && !reason.trim())}
                className={confirm.action === 'approve' ? 'btn-primary flex-1' : 'btn-danger flex-1'}
              >
                {busy ? '处理中…' : confirm.action === 'approve' ? '确认通过' : '确认驳回'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
