'use client';

/**
 * Admin · 橱窗商品管理
 *
 * 操作:
 *   - 列出全部商品(GET /admin/shop/items)
 *   - 新建(POST /admin/shop/items)
 *   - 编辑(PATCH /admin/shop/items/:id)
 *   - 上下架切换(isActive 开关)
 *   - 封面图/详情多图 R2 直传上传（POST /admin/shop/media/upload-init + finalize）
 */

import { useEffect, useRef, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';
import { uploadImage } from '@/lib/upload';

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
  specLabel: string | null;
  specOptions: string[] | null;
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
  mediaUrls: string[]; // 详情多图 URL 数组（最多 5 张）
  specLabel: string; // 规格名(颜色/尺寸),空=无型号
  specOptionsStr: string; // 逗号分隔型号选项
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
  mediaUrls: [],
  specLabel: '',
  specOptionsStr: '',
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
  // 封面上传状态
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverUploadError, setCoverUploadError] = useState<string | null>(null);
  // 详情多图上传状态（key=索引/新增，value=uploading/error）
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [galleryUploadError, setGalleryUploadError] = useState<string | null>(null);
  // file input refs（用 ref 触发 click，避免不必要的 DOM 操作）
  const coverInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

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
      mediaUrls: item.mediaUrls ?? [],
      specLabel: item.specLabel ?? '',
      specOptionsStr: (item.specOptions ?? []).join(','),
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

  function buildPayload() {
    return {
      sku: form.sku.trim(),
      title: form.title.trim(),
      category: form.category,
      price_points: form.pricePoints,
      cost_points: form.costPoints || undefined,
      commission_bps_default: form.commissionBpsDefault,
      stock_qty: form.stockQty || undefined,
      country_codes: parseCountryCodes(form.countryCodesStr),
      cover_url: form.coverUrl.trim() || undefined,
      media_urls: form.mediaUrls.filter(Boolean),
      spec_label: form.specLabel.trim() || undefined,
      spec_options: form.specOptionsStr
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      is_active: form.isActive ? 1 : 0,
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

  /** 上传封面图，成功后把 publicUrl 写进 form.coverUrl */
  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverUploading(true);
    setCoverUploadError(null);
    try {
      const url = await uploadImage(file);
      setForm((prev) => ({ ...prev, coverUrl: url }));
    } catch (err) {
      setCoverUploadError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setCoverUploading(false);
      // 清空 input，允许重复上传同一文件
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  }

  /** 添加一张详情图（最多 5 张） */
  async function handleGalleryAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (form.mediaUrls.length >= 5) {
      setGalleryUploadError('最多只能上传 5 张详情图');
      return;
    }
    setGalleryUploading(true);
    setGalleryUploadError(null);
    try {
      const url = await uploadImage(file);
      setForm((prev) => ({ ...prev, mediaUrls: [...prev.mediaUrls, url] }));
    } catch (err) {
      setGalleryUploadError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setGalleryUploading(false);
      if (galleryInputRef.current) galleryInputRef.current.value = '';
    }
  }

  /** 删除详情图（按索引） */
  function removeGalleryImage(idx: number) {
    setForm((prev) => ({
      ...prev,
      mediaUrls: prev.mediaUrls.filter((_, i) => i !== idx),
    }));
  }

  async function toggleActive(item: ShopItem) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/admin/shop/items/${item.id}`, { is_active: item.isActive ? 0 : 1 });
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
                {/* ── 型号/规格(轻量·同价同库存) ── */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="规格名(空=无型号)">
                    <input
                      type="text"
                      value={form.specLabel}
                      onChange={(e) => setForm({ ...form, specLabel: e.target.value })}
                      placeholder="如 颜色 / 尺寸"
                      className="border rounded px-3 py-1.5 w-full"
                    />
                  </Field>
                  <Field label="型号选项(逗号分隔)">
                    <input
                      type="text"
                      value={form.specOptionsStr}
                      onChange={(e) => setForm({ ...form, specOptionsStr: e.target.value })}
                      placeholder="如 红色,蓝色 或 S,M,L"
                      className="border rounded px-3 py-1.5 w-full"
                    />
                  </Field>
                </div>
                {/* ── 封面图上传 ── */}
                <Field label="封面图">
                  <div className="space-y-2">
                    {/* 隐藏 file input */}
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => void handleCoverUpload(e)}
                    />
                    <div className="flex items-center gap-3">
                      {/* 缩略图预览 */}
                      {form.coverUrl ? (
                        <div className="relative flex-shrink-0">
                          <img
                            src={form.coverUrl}
                            alt="封面预览"
                            className="h-16 w-16 rounded object-cover border"
                          />
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, coverUrl: '' })}
                            className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center leading-none"
                            title="清除封面"
                          >
                            x
                          </button>
                        </div>
                      ) : (
                        <div className="h-16 w-16 rounded border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300 text-xs flex-shrink-0">
                          无图
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => coverInputRef.current?.click()}
                          disabled={coverUploading}
                          className="text-xs px-3 py-1.5 border rounded bg-white hover:bg-gray-50 disabled:opacity-50"
                        >
                          {coverUploading ? '上传中…' : form.coverUrl ? '更换封面' : '上传封面'}
                        </button>
                        {coverUploadError && (
                          <p className="text-red-500 text-xs mt-1">{coverUploadError}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </Field>

                {/* ── 详情多图上传（最多 5 张）── */}
                <Field label={`详情图（${form.mediaUrls.length}/5）`}>
                  <div className="space-y-2">
                    {/* 隐藏 file input */}
                    <input
                      ref={galleryInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => void handleGalleryAdd(e)}
                    />
                    {/* 图片网格 */}
                    <div className="flex flex-wrap gap-2">
                      {form.mediaUrls.map((url, idx) => (
                        <div key={idx} className="relative">
                          <img
                            src={url}
                            alt={`详情图 ${idx + 1}`}
                            className="h-16 w-16 rounded object-cover border"
                          />
                          <button
                            type="button"
                            onClick={() => removeGalleryImage(idx)}
                            className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 text-xs flex items-center justify-center leading-none"
                            title="删除"
                          >
                            x
                          </button>
                        </div>
                      ))}
                      {/* 加号按钮（未满 5 张时显示） */}
                      {form.mediaUrls.length < 5 && (
                        <button
                          type="button"
                          onClick={() => galleryInputRef.current?.click()}
                          disabled={galleryUploading}
                          className="h-16 w-16 rounded border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-400 disabled:opacity-50 transition-colors text-2xl"
                          title="添加详情图"
                        >
                          {galleryUploading ? (
                            <span className="text-xs">上传中</span>
                          ) : (
                            '+'
                          )}
                        </button>
                      )}
                    </div>
                    {galleryUploadError && (
                      <p className="text-red-500 text-xs">{galleryUploadError}</p>
                    )}
                  </div>
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
