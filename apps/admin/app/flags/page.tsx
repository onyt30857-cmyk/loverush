'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface Flag {
  id: string;
  key: string;
  description: string | null;
  defaultEnabled: number;
  rolloutBps: number;
  targetUserType: string | null;
  targetLocales: string[] | null;
  targetCities: string[] | null;
  enabled: number;
  updatedAt: string;
}

export default function FlagsPage() {
  const [list, setList] = useState<Flag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Flag | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Partial<Flag> & { key: string }>({ key: '' });

  async function load() {
    try {
      setList(await api.get<Flag[]>('/admin/flags'));
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    const target = editing ?? (draft as Flag);
    try {
      await api.put(`/admin/flags/${target.key}`, {
        description: target.description,
        default_enabled: target.defaultEnabled === 1,
        rollout_bps: target.rolloutBps,
        target_user_type: target.targetUserType,
        target_locales: target.targetLocales,
        target_cities: target.targetCities,
        enabled: target.enabled === undefined ? true : target.enabled === 1,
      });
      setEditing(null);
      setCreating(false);
      setDraft({ key: '' });
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Feature Flag · 灰度</h1>
        <button type="button" onClick={() => setCreating(true)} className="btn-primary">+ 新建</button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Key</th>
              <th>说明</th>
              <th>开关</th>
              <th>默认</th>
              <th>灰度 %</th>
              <th>目标</th>
              <th>更新时间</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-ink-500">还没有 flag</td></tr>}
            {list.map((f) => (
              <tr key={f.key}>
                <td className="font-mono text-xs">{f.key}</td>
                <td className="max-w-[200px] truncate">{f.description ?? '—'}</td>
                <td>
                  <span className={`rounded px-2 py-0.5 text-xs ${f.enabled === 1 ? 'bg-green-100 text-green-700' : 'bg-ink-100'}`}>
                    {f.enabled === 1 ? '开' : '关'}
                  </span>
                </td>
                <td>{f.defaultEnabled === 1 ? '✓' : '×'}</td>
                <td className="font-mono">{(f.rolloutBps / 100).toFixed(1)}%</td>
                <td className="text-xs">
                  {f.targetUserType && <div>{f.targetUserType}</div>}
                  {f.targetCities?.length ? <div>{f.targetCities.join(', ')}</div> : null}
                  {f.targetLocales?.length ? <div>{f.targetLocales.join(', ')}</div> : null}
                </td>
                <td className="text-xs">{new Date(f.updatedAt).toLocaleString()}</td>
                <td className="text-right">
                  <button type="button" onClick={() => setEditing(f)} className="btn-ghost h-7 px-3 text-xs">编辑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <Modal title={editing ? `编辑 ${editing.key}` : '新建 flag'} onClose={() => { setEditing(null); setCreating(false); }}>
          {creating && (
            <input
              className="input mb-3 w-full"
              placeholder="flag_key (snake_case)"
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            />
          )}
          <textarea
            className="mb-3 h-20 w-full rounded-lg border border-ink-100 p-3 text-sm"
            placeholder="描述"
            value={(editing ?? draft).description ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              editing ? setEditing({ ...editing, description: v }) : setDraft({ ...draft, description: v });
            }}
          />
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={(editing ?? draft).enabled === 1}
                onChange={(e) => {
                  const v = e.target.checked ? 1 : 0;
                  editing ? setEditing({ ...editing, enabled: v }) : setDraft({ ...draft, enabled: v });
                }}
              />
              总开关 enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={(editing ?? draft).defaultEnabled === 1}
                onChange={(e) => {
                  const v = e.target.checked ? 1 : 0;
                  editing ? setEditing({ ...editing, defaultEnabled: v }) : setDraft({ ...draft, defaultEnabled: v });
                }}
              />
              默认开
            </label>
          </div>
          <div className="mb-3">
            <div className="mb-1 text-xs">灰度比例 ({((editing ?? draft).rolloutBps ?? 0) / 100}%)</div>
            <input
              type="range"
              min={0}
              max={10000}
              step={500}
              value={(editing ?? draft).rolloutBps ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                editing ? setEditing({ ...editing, rolloutBps: v }) : setDraft({ ...draft, rolloutBps: v });
              }}
              className="w-full accent-primary"
            />
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-xs">仅 user_type（可选）</div>
              <select
                className="input w-full"
                value={(editing ?? draft).targetUserType ?? ''}
                onChange={(e) => {
                  const v = e.target.value || null;
                  editing ? setEditing({ ...editing, targetUserType: v }) : setDraft({ ...draft, targetUserType: v });
                }}
              >
                <option value="">— 不限 —</option>
                <option value="customer">customer</option>
                <option value="therapist">therapist</option>
              </select>
            </div>
            <div>
              <div className="mb-1 text-xs">城市（逗号分隔）</div>
              <input
                className="input w-full"
                placeholder="Bangkok, Kuala Lumpur"
                value={((editing ?? draft).targetCities ?? []).join(', ')}
                onChange={(e) => {
                  const v = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                  editing ? setEditing({ ...editing, targetCities: v }) : setDraft({ ...draft, targetCities: v });
                }}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setEditing(null); setCreating(false); }} className="btn-ghost flex-1">取消</button>
            <button type="button" onClick={() => void save()} className="btn-primary flex-1">保存</button>
          </div>
        </Modal>
      )}
    </AdminShell>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="card w-full max-w-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="text-ink-300">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
