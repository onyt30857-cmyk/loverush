'use client';

/**
 * Admin · 法币字典 · 0027
 *
 * 平台预设 5 法币(THB/SGD/MYR/IDR/USD)
 * 技师发布节目时从这里选 currency_code · 客户支付按 fxRate 换算心动金
 *
 * 操作:
 *   - 新增法币(code 创建后不可改)
 *   - 改 symbol/中英文名/decimals/排序
 *   - 启用/禁用切换(软删)
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface Currency {
  code: string;
  symbol: string;
  nameZh: string;
  nameEn: string;
  decimals: number;
  displayOrder: number;
  isActive: number;
  createdAt: string;
}

interface FormData {
  code: string;
  symbol: string;
  name_zh: string;
  name_en: string;
  decimals: number;
  display_order: number;
}

const EMPTY_FORM: FormData = {
  code: '',
  symbol: '',
  name_zh: '',
  name_en: '',
  decimals: 2,
  display_order: 100,
};

export default function CurrenciesPage() {
  const [list, setList] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Currency | 'new' | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Currency[]>('/admin/currencies');
      setList(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openNew() {
    setForm(EMPTY_FORM);
    setEditing('new');
  }

  function openEdit(c: Currency) {
    setForm({
      code: c.code,
      symbol: c.symbol,
      name_zh: c.nameZh,
      name_en: c.nameEn,
      decimals: c.decimals,
      display_order: c.displayOrder,
    });
    setEditing(c);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (editing === 'new') {
        await api.post('/admin/currencies', form);
      } else if (editing) {
        await api.put(`/admin/currencies/${editing.code}`, {
          symbol: form.symbol,
          name_zh: form.name_zh,
          name_en: form.name_en,
          decimals: form.decimals,
          display_order: form.display_order,
        });
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(c: Currency) {
    setBusy(true);
    try {
      await api.put(`/admin/currencies/${c.code}`, { is_active: c.isActive ? 0 : 1 });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">法币字典</h1>
            <p className="text-sm text-gray-500 mt-1">
              技师按法币定价 · 客户心动金按汇率换算(10%)· 软删不影响已有 shows
            </p>
          </div>
          <button onClick={openNew} className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm">
            + 新增法币
          </button>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-3 text-sm">{error}</div>}
        {loading ? (
          <div className="text-sm text-gray-500">加载中…</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-600">
                <th className="px-3 py-2 border-b">code</th>
                <th className="px-3 py-2 border-b">符号</th>
                <th className="px-3 py-2 border-b">中文名</th>
                <th className="px-3 py-2 border-b">英文名</th>
                <th className="px-3 py-2 border-b">小数位</th>
                <th className="px-3 py-2 border-b">排序</th>
                <th className="px-3 py-2 border-b">状态</th>
                <th className="px-3 py-2 border-b">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.code} className="hover:bg-gray-50 text-sm">
                  <td className="px-3 py-2 border-b font-mono">{c.code}</td>
                  <td className="px-3 py-2 border-b">{c.symbol}</td>
                  <td className="px-3 py-2 border-b">{c.nameZh}</td>
                  <td className="px-3 py-2 border-b">{c.nameEn}</td>
                  <td className="px-3 py-2 border-b">{c.decimals}</td>
                  <td className="px-3 py-2 border-b">{c.displayOrder}</td>
                  <td className="px-3 py-2 border-b">
                    <button
                      onClick={() => void toggleActive(c)}
                      disabled={busy}
                      className={`text-xs px-2 py-0.5 rounded ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                    >
                      {c.isActive ? '启用' : '停用'}
                    </button>
                  </td>
                  <td className="px-3 py-2 border-b">
                    <button onClick={() => openEdit(c)} className="text-blue-600 hover:underline text-xs">编辑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {editing && (
          <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onClick={() => setEditing(null)}>
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-4">{editing === 'new' ? '新增法币' : `编辑 ${editing.code}`}</h2>
              <div className="space-y-3">
                {editing === 'new' && (
                  <Field label="ISO Code(大写 · 创建后不可改)">
                    <input
                      type="text"
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                      placeholder="THB / SGD / MYR / ..."
                      className="border rounded px-3 py-1.5 w-full font-mono"
                    />
                  </Field>
                )}
                <Field label="符号">
                  <input
                    type="text"
                    value={form.symbol}
                    onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                    placeholder="฿ / S$ / RM"
                    className="border rounded px-3 py-1.5 w-full"
                  />
                </Field>
                <Field label="中文名">
                  <input
                    type="text"
                    value={form.name_zh}
                    onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
                    placeholder="泰铢"
                    className="border rounded px-3 py-1.5 w-full"
                  />
                </Field>
                <Field label="英文名">
                  <input
                    type="text"
                    value={form.name_en}
                    onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                    placeholder="Thai Baht"
                    className="border rounded px-3 py-1.5 w-full"
                  />
                </Field>
                <Field label="小数位(IDR=0 · 大多数=2)">
                  <input
                    type="number"
                    min={0}
                    max={4}
                    value={form.decimals}
                    onChange={(e) => setForm({ ...form, decimals: parseInt(e.target.value, 10) || 0 })}
                    className="border rounded px-3 py-1.5 w-full"
                  />
                </Field>
                <Field label="排序(小排前)">
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={form.display_order}
                    onChange={(e) => setForm({ ...form, display_order: parseInt(e.target.value, 10) || 0 })}
                    className="border rounded px-3 py-1.5 w-full"
                  />
                </Field>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setEditing(null)} className="px-4 py-1.5 rounded text-sm border">取消</button>
                <button onClick={() => void save()} disabled={busy} className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
                  {busy ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
