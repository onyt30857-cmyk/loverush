/**
 * Admin · 类目网格运营 · M02 Phase 4
 *
 * 列表 + 行编辑 modal · 字段:code/emoji/label/sortOrder/filter_condition jsonb
 * filter_condition 是点击后的结构化跳转条件(如 { skill: '泰式' })
 */
'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface SearchCategory {
  id: string;
  code: string;
  emoji: string | null;
  label: string;
  sortOrder: number;
  enabled: number;
  filterCondition: Record<string, unknown> | null;
  targetLocales: string[] | null;
  targetCities: string[] | null;
  createdAt: string;
  updatedAt: string;
}

type Draft = Partial<SearchCategory> & { code: string; label: string };

export default function CategoriesPage() {
  const [list, setList] = useState<SearchCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SearchCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>({ code: '', label: '' });
  const [filterJson, setFilterJson] = useState<string>('');

  async function load() {
    try {
      setList(await api.get<SearchCategory[]>('/admin/search/categories'));
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openEdit(c: SearchCategory) {
    setEditing(c);
    setFilterJson(c.filterCondition ? JSON.stringify(c.filterCondition, null, 2) : '');
  }

  function openCreate() {
    setCreating(true);
    setFilterJson('');
  }

  async function save() {
    const target = editing ?? (draft as SearchCategory);
    // parse filter json
    let filterCondition: Record<string, unknown> | null = null;
    if (filterJson.trim()) {
      try {
        filterCondition = JSON.parse(filterJson);
      } catch {
        setError('filter_condition 不是合法 JSON');
        return;
      }
    }
    try {
      const body = {
        code: target.code,
        emoji: target.emoji ?? null,
        label: target.label,
        sort_order: target.sortOrder ?? 100,
        enabled: (target.enabled ?? 1) === 1,
        filter_condition: filterCondition,
        target_locales: target.targetLocales,
        target_cities: target.targetCities,
      };
      if (editing) {
        await api.patch(`/admin/search/categories/${editing.id}`, body);
      } else {
        await api.post('/admin/search/categories', body);
      }
      setEditing(null);
      setCreating(false);
      setDraft({ code: '', label: '' });
      setFilterJson('');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  async function softDelete(id: string) {
    if (!confirm('确定停用此类目？')) return;
    try {
      await api.delete(`/admin/search/categories/${id}`);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">🗂 类目网格</h1>
        <button type="button" onClick={openCreate} className="btn-primary">
          + 新建
        </button>
      </div>

      <p className="mb-4 text-sm text-ink-500">
        /search 页"按分类"区域的网格 · filter_condition 是点击后跳 results 时附加的结构化条件
      </p>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>排序</th>
              <th>code</th>
              <th>emoji</th>
              <th>标签</th>
              <th>开关</th>
              <th>filter_condition</th>
              <th>更新</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-ink-500">
                  还没有类目 · 前端用 fallback
                </td>
              </tr>
            )}
            {list.map((c) => (
              <tr key={c.id} className={c.enabled === 0 ? 'opacity-50' : ''}>
                <td className="font-mono">{c.sortOrder}</td>
                <td className="font-mono text-xs">{c.code}</td>
                <td className="text-xl">{c.emoji ?? '—'}</td>
                <td>{c.label}</td>
                <td>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      c.enabled === 1 ? 'bg-green-100 text-green-700' : 'bg-ink-100'
                    }`}
                  >
                    {c.enabled === 1 ? '开' : '关'}
                  </span>
                </td>
                <td className="max-w-[180px] truncate font-mono text-xs">
                  {c.filterCondition ? JSON.stringify(c.filterCondition) : '—'}
                </td>
                <td className="text-xs">{new Date(c.updatedAt).toLocaleString()}</td>
                <td className="space-x-1 text-right">
                  <button
                    type="button"
                    onClick={() => openEdit(c)}
                    className="btn-ghost h-7 px-3 text-xs"
                  >
                    编辑
                  </button>
                  {c.enabled === 1 && (
                    <button
                      type="button"
                      onClick={() => void softDelete(c.id)}
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
        <Modal
          title={editing ? `编辑 ${editing.code}` : '新建类目'}
          onClose={() => {
            setEditing(null);
            setCreating(false);
            setDraft({ code: '', label: '' });
            setFilterJson('');
          }}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs">code(唯一)</div>
                <input
                  className="input w-full"
                  placeholder="thai / oil / foot"
                  value={(editing ?? draft).code ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    editing ? setEditing({ ...editing, code: v }) : setDraft({ ...draft, code: v });
                  }}
                  disabled={!!editing}
                />
              </div>
              <div>
                <div className="mb-1 text-xs">emoji</div>
                <input
                  className="input w-full"
                  placeholder="🌿"
                  value={(editing ?? draft).emoji ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    editing
                      ? setEditing({ ...editing, emoji: v || null })
                      : setDraft({ ...draft, emoji: v || null });
                  }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs">label</div>
              <input
                className="input w-full"
                placeholder="泰式"
                value={(editing ?? draft).label ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  editing
                    ? setEditing({ ...editing, label: v })
                    : setDraft({ ...draft, label: v });
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs">排序</div>
                <input
                  type="number"
                  className="input w-full"
                  value={(editing ?? draft).sortOrder ?? 100}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    editing
                      ? setEditing({ ...editing, sortOrder: v })
                      : setDraft({ ...draft, sortOrder: v });
                  }}
                />
              </div>
              <label className="flex items-end gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={((editing ?? draft).enabled ?? 1) === 1}
                  onChange={(e) => {
                    const v = e.target.checked ? 1 : 0;
                    editing
                      ? setEditing({ ...editing, enabled: v })
                      : setDraft({ ...draft, enabled: v });
                  }}
                />
                启用
              </label>
            </div>
            <div>
              <div className="mb-1 text-xs">filter_condition(JSON · 点击后跳 results 附带的过滤)</div>
              <textarea
                className="h-24 w-full rounded-lg border border-ink-100 p-3 font-mono text-xs"
                placeholder={'{\n  "skill": "泰式"\n}'}
                value={filterJson}
                onChange={(e) => setFilterJson(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs">locales(逗号分隔 · 空=全部)</div>
                <input
                  className="input w-full"
                  placeholder="zh-CN, th"
                  value={((editing ?? draft).targetLocales ?? []).join(', ')}
                  onChange={(e) => {
                    const v = e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    const arr = v.length ? v : null;
                    editing
                      ? setEditing({ ...editing, targetLocales: arr })
                      : setDraft({ ...draft, targetLocales: arr });
                  }}
                />
              </div>
              <div>
                <div className="mb-1 text-xs">cities(逗号分隔)</div>
                <input
                  className="input w-full"
                  placeholder="曼谷, 清迈"
                  value={((editing ?? draft).targetCities ?? []).join(', ')}
                  onChange={(e) => {
                    const v = e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    const arr = v.length ? v : null;
                    editing
                      ? setEditing({ ...editing, targetCities: arr })
                      : setDraft({ ...draft, targetCities: arr });
                  }}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                  setDraft({ code: '', label: '' });
                  setFilterJson('');
                }}
                className="btn-ghost flex-1"
              >
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

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
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
