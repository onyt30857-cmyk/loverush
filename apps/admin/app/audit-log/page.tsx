'use client';

/**
 * 后台操作审计日志 · 合规底线
 *
 * 对应 API：
 *   - GET /admin/audit-log（JSON · 分页 + 过滤）
 *   - GET /admin/audit-log.csv（CSV 导出 · 最多 50000 行）
 *
 * 表 admin_audit_log 是 append-only（PostgreSQL trigger 拒绝 UPDATE/DELETE/TRUNCATE），
 * 应用层只读，不暴露任何修改入口。
 */

import { useEffect, useMemo, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface AuditLogRow {
  id: string;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

const PAGE_LIMIT = 100;

// 与 OPERATIONS.md §14.4 / §14.6 对齐的 13 个 action 选项
const ACTION_OPTIONS = [
  '', // 全部
  'user.suspend',
  'user.ban',
  'user.restore',
  'role.grant',
  'role.revoke',
  'withdraw.approve',
  'withdraw.reject',
  'flag.upsert',
  'flag.override.set',
  'flag.override.remove',
  'ticket.assign',
  'ticket.resolve',
  'order.resolve_dispute',
];

const ACTOR_ROLE_OPTIONS = ['', 'admin', 'ops', 'cs', 'finance', 'auditor'];

export default function AuditLogPage() {
  const [list, setList] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 过滤条件
  const [actorRole, setActorRole] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');

  const queryParams = useMemo(
    () => ({
      actor_role: actorRole || undefined,
      action: action || undefined,
      target_type: targetType || undefined,
      target_id: targetId || undefined,
      since: since || undefined,
      until: until || undefined,
      limit: PAGE_LIMIT,
      offset,
    }),
    [actorRole, action, targetType, targetId, since, until, offset],
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.get<AuditLogRow[]>('/admin/audit-log', queryParams);
      setList(rows);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError('加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorRole, action, targetType, targetId, since, until, offset]);

  function exportCsv() {
    const params = new URLSearchParams();
    if (actorRole) params.set('actor_role', actorRole);
    if (action) params.set('action', action);
    if (targetType) params.set('target_type', targetType);
    if (targetId) params.set('target_id', targetId);
    if (since) params.set('since', since);
    if (until) params.set('until', until);
    params.set('limit', '50000'); // 服务端最大 50000

    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('admin_access_token') : null;

    // CSV 端点需要 auth header，不能直接 window.open · 用 fetch + blob
    void fetch(`${base}/admin/audit-log.csv?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-log-${new Date().toISOString().slice(0, 19)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((e: Error) => setError(`CSV 导出失败：${e.message}`));
  }

  function resetFilters() {
    setActorRole('');
    setAction('');
    setTargetType('');
    setTargetId('');
    setSince('');
    setUntil('');
    setOffset(0);
  }

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">审计日志</h1>
          <p className="mt-1 text-xs text-ink-500">
            admin_audit_log 是 append-only 表，所有后台敏感操作（13 类 action）自动留痕 · 不可篡改
          </p>
        </div>
        <button type="button" onClick={exportCsv} className="btn-primary h-9 px-4 text-sm">
          导出 CSV
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {/* 过滤条 */}
      <div className="card mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <label className="text-xs">
            <div className="mb-1 text-ink-500">Actor 角色</div>
            <select
              value={actorRole}
              onChange={(e) => {
                setActorRole(e.target.value);
                setOffset(0);
              }}
              className="w-full rounded border border-ink-100 px-2 py-1"
            >
              {ACTOR_ROLE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || '全部'}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs">
            <div className="mb-1 text-ink-500">Action</div>
            <select
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setOffset(0);
              }}
              className="w-full rounded border border-ink-100 px-2 py-1"
            >
              {ACTION_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o || '全部'}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs">
            <div className="mb-1 text-ink-500">Target 类型</div>
            <input
              type="text"
              value={targetType}
              onChange={(e) => {
                setTargetType(e.target.value);
                setOffset(0);
              }}
              placeholder="user / order / flag / …"
              className="w-full rounded border border-ink-100 px-2 py-1"
            />
          </label>

          <label className="text-xs">
            <div className="mb-1 text-ink-500">Target ID</div>
            <input
              type="text"
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                setOffset(0);
              }}
              placeholder="UUID"
              className="w-full rounded border border-ink-100 px-2 py-1 font-mono"
            />
          </label>

          <label className="text-xs">
            <div className="mb-1 text-ink-500">起始时间</div>
            <input
              type="datetime-local"
              value={since}
              onChange={(e) => {
                setSince(e.target.value);
                setOffset(0);
              }}
              className="w-full rounded border border-ink-100 px-2 py-1"
            />
          </label>

          <label className="text-xs">
            <div className="mb-1 text-ink-500">截止时间</div>
            <input
              type="datetime-local"
              value={until}
              onChange={(e) => {
                setUntil(e.target.value);
                setOffset(0);
              }}
              className="w-full rounded border border-ink-100 px-2 py-1"
            />
          </label>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs">
          <button type="button" onClick={resetFilters} className="btn-ghost h-7 px-3">
            重置过滤
          </button>
          <span className="text-ink-500">
            当前 {list.length} 条（offset={offset}，limit={PAGE_LIMIT}）
          </span>
        </div>
      </div>

      {/* 主表 */}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>Actor</th>
              <th>角色</th>
              <th>Action</th>
              <th>Target</th>
              <th>IP</th>
              <th>Request</th>
              <th className="text-right">详情</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-ink-500">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-ink-500">
                  暂无记录
                </td>
              </tr>
            )}
            {list.map((r) => {
              const expanded = expandedId === r.id;
              return (
                <Row
                  key={r.id}
                  row={r}
                  expanded={expanded}
                  onToggle={() => setExpandedId(expanded ? null : r.id)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <div className="mt-4 flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => setOffset(Math.max(0, offset - PAGE_LIMIT))}
          disabled={offset === 0 || loading}
          className="btn-ghost h-8 px-3"
        >
          ← 上页
        </button>
        <span className="text-xs text-ink-500">第 {Math.floor(offset / PAGE_LIMIT) + 1} 页</span>
        <button
          type="button"
          onClick={() => setOffset(offset + PAGE_LIMIT)}
          disabled={list.length < PAGE_LIMIT || loading}
          className="btn-ghost h-8 px-3"
        >
          下页 →
        </button>
      </div>
    </AdminShell>
  );
}

function Row({
  row,
  expanded,
  onToggle,
}: {
  row: AuditLogRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const actionColor =
    row.action.startsWith('user.') || row.action.includes('ban')
      ? 'bg-red-50 text-red-700'
      : row.action.startsWith('role.')
      ? 'bg-purple-50 text-purple-700'
      : row.action.startsWith('flag.')
      ? 'bg-yellow-50 text-yellow-700'
      : row.action.startsWith('withdraw.')
      ? 'bg-green-50 text-green-700'
      : 'bg-ink-100 text-ink-700';

  return (
    <>
      <tr>
        <td className="whitespace-nowrap text-xs">{new Date(row.createdAt).toLocaleString()}</td>
        <td className="font-mono text-xs">{row.actorUserId ? `${row.actorUserId.slice(0, 8)}…` : '—'}</td>
        <td className="text-xs">{row.actorRole ?? '—'}</td>
        <td>
          <span className={`rounded px-2 py-0.5 text-xs ${actionColor}`}>{row.action}</span>
        </td>
        <td className="text-xs">
          {row.targetType ? (
            <span>
              <span className="text-ink-500">{row.targetType}/</span>
              <span className="font-mono">{row.targetId ? `${row.targetId.slice(0, 8)}…` : '—'}</span>
            </span>
          ) : (
            '—'
          )}
        </td>
        <td className="text-xs font-mono">{row.ip ?? '—'}</td>
        <td className="text-xs font-mono">{row.requestId ? `${row.requestId.slice(0, 8)}…` : '—'}</td>
        <td className="text-right">
          <button type="button" onClick={onToggle} className="btn-ghost h-6 px-2 text-xs">
            {expanded ? '收起' : '展开'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-ink-50 px-4 py-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-xs">
              <div>
                <div className="mb-1 font-semibold text-ink-700">Before</div>
                <pre className="overflow-x-auto rounded bg-white p-2 text-[10px]">
                  {row.before ? JSON.stringify(row.before, null, 2) : '(无)'}
                </pre>
              </div>
              <div>
                <div className="mb-1 font-semibold text-ink-700">After</div>
                <pre className="overflow-x-auto rounded bg-white p-2 text-[10px]">
                  {row.after ? JSON.stringify(row.after, null, 2) : '(无)'}
                </pre>
              </div>
              {row.reason && (
                <div className="md:col-span-2">
                  <div className="mb-1 font-semibold text-ink-700">Reason</div>
                  <div className="rounded bg-white p-2">{row.reason}</div>
                </div>
              )}
              {row.userAgent && (
                <div className="md:col-span-2 text-[10px] text-ink-500">
                  <span className="font-semibold">UA:</span> {row.userAgent}
                </div>
              )}
              {row.requestId && (
                <div className="text-[10px] text-ink-500">
                  <span className="font-semibold">Request ID:</span> <span className="font-mono">{row.requestId}</span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
