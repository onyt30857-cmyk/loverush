'use client';

/**
 * Admin · 橱窗商品管理
 *
 * 操作:
 *   - 列出全部商品(GET /admin/shop/items)
 *   - 新建(POST /admin/shop/items)
 *   - 编辑(PATCH /admin/shop/items/:id)
 *   - 上下架切换(isActive 开关)
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface ShopItem {
  id: string;
  sku: string;
  title: string;
  category: string;
  pricePoints: number;
  costPoints: number | null;
  commissionBpsDefault: number;
  stockQty: number | null;
  countryCodes: string[] | null;
  coverUrl: string | null;
  mediaUrls: string[] | null;
  isActive: boolean;
  createdAt: string;
}

interface CountryMini {
  code: string;
  nameZh: string;
  flagEmoji: string | null;
}

interface FormData {
  sku: string;
  title: string;
  category: string;
  pricePoints: number;
  costPoints: number;
  commissionBpsDefault: number;
  stockQty: number;
  countryCodesStr: string; // 逗号分隔 ISO code
  coverUrl: string;
  mediaUrlsStr: string; // 逗号分隔 URL
  isActive: boolean;
}

const EMPTY_FORM: FormData = {
  sku: '',
  title: '',
  category: 'adult_toys',
  pricePoints: 0,
  costPoints: 0,
  commissionBpsDefault: 2000,
  stockQty: 0,
  countryCodesStr: '',
  coverUrl: '',
  mediaUrlsStr: '',
  isActive: true,
};

const CATEGORY_OPTIONS = [
  { value: 'adult_toys', label: '成人玩具' },
  { value: 'health', label: '健康保健' },
  { value: 'massage_oil', label: '按摩油' },
  { value: 'accessory', label: '配件周边' },
];

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label]),
);

function fmtBps(bps: number): string {
  return (bps / 100).toFixed(0) + '%';
}

export default function ShopItemsPage() {
  const [list, setList] = useState<ShopItem[]>([]);
  const [countries, setCountries] = useState<CountryMini[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ShopItem | 'new' | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [items, cs] = await Promise.all([
        api.get<ShopItem[]>('/admin/shop/items'),
        api.get<CountryMini[]>('/admin/geo/countries').catch(() => [] as CountryMini[]),
      ]);
      setList(items);
      setCountries(cs);
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

  function openEdit(item: ShopItem) {
    setForm({
      sku: item.sku,
      title: item.title,
      category: item.category,
      pricePoints: item.pricePoints,
      costPoints: item.costPoints ?? 0,
      commissionBpsDefault: item.commissionBpsDefault,
      stockQty: item.stockQty ?? 0,
      countryCodesStr: (item.countryCodes ?? []).join(','),
      coverUrl: item.coverUrl ?? '',
      mediaUrlsStr: (item.mediaUrls ?? []).join('\n'),
      isActive: item.isActive,
    });
    setEditing(item);
  }

  function parseCountryCodes(str: string): string[] {
    return str
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  function parseMediaUrls(str: string): string[] {
    return str
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function buildPayload() {
    return {
      sku: form.sku.trim(),
      title: form.title.trim(),
      category: form.category,
      pricePoints: form.pricePoints,
      costPoints: form.costPoints || undefined,
      commissionBpsDefault: form.commissionBpsDefault,
      stockQty: form.stockQty || undefined,
      countryCodes: parseCountryCodes(form.countryCodesStr),
      coverUrl: form.coverUrl.trim() || undefined,
      mediaUrls: parseMediaUrls(form.mediaUrlsStr),
      isActive: form.isActive,
    };
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (editing === 'new') {
        await api.post('/admin/shop/items', buildPayload());
      } else if (editing) {
        const { sku: _sku, ...patchPayload } = buildPayload();
        await api.patch(`/admin/shop/items/${editing.id}`, patchPayload);
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(item: ShopItem) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/admin/shop/items/${item.id}`, { isActive: !item.isActive });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // 多选国家复选框: 切换单个 code
  function toggleCountry(code: string) {
    const current = parseCountryCodes(form.countryCodesStr);
    const next = current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code];
    setForm({ ...form, countryCodesStr: next.join(',') });
  }

  return (
    <AdminShell>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">橱窗商品</h1>
            <p className="text-sm text-gray-500 mt-1">
              技师橱窗带货商品库 · 设置积分定价 / 佣金比 / 可售国家
            </p>
          </div>
          <button onClick={openNew} className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm">
            + 新增商品
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-3 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-gray-500">加载中…</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-600">
                <th className="px-3 py-2 border-b">SKU</th>
                <th className="px-3 py-2 border-b">标题</th>
                <th className="px-3 py-2 border-b">类目</th>
                <th className="px-3 py-2 border-b">积分价</th>
                <th className="px-3 py-2 border-b">默认佣金</th>
                <th className="px-3 py-2 border-b">库存</th>
                <th className="px-3 py-2 border-b">可售国家</th>
                <th className="px-3 py-2 border-b">状态</th>
                <th className="px-3 py-2 border-b">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-sm text-gray-400">
                    暂无商品
                  </td>
                </tr>
              )}
              {list.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 text-sm">
                  <td className="px-3 py-2 border-b font-mono text-xs">{item.sku}</td>
                  <td className="px-3 py-2 border-b max-w-[200px]">
                    <div className="flex items-center gap-2">
                      {item.coverUrl && (
                        <img
                          src={item.coverUrl}
                          alt={item.title}
                          className="h-8 w-8 rounded object-cover flex-shrink-0"
                        />
                      )}
                      <span className="truncate">{item.title}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 border-b text-xs">
                    {CATEGORY_LABEL[item.category] ?? item.category}
                  </td>
                  <td className="px-3 py-2 border-b font-mono">
                    {item.pricePoints.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 border-b text-xs">
                    {fmtBps(item.commissionBpsDefault)}
                  </td>
                  <td className="px-3 py-2 border-b">
                    {item.stockQty != null ? item.stockQty.toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2 border-b text-xs">
                    {item.countryCodes && item.countryCodes.length > 0
                      ? item.countryCodes.join(', ')
                      : <span className="text-gray-400">全球</span>}
                  </td>
                  <td className="px-3 py-2 border-b">
                    <button
                      onClick={() => void toggleActive(item)}
                      disabled={busy}
                      className={`text-xs px-2 py-0.5 rounded ${
                        item.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {item.isActive ? '上架' : '下架'}
                    </button>
                  </td>
                  <td className="px-3 py-2 border-b">
                    <button
                      onClick={() => openEdit(item)}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      编辑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {editing && (
          <div
            className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setEditing(null)}
          >
            <div
              className="bg-white rounded-lg p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold mb-4">
                {editing === 'new' ? '新增商品' : `编辑 ${(editing as ShopItem).sku}`}
              </h2>
              <div className="space-y-3">
                {editing === 'new' && (
                  <Field label="SKU(创建后不可改)">
                    <input
                      type="text"
                      value={form.sku}
                      onChange={(e) => setForm({ ...form, sku: e.target.value })}
                      placeholder="ITEM-001"
                      className="border rounded px-3 py-1.5 w-full font-mono"
                    />
                  </Field>
                )}
                <Field label="标题">
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="商品名称"
                    className="border rounded px-3 py-1.5 w-full"
                  />
                </Field>
                <Field label="类目">
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="border rounded px-3 py-1.5 w-full"
                  >
                    {CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="积分售价">
                    <input
                      type="number"
                      min={0}
                      value={form.pricePoints}
                      onChange={(e) =>
                        setForm({ ...form, pricePoints: parseInt(e.target.value, 10) || 0 })
                      }
                      className="border rounded px-3 py-1.5 w-full"
                    />
                  </Field>
                  <Field label="成本积分">
                    <input
                      type="number"
                      min={0}
                      value={form.costPoints}
                      onChange={(e) =>
                        setForm({ ...form, costPoints: parseInt(e.target.value, 10) || 0 })
                      }
                      className="border rounded px-3 py-1.5 w-full"
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="默认佣金率(bps · 2000=20%)">
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      value={form.commissionBpsDefault}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          commissionBpsDefault: parseInt(e.target.value, 10) || 0,
                        })
                      }
                      className="border rounded px-3 py-1.5 w-full"
                    />
                  </Field>
                  <Field label="库存数量(空=不限)">
                    <input
                      type="number"
                      min={0}
                      value={form.stockQty}
                      onChange={(e) =>
                        setForm({ ...form, stockQty: parseInt(e.target.value, 10) || 0 })
                      }
                      className="border rounded px-3 py-1.5 w-full"
                    />
                  </Field>
                </div>
                <Field label="可售国家(多选 · 空=全球可售)">
                  {countries.length > 0 ? (
                    <div className="border rounded p-2 grid grid-cols-3 gap-1 max-h-36 overflow-y-auto">
                      {countries.map((c) => {
                        const selected = parseCountryCodes(form.countryCodesStr).includes(c.code);
                        return (
                          <label
                            key={c.code}
                            className={`flex items-center gap-1 text-xs cursor-pointer px-2 py-1 rounded ${
                              selected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleCountry(c.code)}
                              className="accent-blue-600"
                            />
                            <span>{c.flagEmoji ?? ''}</span>
                            <span>{c.code}</span>
                            <span className="text-gray-400 truncate">{c.nameZh}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={form.countryCodesStr}
                      onChange={(e) => setForm({ ...form, countryCodesStr: e.target.value })}
                      placeholder="TH,SG,MY(逗号分隔 ISO code · 空=全球)"
                      className="border rounded px-3 py-1.5 w-full font-mono"
                    />
                  )}
                </Field>
                <Field label="封面图 URL">
                  <input
                    type="text"
                    value={form.coverUrl}
                    onChange={(e) => setForm({ ...form, coverUrl: e.target.value })}
                    placeholder="https://..."
                    className="border rounded px-3 py-1.5 w-full"
                  />
                </Field>
                <Field label="媒体图 URL(每行一个)">
                  <textarea
                    rows={3}
                    value={form.mediaUrlsStr}
                    onChange={(e) => setForm({ ...form, mediaUrlsStr: e.target.value })}
                    placeholder="https://...&#10;https://..."
                    className="border rounded px-3 py-1.5 w-full text-sm"
                  />
                </Field>
                <Field label="上架状态">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                      className="accent-blue-600"
                    />
                    {form.isActive ? '已上架' : '已下架'}
                  </label>
                </Field>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => setEditing(null)}
                  className="px-4 py-1.5 rounded text-sm border"
                >
                  取消
                </button>
                <button
                  onClick={() => void save()}
                  disabled={busy || !form.title.trim() || (editing === 'new' && !form.sku.trim())}
                  className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50"
                >
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
