'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface UserRow {
  id: string;
  user_type: 'customer' | 'therapist';
  status: 'pending' | 'active' | 'suspended' | 'banned';
  display_name: string | null;
  locale: string;
  created_at: string;
  last_active_at: string | null;
  banned_at: string | null;
}

export default function UsersPage() {
  const [list, setList] = useState<UserRow[]>([]);
  const [userType, setUserType] = useState<'customer' | 'therapist' | ''>('');
  const [status, setStatus] = useState<UserRow['status'] | ''>('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [acting, setActing] = useState<{ user: UserRow; action: 'suspend' | 'ban' | 'restore' } | null>(null);
  const [reason, setReason] = useState('');

  async function load() {
    try {
      const rows = await api.get<UserRow[]>('/admin/users', {
        user_type: userType || undefined,
        status: status || undefined,
        search: search || undefined,
        limit: 100,
      });
      setList(rows);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userType, status]);

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

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">用户管理</h1>
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <select className="input w-40" value={userType} onChange={(e) => setUserType(e.target.value as never)}>
            <option value="">所有类型</option>
            <option value="customer">customer</option>
            <option value="therapist">therapist</option>
          </select>
          <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value as never)}>
            <option value="">所有状态</option>
            <option value="active">active</option>
            <option value="pending">pending</option>
            <option value="suspended">suspended</option>
            <option value="banned">banned</option>
          </select>
          <input
            className="input flex-1"
            placeholder="按昵称搜索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load()}
          />
          <button type="button" onClick={() => void load()} className="btn-primary">搜索</button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>类型</th>
              <th>昵称</th>
              <th>状态</th>
              <th>locale</th>
              <th>注册时间</th>
              <th>最近活跃</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-ink-500">没有符合条件的用户</td></tr>}
            {list.map((u) => (
              <tr key={u.id}>
                <td className="font-mono text-xs">{u.id.slice(0, 8)}…</td>
                <td><span className="rounded bg-ink-100 px-2 py-0.5 text-xs">{u.user_type}</span></td>
                <td>{u.display_name ?? '—'}</td>
                <td>
                  <span className={`rounded px-2 py-0.5 text-xs ${
                    u.status === 'active' ? 'bg-green-100 text-green-700' :
                    u.status === 'banned' ? 'bg-red-100 text-red-700' :
                    u.status === 'suspended' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-ink-100'
                  }`}>
                    {u.status}
                  </span>
                </td>
                <td className="text-xs">{u.locale}</td>
                <td className="text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="text-xs">{u.last_active_at ? new Date(u.last_active_at).toLocaleDateString() : '—'}</td>
                <td className="text-right">
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
              用户：{acting.user.display_name ?? '—'} · {acting.user.id.slice(0, 8)}
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
              <button type="button" onClick={() => { setActing(null); setReason(''); }} className="btn-ghost flex-1">
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
    </AdminShell>
  );
}
