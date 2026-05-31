'use client';

/**
 * Admin · 服务类型字典管理 · M02b/M04 Phase 1
 *
 * 平台预设的服务类型(thai/oil/chinese_tuina/spa/foot/shiatsu)
 * 技师发布节目时从这里选 categoryCode
 *
 * 操作:
 *   - 新增类型(code 创建后不可改)
 *   - 改名/icon/描述/排序
 *   - 启用/禁用切换(isActive 0/1 · 软删 · 不影响已发布 shows)
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface Category {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
  description: string | null;
  iconEmoji: string | null;
  displayOrder: number;
  isActive: number;
  createdAt: string;
}

interface FormData {
  code: string;
  nameZh: string;
  nameEn: string;
  description: string;
  iconEmoji: string;
  displayOrder: number;
}

const EMPTY_FORM: FormData = { code: '', nameZh: '', nameEn: '', description: '', iconEmoji: '', displayOrder: 0 };

export default function ServiceCategoriesPage() {
  const [list, setList] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 编辑/新增 modal
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Category[]>('/admin/service-categories');
      setList(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function openCreate() {
    setEditing('new');
    setForm(EMPTY_FORM);
  }

  function openEdit(c: Category) {
    setEditing(c);
    setForm({
      code: c.code,
      nameZh: c.nameZh,
      nameEn: c.nameEn,
      description: c.description ?? '',
      iconEmoji: c.iconEmoji ?? '',
      displayOrder: c.displayOrder,
    });
  }

  async function handleSave() {
    setBusy(true);
    try {
      const payload = {
        code: form.code,
        name_zh: form.nameZh,
        name_en: form.nameEn,
        description: form.description || undefined,
        icon_emoji: form.iconEmoji || undefined,
        display_order: form.displayOrder,
      };
      if (editing === 'new') {
        await api.post('/admin/service-categories', payload);
      } else if (editing) {
        // PUT 不传 code(不可改)
        const { code: _code, ...patch } = payload;
        void _code;
        await api.put(`/admin/service-categories/${editing.id}`, patch);
      }
      setEditing(null);
      await load();
    } catch (err) {
      alert(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(c: Category) {
    const target = c.isActive === 1 ? 0 : 1;
    if (target === 0 && !confirm(`禁用 "${c.nameZh}"? 技师将无法新建此类型的节目 · 已发布的不受影响`)) return;
    try {
      await api.put(`/admin/service-categories/${c.id}`, { is_active: target });
      await load();
    } catch (err) {
      alert(err instanceof ApiClientError ? err.payload.message : String(err));
    }
  }

  async function handleDelete(c: Category) {
    if (!confirm(`软删 "${c.nameZh}"? 会被禁用(is_active=0) · 不会真删 · 已发布的节目不受影响`)) return;
    try {
      await api.delete(`/admin/service-categories/${c.id}`);
      await load();
    } catch (err) {
      alert(err instanceof ApiClientError ? err.payload.message : String(err));
    }
  }

  return (
    <AdminShell>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold">服务类型字典</h1>
          <button
            type="button"
            onClick={openCreate}
            className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm font-medium"
          >+ 新增类型</button>
        </div>
        <div className="text-sm text-gray-600 mb-4">
          技师发布节目时从这里选 · 客户在搜索/筛选页看到 · 软删后已发布节目不受影响
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-3 text-sm">
            {error}
          </div>
        )}

        <div className="bg-white border rounded-lg overflow-hidden">
          {loading && <div className="p-6 text-center text-gray-400 text-sm">加载中…</div>}
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2 w-12">序</th>
                <th className="text-left px-3 py-2">类型</th>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-left px-3 py-2">描述</th>
                <th className="text-center px-3 py-2">状态</th>
                <th className="text-right px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={`border-b hover:bg-gray-50 ${c.isActive === 0 ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-2 text-gray-500 font-mono">{c.displayOrder}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{c.iconEmoji ?? '·'}</span>
                      <div>
                        <div className="font-medium">{c.nameZh}</div>
                        <div className="text-xs text-gray-500">{c.nameEn}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-xs font-mono text-gray-600">{c.code}</td>
                  <td className="text-xs text-gray-600 max-w-xs truncate">{c.description}</td>
                  <td className="text-center">
                    {c.isActive === 1 ? (
                      <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs">启用</span>
                    ) : (
                      <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded text-xs">禁用</span>
                    )}
                  </td>
                  <td className="text-right space-x-2">
                    <button onClick={() => openEdit(c)} className="text-blue-600 hover:underline text-xs">编辑</button>
                    <button onClick={() => void toggleActive(c)} className="text-yellow-600 hover:underline text-xs">
                      {c.isActive === 1 ? '禁用' : '启用'}
                    </button>
                    <button onClick={() => void handleDelete(c)} className="text-red-600 hover:underline text-xs">删除</button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && !loading && (
                <tr><td colSpan={6} className="text-center text-gray-400 py-8">还没有服务类型 · 点上方新增</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal · 新增/编辑 */}
      {editing && (
        <div
          className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="bg-white rounded-lg max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b p-4 flex items-center justify-between bg-gray-50">
              <div className="font-semibold">{editing === 'new' ? '新增服务类型' : `编辑 · ${editing.nameZh}`}</div>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>

            <div className="p-4 space-y-3">
              <Field label="Code (创建后不可改)" hint="小写英文/数字/下划线 · 2-40 字符">
                <input
                  type="text"
                  value={form.code}
                  disabled={editing !== 'new'}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="reflexology"
                  className="w-full border rounded px-3 py-1.5 text-sm font-mono disabled:bg-gray-100"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="中文名">
                  <input
                    type="text"
                    value={form.nameZh}
                    onChange={(e) => setForm({ ...form, nameZh: e.target.value })}
                    placeholder="反射区按摩"
                    className="w-full border rounded px-3 py-1.5 text-sm"
                  />
                </Field>
                <Field label="英文名">
                  <input
                    type="text"
                    value={form.nameEn}
                    onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                    placeholder="Reflexology"
                    className="w-full border rounded px-3 py-1.5 text-sm"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Icon Emoji">
                  <input
                    type="text"
                    value={form.iconEmoji}
                    onChange={(e) => setForm({ ...form, iconEmoji: e.target.value })}
                    placeholder="🌿"
                    className="w-full border rounded px-3 py-1.5 text-sm"
                    maxLength={4}
                  />
                </Field>
                <Field label="显示顺序" hint="数字越小越靠前">
                  <input
                    type="number"
                    value={form.displayOrder}
                    onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value, 10) || 0 })}
                    min={0}
                    className="w-full border rounded px-3 py-1.5 text-sm"
                  />
                </Field>
              </div>
              <Field label="描述">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  placeholder="（可选）"
                  className="w-full border rounded px-3 py-1.5 text-sm"
                />
              </Field>
            </div>

            <div className="border-t p-3 flex gap-2 justify-end">
              <button onClick={() => setEditing(null)} className="px-4 py-1.5 text-sm border rounded">取消</button>
              <button
                onClick={() => void handleSave()}
                disabled={busy || !form.code || !form.nameZh || !form.nameEn}
                className="px-5 py-1.5 text-sm bg-blue-600 text-white rounded disabled:bg-gray-300 font-medium"
              >{busy ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <div className="mt-0.5 text-[10px] text-gray-500">{hint}</div>}
    </div>
  );
}
