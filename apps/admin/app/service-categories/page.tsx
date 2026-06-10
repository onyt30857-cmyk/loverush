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
const INPUT_CLS =
  'w-full rounded-lg border border-ink-100 px-3 py-2 text-sm text-ink-900 transition placeholder:text-ink-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15';

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
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-1 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-ink-900">服务类型字典</h1>
          <button type="button" onClick={openCreate} className="btn btn-primary">
            + 新增类型
          </button>
        </div>
        <p className="mb-5 text-xs text-ink-500">
          技师发布节目时从这里选 · 客户在搜索/筛选页看到 · 软删后已发布节目不受影响
        </p>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
          {loading ? (
            <div className="p-10 text-center text-sm text-ink-500">加载中…</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50 text-xs text-ink-500">
                  <th className="w-14 px-4 py-3 font-medium">序</th>
                  <th className="px-4 py-3 font-medium">类型</th>
                  <th className="px-4 py-3 font-medium">Code</th>
                  <th className="px-4 py-3 font-medium">描述</th>
                  <th className="px-4 py-3 text-center font-medium">状态</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {list.map((c) => (
                  <tr key={c.id} className={`transition hover:bg-ink-50 ${c.isActive === 0 ? 'opacity-55' : ''}`}>
                    <td className="px-4 py-3 font-mono text-ink-500">{c.displayOrder}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl leading-none">{c.iconEmoji ?? '·'}</span>
                        <div className="leading-tight">
                          <div className="font-medium text-ink-900">{c.nameZh}</div>
                          <div className="text-xs text-ink-500">{c.nameEn}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-ink-50 px-1.5 py-0.5 font-mono text-xs text-ink-700">{c.code}</code>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-xs text-ink-500">{c.description || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {c.isActive === 1 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />启用
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-ink-300" />禁用
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3 text-xs font-medium">
                        <button onClick={() => openEdit(c)} className="text-primary transition hover:text-primary-700">编辑</button>
                        <button onClick={() => void toggleActive(c)} className="text-amber-600 transition hover:text-amber-700">
                          {c.isActive === 1 ? '禁用' : '启用'}
                        </button>
                        <button onClick={() => void handleDelete(c)} className="text-red-500 transition hover:text-red-600">删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-sm text-ink-500">还没有服务类型 · 点右上角新增</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal · 新增/编辑 */}
      {editing && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-ink-100 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between rounded-t-2xl border-b border-ink-100 bg-ink-50 px-5 py-3.5">
              <div className="font-semibold text-ink-900">
                {editing === 'new' ? '新增服务类型' : `编辑 · ${editing.nameZh}`}
              </div>
              <button
                onClick={() => setEditing(null)}
                className="text-2xl leading-none text-ink-500 transition hover:text-ink-700"
              >
                ×
              </button>
            </div>

            <div className="space-y-3 p-5">
              <Field label="Code (创建后不可改)" hint="小写英文/数字/下划线 · 2-40 字符">
                <input
                  type="text"
                  value={form.code}
                  disabled={editing !== 'new'}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="reflexology"
                  className={`${INPUT_CLS} font-mono disabled:bg-ink-50 disabled:text-ink-500`}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="中文名">
                  <input
                    type="text"
                    value={form.nameZh}
                    onChange={(e) => setForm({ ...form, nameZh: e.target.value })}
                    placeholder="反射区按摩"
                    className={INPUT_CLS}
                  />
                </Field>
                <Field label="英文名">
                  <input
                    type="text"
                    value={form.nameEn}
                    onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                    placeholder="Reflexology"
                    className={INPUT_CLS}
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
                    className={INPUT_CLS}
                    maxLength={4}
                  />
                </Field>
                <Field label="显示顺序" hint="数字越小越靠前">
                  <input
                    type="number"
                    value={form.displayOrder}
                    onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value, 10) || 0 })}
                    min={0}
                    className={INPUT_CLS}
                  />
                </Field>
              </div>
              <Field label="描述">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  placeholder="（可选）"
                  className={INPUT_CLS}
                />
              </Field>
            </div>

            <div className="flex justify-end gap-2 border-t border-ink-100 p-4">
              <button onClick={() => setEditing(null)} className="btn btn-ghost">取消</button>
              <button
                onClick={() => void handleSave()}
                disabled={busy || !form.code || !form.nameZh || !form.nameEn}
                className="btn btn-primary disabled:opacity-50"
              >
                {busy ? '保存中…' : '保存'}
              </button>
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
      <label className="mb-1 block text-xs font-medium text-ink-700">{label}</label>
      {children}
      {hint && <div className="mt-0.5 text-[10px] text-ink-500">{hint}</div>}
    </div>
  );
}
