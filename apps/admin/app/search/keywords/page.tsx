/**
 * Admin · 热门词运营 · M02 Phase 4
 *
 * 列表 + 行编辑 modal · 参 flags 模板
 * 字段:keyword(唯一)/displayLabel/sortOrder/enabled/locale/city/时段
 */
'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface HotKeyword {
  id: string;
  keyword: string;
  displayLabel: string;
  sortOrder: number;
  enabled: number;
  targetLocales: string[] | null;
  targetCities: string[] | null;
  startsAt: string | null;
  endsAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type Draft = Partial<HotKeyword> & { keyword: string; displayLabel: string };

export default function HotKeywordsPage() {
  const [list, setList] = useState<HotKeyword[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<HotKeyword | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>({ keyword: '', displayLabel: '' });

  async function load() {
    try {
      setList(await api.get<HotKeyword[]>('/admin/search/keywords'));
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    const target = editing ?? (draft as HotKeyword);
    try {
      const body = {
        keyword: target.keyword,
        display_label: target.displayLabel,
        sort_order: target.sortOrder ?? 100,
        enabled: (target.enabled ?? 1) === 1,
        target_locales: target.targetLocales,
        target_cities: target.targetCities,
        starts_at: target.startsAt,
        ends_at: target.endsAt,
      };
      if (editing) {
        await api.patch(`/admin/search/keywords/${editing.id}`, body);
      } else {
        await api.post('/admin/search/keywords', body);
      }
      setEditing(null);
      setCreating(false);
      setDraft({ keyword: '', displayLabel: '' });
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  async function softDelete(id: string) {
    if (!confirm('确定停用此热门词？(软删 · 可在 DB 恢复)')) return;
    try {
      await api.delete(`/admin/search/keywords/${id}`);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">🔥 热门词运营</h1>
        <button type="button" onClick={() => setCreating(true)} className="btn-primary">
          + 新建
        </button>
      </div>

      <p className="mb-4 text-sm text-ink-500">
        /search 页"大家在搜"区域的 chips · 排序越小越靠前 · 支持 locale/city/时段定向投放
      </p>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>排序</th>
              <th>keyword</th>
              <th>展示文案</th>
              <th>开关</th>
              <th>locale</th>
              <th>city</th>
              <th>时段</th>
              <th>更新</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-ink-500">
                  还没有热门词 · 前端在用 fallback 硬编码
                </td>
              </tr>
            )}
            {list.map((k) => (
              <tr key={k.id} className={k.enabled === 0 ? 'opacity-50' : ''}>
                <td className="font-mono">{k.sortOrder}</td>
                <td className="font-mono text-xs">{k.keyword}</td>
                <td>{k.displayLabel}</td>
                <td>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      k.enabled === 1 ? 'bg-green-100 text-green-700' : 'bg-ink-100'
                    }`}
                  >
                    {k.enabled === 1 ? '开' : '关'}
                  </span>
                </td>
                <td className="text-xs">{k.targetLocales?.join(', ') ?? '—'}</td>
                <td className="text-xs">{k.targetCities?.join(', ') ?? '—'}</td>
                <td className="text-xs">
                  {k.startsAt ? new Date(k.startsAt).toLocaleDateString() : '—'}
                  {' ~ '}
                  {k.endsAt ? new Date(k.endsAt).toLocaleDateString() : '—'}
                </td>
                <td className="text-xs">{new Date(k.updatedAt).toLocaleString()}</td>
                <td className="space-x-1 text-right">
                  <button
                    type="button"
                    onClick={() => setEditing(k)}
                    className="btn-ghost h-7 px-3 text-xs"
                  >
                    编辑
                  </button>
                  {k.enabled === 1 && (
                    <button
                      type="button"
                      onClick={() => void softDelete(k.id)}
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
          title={editing ? `编辑 ${editing.keyword}` : '新建热门词'}
          onClose={() => {
            setEditing(null);
            setCreating(false);
            setDraft({ keyword: '', displayLabel: '' });
          }}
        >
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs">keyword(唯一 · 不展示)</div>
              <input
                className="input w-full"
                placeholder="thai-night / sukhumvit"
                value={(editing ?? draft).keyword ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  editing
                    ? setEditing({ ...editing, keyword: v })
                    : setDraft({ ...draft, keyword: v });
                }}
                disabled={!!editing}
              />
            </div>
            <div>
              <div className="mb-1 text-xs">展示文案(用户看到)</div>
              <input
                className="input w-full"
                placeholder="今晚有空 / 素坤逸"
                value={(editing ?? draft).displayLabel ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  editing
                    ? setEditing({ ...editing, displayLabel: v })
                    : setDraft({ ...draft, displayLabel: v });
                }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs">排序(asc · 0=置顶)</div>
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
                <div className="mb-1 text-xs">cities(逗号分隔 · 空=全部)</div>
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs">开始(ISO · 空=立即)</div>
                <input
                  type="datetime-local"
                  className="input w-full"
                  value={
                    (editing ?? draft).startsAt
                      ? new Date((editing ?? draft).startsAt!).toISOString().slice(0, 16)
                      : ''
                  }
                  onChange={(e) => {
                    const v = e.target.value ? new Date(e.target.value).toISOString() : null;
                    editing
                      ? setEditing({ ...editing, startsAt: v })
                      : setDraft({ ...draft, startsAt: v });
                  }}
                />
              </div>
              <div>
                <div className="mb-1 text-xs">结束(空=永久)</div>
                <input
                  type="datetime-local"
                  className="input w-full"
                  value={
                    (editing ?? draft).endsAt
                      ? new Date((editing ?? draft).endsAt!).toISOString().slice(0, 16)
                      : ''
                  }
                  onChange={(e) => {
                    const v = e.target.value ? new Date(e.target.value).toISOString() : null;
                    editing
                      ? setEditing({ ...editing, endsAt: v })
                      : setDraft({ ...draft, endsAt: v });
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
                  setDraft({ keyword: '', displayLabel: '' });
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
