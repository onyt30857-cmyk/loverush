/**
 * Admin · 城市字典 · M02 Phase 5
 * 列表 + Modal CRUD · 参 flags 风格
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
  latCenter: string | null;
  lngCenter: string | null;
  sortOrder: number;
  enabled: number;
  updatedAt: string;
}

const LOCALES = ['zh', 'en', 'th', 'vi', 'ms', 'id'] as const;

type Draft = {
  code: string;
  countryCode: string;
  translations: Record<string, string>;
  latCenter: string;
  lngCenter: string;
  sortOrder: number;
  enabled: boolean;
};

const EMPTY_DRAFT: Draft = {
  code: '',
  countryCode: 'TH',
  translations: { zh: '', en: '' },
  latCenter: '',
  lngCenter: '',
  sortOrder: 100,
  enabled: true,
};

export default function CitiesPage() {
  const [list, setList] = useState<City[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<City | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  async function load() {
    try {
      setList(await api.get<City[]>('/admin/geo/cities'));
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setDraft(EMPTY_DRAFT);
    setCreating(true);
  }

  function openEdit(c: City) {
    setDraft({
      code: c.code,
      countryCode: c.countryCode,
      translations: { ...c.translations },
      latCenter: c.latCenter ?? '',
      lngCenter: c.lngCenter ?? '',
      sortOrder: c.sortOrder,
      enabled: c.enabled === 1,
    });
    setEditing(c);
  }

  async function save() {
    const payload = {
      code: draft.code,
      country_code: draft.countryCode,
      translations: draft.translations,
      lat_center: draft.latCenter || null,
      lng_center: draft.lngCenter || null,
      sort_order: draft.sortOrder,
      enabled: draft.enabled,
    };
    try {
      if (editing) {
        const { code: _omit, ...patch } = payload;
        void _omit;
        await api.patch(`/admin/geo/cities/${editing.id}`, patch);
      } else {
        await api.post('/admin/geo/cities', payload);
      }
      setEditing(null);
      setCreating(false);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  async function softDelete(c: City) {
    if (!confirm(`停用城市 ${c.translations.zh ?? c.code}? 该城市的技师必须先迁移`)) return;
    try {
      await api.delete(`/admin/geo/cities/${c.id}`);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">🌏 城市字典</h1>
        <button type="button" onClick={openCreate} className="btn-primary">
          + 新建城市
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>code</th>
              <th>国家</th>
              <th>中文</th>
              <th>英文</th>
              <th>泰文</th>
              <th>排序</th>
              <th>状态</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-ink-500">
                  还没有城市
                </td>
              </tr>
            )}
            {list.map((c) => (
              <tr key={c.id} className={c.enabled === 0 ? 'opacity-50' : ''}>
                <td className="font-mono text-xs">{c.code}</td>
                <td className="font-mono text-xs">{c.countryCode}</td>
                <td>{c.translations.zh ?? '—'}</td>
                <td>{c.translations.en ?? '—'}</td>
                <td>{c.translations.th ?? '—'}</td>
                <td className="font-mono">{c.sortOrder}</td>
                <td>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      c.enabled === 1 ? 'bg-green-100 text-green-700' : 'bg-ink-100'
                    }`}
                  >
                    {c.enabled === 1 ? '启用' : '禁用'}
                  </span>
                </td>
                <td className="space-x-1 text-right">
                  <button type="button" onClick={() => openEdit(c)} className="btn-ghost h-7 px-3 text-xs">
                    编辑
                  </button>
                  {c.enabled === 1 && (
                    <button
                      type="button"
                      onClick={() => void softDelete(c)}
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
        <Modal title={editing ? `编辑 ${editing.code}` : '新建城市'} onClose={() => { setEditing(null); setCreating(false); }}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs">code(slug · 创建后不可改)</div>
                <input
                  className="input w-full"
                  placeholder="bangkok"
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  disabled={!!editing}
                />
              </div>
              <div>
                <div className="mb-1 text-xs">国家码</div>
                <input
                  className="input w-full"
                  placeholder="TH"
                  value={draft.countryCode}
                  onChange={(e) => setDraft({ ...draft, countryCode: e.target.value.toUpperCase() })}
                />
              </div>
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
                <div className="mb-1 text-xs">中心 lat(可选 · Phase 2 GPS 用)</div>
                <input
                  className="input w-full"
                  placeholder="13.7563"
                  value={draft.latCenter}
                  onChange={(e) => setDraft({ ...draft, latCenter: e.target.value })}
                />
              </div>
              <div>
                <div className="mb-1 text-xs">中心 lng</div>
                <input
                  className="input w-full"
                  placeholder="100.5018"
                  value={draft.lngCenter}
                  onChange={(e) => setDraft({ ...draft, lngCenter: e.target.value })}
                />
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
                <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
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
