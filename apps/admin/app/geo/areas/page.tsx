/**
 * Admin · 区域字典 · M02 Phase 5
 * 顶部 city dropdown + 该 city 下 areas 表 + Modal CRUD
 */
'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface City {
  id: string;
  code: string;
  countryCode: string;
  translations: Record<string, string>;
}

interface Area {
  id: string;
  cityId: string;
  code: string;
  translations: Record<string, string>;
  sortOrder: number;
  enabled: number;
  updatedAt: string;
}

const LOCALES = ['zh', 'en', 'th', 'vi', 'ms', 'id'] as const;

type Draft = { code: string; translations: Record<string, string>; sortOrder: number; enabled: boolean };
const EMPTY_DRAFT: Draft = { code: '', translations: { zh: '', en: '' }, sortOrder: 100, enabled: true };

export default function AreasPage() {
  const [cities, setCities] = useState<City[]>([]);
  const [cityId, setCityId] = useState<string>('');
  const [areas, setAreas] = useState<Area[]>([]);
  const [editing, setEditing] = useState<Area | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<City[]>('/admin/geo/cities');
        setCities(list);
        if (list[0]) setCityId(list[0].id);
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
      }
    })();
  }, []);

  async function loadAreas() {
    if (!cityId) return;
    try {
      setAreas(await api.get<Area[]>(`/admin/geo/cities/${cityId}/areas`));
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }
  useEffect(() => {
    void loadAreas();
  }, [cityId]);

  async function save() {
    const payload = {
      code: draft.code,
      translations: draft.translations,
      sort_order: draft.sortOrder,
      enabled: draft.enabled,
    };
    try {
      if (editing) {
        const { code: _omit, ...patch } = payload;
        void _omit;
        await api.patch(`/admin/geo/areas/${editing.id}`, patch);
      } else {
        await api.post(`/admin/geo/cities/${cityId}/areas`, payload);
      }
      setEditing(null);
      setCreating(false);
      setDraft(EMPTY_DRAFT);
      await loadAreas();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  async function softDelete(a: Area) {
    if (!confirm(`停用区域 ${a.translations.zh ?? a.code}?`)) return;
    try {
      await api.delete(`/admin/geo/areas/${a.id}`);
      await loadAreas();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  const cityLabel = (c: City) => `${c.translations.zh ?? c.code} (${c.countryCode})`;

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">🌏 区域字典</h1>
        <div className="flex items-center gap-2">
          <select value={cityId} onChange={(e) => setCityId(e.target.value)} className="input h-9 text-sm">
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {cityLabel(c)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setDraft(EMPTY_DRAFT);
              setCreating(true);
            }}
            className="btn-primary"
            disabled={!cityId}
          >
            + 新建区域
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>code</th>
              <th>中文</th>
              <th>英文</th>
              <th>泰文</th>
              <th>排序</th>
              <th>状态</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {areas.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-ink-500">
                  该城市还没有区域
                </td>
              </tr>
            )}
            {areas.map((a) => (
              <tr key={a.id} className={a.enabled === 0 ? 'opacity-50' : ''}>
                <td className="font-mono text-xs">{a.code}</td>
                <td>{a.translations.zh ?? '—'}</td>
                <td>{a.translations.en ?? '—'}</td>
                <td>{a.translations.th ?? '—'}</td>
                <td className="font-mono">{a.sortOrder}</td>
                <td>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      a.enabled === 1 ? 'bg-green-100 text-green-700' : 'bg-ink-100'
                    }`}
                  >
                    {a.enabled === 1 ? '启用' : '禁用'}
                  </span>
                </td>
                <td className="space-x-1 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setDraft({
                        code: a.code,
                        translations: { ...a.translations },
                        sortOrder: a.sortOrder,
                        enabled: a.enabled === 1,
                      });
                      setEditing(a);
                    }}
                    className="btn-ghost h-7 px-3 text-xs"
                  >
                    编辑
                  </button>
                  {a.enabled === 1 && (
                    <button
                      type="button"
                      onClick={() => void softDelete(a)}
                      className="btn-ghost h-7 px-3 text-xs text-red-600"
                    >
                      停用
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <Modal title={editing ? `编辑 ${editing.code}` : '新建区域'} onClose={() => { setEditing(null); setCreating(false); }}>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs">code(slug · 创建后不可改)</div>
              <input
                className="input w-full"
                placeholder="asok"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                disabled={!!editing}
              />
            </div>
            <div>
              <div className="mb-1 text-xs">6 语种翻译</div>
              <div className="grid grid-cols-2 gap-2">
                {LOCALES.map((l) => (
                  <input
                    key={l}
                    className="input"
                    placeholder={l}
                    value={draft.translations[l] ?? ''}
                    onChange={(e) =>
                      setDraft({ ...draft, translations: { ...draft.translations, [l]: e.target.value } })
                    }
                  />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs">排序</div>
                <input
                  type="number"
                  className="input w-full"
                  value={draft.sortOrder}
                  onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) || 100 })}
                />
              </div>
              <label className="flex items-end gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                />
                启用
              </label>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => { setEditing(null); setCreating(false); }} className="btn-ghost flex-1">
                取消
              </button>
              <button type="button" onClick={() => void save()} className="btn-primary flex-1">
                保存
              </button>
            </div>
          </div>
        </Modal>
      )}
    </AdminShell>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="text-ink-300">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
