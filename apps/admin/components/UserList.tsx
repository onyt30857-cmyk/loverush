'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api, ApiClientError } from '@/lib/api';

export interface UserRow {
  id: string;
  user_type: 'customer' | 'therapist';
  status: 'pending' | 'active' | 'suspended' | 'banned';
  display_name: string | null;
  locale: string;
  created_at: string;
  last_active_at: string | null;
  banned_at: string | null;
  points_balance: number;
}

const SCOPE_LABEL = { customer: '客户', therapist: '技师' } as const;

export function UserList({ scope }: { scope: 'customer' | 'therapist' }) {
  const [list, setList] = useState<UserRow[]>([]);
  const [counts, setCounts] = useState({ activated: 0, inactive: 0 });
  const [activatedMode, setActivatedMode] = useState<'only' | 'inactive' | 'all'>('only');
  const [status, setStatus] = useState<UserRow['status'] | ''>('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [acting, setActing] = useState<{ user: UserRow; action: 'suspend' | 'ban' | 'restore' } | null>(null);
  const [reason, setReason] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 无效账户批量清理 modal
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupHours, setCleanupHours] = useState(24);
  const [cleanupPreview, setCleanupPreview] = useState<{ would_delete: number; sample: Array<{ id: string; created_at: string }> } | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);

  function copyId(id: string) {
    void navigator.clipboard
      .writeText(id)
      .then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
      })
      .catch(() => {
        // 剪贴板权限失败兜底:浮一个临时输入框给手动选中
        const ta = document.createElement('textarea');
        ta.value = id;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          setCopiedId(id);
          setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
        } catch {
          /* ignore */
        }
        document.body.removeChild(ta);
      });
  }

  const load = useCallback(async () => {
    try {
      const res = await api.get<{
        list: UserRow[];
        counts: { activated: number; inactive: number };
        activated_mode: 'only' | 'inactive' | 'all';
      }>('/admin/users', {
        user_type: scope, // 固定按页面 scope,不再混类型
        status: status || undefined,
        search: search || undefined,
        activated: activatedMode,
        limit: 100,
      });
      setList(res.list);
      setCounts(res.counts);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }, [scope, status, search, activatedMode]);

  useEffect(() => {
    void load();
  }, [scope, status, activatedMode, load]);

  async function doCleanupPreview() {
    setCleanupBusy(true);
    try {
      const res = await api.post<{ would_delete: number; sample: Array<{ id: string; created_at: string }> }>(
        '/admin/users/cleanup-inactive',
        { older_than_hours: cleanupHours, dry_run: true },
      );
      setCleanupPreview(res);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setCleanupBusy(false);
    }
  }

  async function doCleanupConfirm() {
    setCleanupBusy(true);
    try {
      const res = await api.post<{ deleted: number }>(
        '/admin/users/cleanup-inactive',
        { older_than_hours: cleanupHours, dry_run: false },
      );
      setCleanupOpen(false);
      setCleanupPreview(null);
      await load();
      alert(`已清理 ${res.deleted} 个无效账户`);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setCleanupBusy(false);
    }
  }

  async function act() {
    if (!acting) return;
    if ((acting.action === 'suspend' || acting.action === 'ban') && !reason.trim()) return;
    setBusy(acting.user.id);
    try {
      const body = acting.action === 'restore' ? undefined : { reason };
      await api.post(`/admin/users/${acting.user.id}/${acting.action}`, body);
      setActing(null);
      setReason('');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(null);
    }
  }

  const label = SCOPE_LABEL[scope];

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{label}管理</h1>
        <div className="flex items-center gap-3">
          <div className="text-sm text-ink-500">
            共 {list.length} 位{label}
            <span className="ml-2 text-xs text-ink-400">
              (已激活 {counts.activated.toLocaleString()} · 未激活 {counts.inactive.toLocaleString()})
            </span>
          </div>
          {counts.inactive > 0 && (
            <button
              type="button"
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
              onClick={() => {
                setCleanupOpen(true);
                setCleanupPreview(null);
              }}
            >
              🧹 清理无效账户
            </button>
          )}
        </div>
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* 激活状态筛选 · 默认 only · 不污染主表 */}
          <div className="flex gap-1 rounded-lg border border-ink-100 p-0.5 text-xs">
            {([
              { k: 'only', label: '✓ 已激活', cls: 'bg-emerald-100 text-emerald-700' },
              { k: 'inactive', label: '⚠ 未激活', cls: 'bg-amber-100 text-amber-700' },
              { k: 'all', label: '全部', cls: 'bg-ink-100 text-ink-700' },
            ] as const).map((m) => (
              <button
                key={m.k}
                type="button"
                onClick={() => setActivatedMode(m.k)}
                className={`rounded px-2.5 py-1 transition ${
                  activatedMode === m.k ? m.cls : 'text-ink-500 hover:bg-ink-50'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value as never)}>
            <option value="">所有状态</option>
            <option value="active">active</option>
            <option value="pending">pending</option>
            <option value="suspended">suspended</option>
            <option value="banned">banned</option>
          </select>
          <input
            className="input flex-1"
            placeholder={`按${label}昵称搜索`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
          />
          <button type="button" onClick={() => void load()} className="btn-primary">
            搜索
          </button>
        </div>
      </div>

      {/* 清理无效账户 modal */}
      {cleanupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setCleanupOpen(false);
              setCleanupPreview(null);
            }
          }}
        >
          <div className="card w-full max-w-lg">
            <h3 className="text-base font-semibold">🧹 清理无效账户</h3>
            <p className="mt-1 text-xs text-ink-500">
              activated_at IS NULL(从未产生过 chat / order / conversation 活动)且超过指定时长的账户将被永久删除。
              CASCADE 会自动清理外键引用。
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-ink-500">仅删除注册超过(小时)</label>
                <input
                  type="number"
                  min={1}
                  max={720}
                  className="input w-full font-mono"
                  value={cleanupHours}
                  onChange={(e) => {
                    setCleanupHours(Number(e.target.value) || 24);
                    setCleanupPreview(null);
                  }}
                />
                <div className="mt-1 text-[10px] text-ink-400">
                  默认 24,建议 ≥ 24 给用户充分注册时间
                </div>
              </div>

              {cleanupPreview && (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <div className="font-semibold">预览:将删除 {cleanupPreview.would_delete} 个账户</div>
                  {cleanupPreview.sample.length > 0 && (
                    <div className="mt-1 text-[10px] text-amber-700">
                      样本(前 10):
                      <ul className="mt-0.5 max-h-32 overflow-y-auto font-mono">
                        {cleanupPreview.sample.map((s) => (
                          <li key={s.id}>
                            {s.id.slice(0, 8)} · {new Date(s.created_at).toLocaleString('zh-CN')}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setCleanupOpen(false);
                  setCleanupPreview(null);
                }}
                disabled={cleanupBusy}
              >
                取消
              </button>
              {!cleanupPreview ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void doCleanupPreview()}
                  disabled={cleanupBusy}
                >
                  {cleanupBusy ? '查询中…' : '预览(dry-run)'}
                </button>
              ) : cleanupPreview.would_delete === 0 ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setCleanupOpen(false);
                    setCleanupPreview(null);
                  }}
                >
                  没有可清理的
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                  onClick={() => {
                    if (confirm(`确认永久删除 ${cleanupPreview.would_delete} 个账户?此操作不可撤回。`)) {
                      void doCleanupConfirm();
                    }
                  }}
                  disabled={cleanupBusy}
                >
                  {cleanupBusy ? '清理中…' : `确认删除 ${cleanupPreview.would_delete} 个`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>昵称</th>
              <th>状态</th>
              <th className="text-right">积分</th>
              <th>locale</th>
              <th>注册时间</th>
              <th>最近活跃</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-ink-500">
                  没有符合条件的{label}
                </td>
              </tr>
            )}
            {list.map((u) => (
              <tr key={u.id}>
                <td className="font-mono text-xs">
                  <div className="flex items-center gap-1.5">
                    <Link href={`/users/${scope}s/${u.id}`} className="text-rose-600 hover:underline" title={u.id}>
                      {u.id.slice(0, 8)}…
                    </Link>
                    <button
                      type="button"
                      onClick={() => copyId(u.id)}
                      title="复制完整 UID"
                      className={`rounded border px-1.5 py-0.5 text-[10px] transition ${
                        copiedId === u.id
                          ? 'border-green-300 bg-green-50 text-green-700'
                          : 'border-ink-200 text-ink-500 hover:bg-ink-50'
                      }`}
                    >
                      {copiedId === u.id ? '✓ 已复制' : '复制 UID'}
                    </button>
                  </div>
                </td>
                <td>
                  <Link href={`/users/${scope}s/${u.id}`} className="hover:underline">
                    {u.display_name ?? '—'}
                  </Link>
                </td>
                <td>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      u.status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : u.status === 'banned'
                          ? 'bg-red-100 text-red-700'
                          : u.status === 'suspended'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-ink-100'
                    }`}
                  >
                    {u.status}
                  </span>
                </td>
                <td className="text-right font-mono text-xs">
                  <span className={u.points_balance > 0 ? 'font-semibold text-rose-700' : 'text-ink-400'}>
                    {(u.points_balance ?? 0).toLocaleString()}
                  </span>
                </td>
                <td className="text-xs">{u.locale}</td>
                <td className="text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="text-xs">
                  {u.last_active_at ? new Date(u.last_active_at).toLocaleDateString() : '—'}
                </td>
                <td className="text-right">
                  <Link
                    href={`/users/${scope}s/${u.id}`}
                    className="btn-ghost mr-1 inline-flex h-7 items-center px-3 text-xs"
                  >
                    详情
                  </Link>
                  {u.status === 'active' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setActing({ user: u, action: 'suspend' })}
                        className="btn-ghost mr-1 h-7 px-3 text-xs"
                      >
                        暂停
                      </button>
                      <button
                        type="button"
                        onClick={() => setActing({ user: u, action: 'ban' })}
                        className="btn-danger h-7 px-3 text-xs"
                      >
                        封禁
                      </button>
                    </>
                  )}
                  {(u.status === 'suspended' || u.status === 'banned') && (
                    <button
                      type="button"
                      onClick={() => setActing({ user: u, action: 'restore' })}
                      disabled={busy === u.id}
                      className="btn-primary h-7 px-3 text-xs"
                    >
                      解封
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {acting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="card w-full max-w-md">
            <h3 className="mb-3 text-base font-semibold">
              {acting.action === 'suspend' ? '暂停账号' : acting.action === 'ban' ? '永久封禁' : '解封账号'}
            </h3>
            <div className="mb-3 text-xs text-ink-500">
              {label}：{acting.user.display_name ?? '—'} · {acting.user.id.slice(0, 8)}
            </div>
            {acting.action !== 'restore' && (
              <textarea
                className="h-24 w-full rounded-lg border border-ink-100 p-3 text-sm"
                placeholder="处置原因（用户可见）"
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
                onClick={() => void act()}
                disabled={busy === acting.user.id || (acting.action !== 'restore' && !reason.trim())}
                className={acting.action === 'ban' ? 'btn-danger flex-1' : 'btn-primary flex-1'}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
