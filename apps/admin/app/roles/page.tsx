'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

const ROLES = ['admin', 'auditor', 'finance', 'cs', 'ops'] as const;
type Role = (typeof ROLES)[number];

export default function RolesPage() {
  const [targetRole, setTargetRole] = useState<Role>('cs');
  const [list, setList] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [grantUserId, setGrantUserId] = useState('');
  const [revokeUserId, setRevokeUserId] = useState('');

  async function load() {
    try {
      const rows = await api.get<string[]>(`/admin/roles/${targetRole}/users`);
      setList(rows);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRole]);

  async function grant() {
    if (!grantUserId) return;
    try {
      await api.post('/admin/roles', { user_id: grantUserId, role: targetRole });
      setGrantUserId('');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  async function revoke() {
    if (!revokeUserId) return;
    try {
      await api.delete('/admin/roles', { user_id: revokeUserId, role: targetRole, reason: 'admin revoke' });
      setRevokeUserId('');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  return (
    <AdminShell>
      <h1 className="mb-6 text-2xl font-bold">角色管理</h1>

      <div className="mb-4 flex gap-2">
        {ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setTargetRole(r)}
            className={`rounded-lg px-4 py-2 text-sm ${
              targetRole === r ? 'bg-primary text-white' : 'bg-white text-ink-700 hover:bg-ink-50'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">赋予 {targetRole} 角色</h3>
          <input
            className="input mb-2 w-full"
            placeholder="user_id (uuid)"
            value={grantUserId}
            onChange={(e) => setGrantUserId(e.target.value)}
          />
          <button type="button" onClick={() => void grant()} disabled={!grantUserId} className="btn-primary w-full">
            赋权
          </button>
        </div>

        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">撤销 {targetRole} 角色</h3>
          <input
            className="input mb-2 w-full"
            placeholder="user_id (uuid)"
            value={revokeUserId}
            onChange={(e) => setRevokeUserId(e.target.value)}
          />
          <button type="button" onClick={() => void revoke()} disabled={!revokeUserId} className="btn-danger w-full">
            撤销
          </button>
        </div>
      </div>

      <div className="card mt-4">
        <h3 className="mb-3 text-sm font-semibold">持有 {targetRole} 角色的用户（{list.length}）</h3>
        {list.length === 0 ? (
          <div className="text-sm text-ink-500">还没有用户持有此角色</div>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {list.map((id) => (
              <li key={id} className="flex items-center justify-between rounded bg-ink-50 px-3 py-2">
                <span>{id}</span>
                <button
                  type="button"
                  onClick={() => {
                    setRevokeUserId(id);
                  }}
                  className="text-primary"
                >
                  填入撤销框
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminShell>
  );
}
