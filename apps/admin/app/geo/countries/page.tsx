'use client';

/**
 * Admin · 国家配置(单一事实源:时区 + 默认法币 + 国旗)
 *
 * 加一个国家 = 这里填一行 → resolveTz / 法币立即生效(后端清缓存)。
 * 时区国家级默认;印尼这类跨时区国家可在「城市维护」给单个城市覆盖 timezone。
 * 操作:新增(code 创建后不可改)/ 改名称·国旗·时区·默认币种·区号·排序 / 停用(软删,有城市占用则拦)。
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface Country {
  code: string;
  nameZh: string;
  nameEn: string;
  flagEmoji: string | null;
  timezone: string;
  defaultCurrency: string;
  dialCode: string | null;
  enabled: number;
  sortOrder: number;
}

interface CurrencyMini {
  code: string;
  symbol: string;
  nameZh: string;
}

interface FormData {
  code: string;
  name_zh: string;
  name_en: string;
  flag_emoji: string;
  timezone: string;
  default_currency: string;
  dial_code: string;
  sort_order: number;
}

const EMPTY_FORM: FormData = {
  code: '',
  name_zh: '',
  name_en: '',
  flag_emoji: '',
  timezone: 'Asia/Bangkok',
  default_currency: '',
  dial_code: '',
  sort_order: 100,
};

// 常用 IANA 时区(datalist 提示 · 仍可手填任意值)
const COMMON_TZ = [
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Jakarta',
  'Asia/Makassar',
  'Asia/Jayapura',
  'Asia/Manila',
  'Asia/Phnom_Penh',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Seoul',
  'America/New_York',
];

export default function CountriesPage() {
  const [list, setList] = useState<Country[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyMini[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Country | 'new' | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [cs, curs] = await Promise.all([
        api.get<Country[]>('/admin/geo/countries'),
        api.get<CurrencyMini[]>('/admin/currencies'),
      ]);
      setList(cs);
      setCurrencies(curs);
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
    setForm({ ...EMPTY_FORM, default_currency: currencies[0]?.code ?? '' });
    setEditing('new');
  }

  function openEdit(c: Country) {
    setForm({
      code: c.code,
      name_zh: c.nameZh,
      name_en: c.nameEn,
      flag_emoji: c.flagEmoji ?? '',
      timezone: c.timezone,
      default_currency: c.defaultCurrency,
      dial_code: c.dialCode ?? '',
      sort_order: c.sortOrder,
    });
    setEditing(c);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name_zh: form.name_zh,
        name_en: form.name_en,
        flag_emoji: form.flag_emoji || null,
        timezone: form.timezone,
        default_currency: form.default_currency,
        dial_code: form.dial_code || null,
        sort_order: form.sort_order,
      };
      if (editing === 'new') {
        await api.post('/admin/geo/countries', { code: form.code, ...payload });
      } else if (editing) {
        await api.patch(`/admin/geo/countries/${editing.code}`, payload);
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(c: Country) {
    setBusy(true);
    setError(null);
    try {
      if (c.enabled) {
        await api.delete(`/admin/geo/countries/${c.code}`);
      } else {
        await api.patch(`/admin/geo/countries/${c.code}`, { enabled: true });
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">国家配置</h1>
            <p className="text-sm text-gray-500 mt-1">
              时区 + 默认法币 + 国旗的单一事实源 · 加国家在此填一行即生效 · 时区国家级默认(城市可单独覆盖)
            </p>
          </div>
          <button onClick={openNew} className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm">
            + 新增国家
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-3 text-sm">{error}</div>
        )}
        {loading ? (
          <div className="text-sm text-gray-500">加载中…</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-600">
                <th className="px-3 py-2 border-b">code</th>
                <th className="px-3 py-2 border-b">国旗</th>
                <th className="px-3 py-2 border-b">中文名</th>
                <th className="px-3 py-2 border-b">英文名</th>
                <th className="px-3 py-2 border-b">时区</th>
                <th className="px-3 py-2 border-b">默认法币</th>
                <th className="px-3 py-2 border-b">区号</th>
                <th className="px-3 py-2 border-b">排序</th>
                <th className="px-3 py-2 border-b">状态</th>
                <th className="px-3 py-2 border-b">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.code} className="hover:bg-gray-50 text-sm">
                  <td className="px-3 py-2 border-b font-mono">{c.code}</td>
                  <td className="px-3 py-2 border-b text-lg">{c.flagEmoji ?? '—'}</td>
                  <td className="px-3 py-2 border-b">{c.nameZh}</td>
                  <td className="px-3 py-2 border-b text-gray-500">{c.nameEn}</td>
                  <td className="px-3 py-2 border-b font-mono text-xs">{c.timezone}</td>
                  <td className="px-3 py-2 border-b font-mono">{c.defaultCurrency}</td>
                  <td className="px-3 py-2 border-b text-gray-500">{c.dialCode ?? '—'}</td>
                  <td className="px-3 py-2 border-b">{c.sortOrder}</td>
                  <td className="px-3 py-2 border-b">
                    <button
                      onClick={() => void toggleEnabled(c)}
                      disabled={busy}
                      className={`text-xs px-2 py-0.5 rounded ${c.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                    >
                      {c.enabled ? '启用' : '停用'}
                    </button>
                  </td>
                  <td className="px-3 py-2 border-b">
                    <button onClick={() => openEdit(c)} className="text-blue-600 hover:underline text-xs">
                      编辑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {editing && (
          <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onClick={() => setEditing(null)}>
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-4">
                {editing === 'new' ? '新增国家' : `编辑 ${editing.flagEmoji ?? ''} ${editing.code}`}
              </h2>
              <div className="space-y-3">
                {editing === 'new' && (
                  <Field label="ISO alpha-2 Code(大写 · 创建后不可改)">
                    <input
                      type="text"
                      value={form.code}
                      maxLength={2}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                      placeholder="TH / VN / SG ..."
                      className="border rounded px-3 py-1.5 w-full font-mono"
                    />
                  </Field>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="中文名">
                    <input
                      type="text"
                      value={form.name_zh}
                      onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
                      placeholder="泰国"
                      className="border rounded px-3 py-1.5 w-full"
                    />
                  </Field>
                  <Field label="英文名">
                    <input
                      type="text"
                      value={form.name_en}
                      onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                      placeholder="Thailand"
                      className="border rounded px-3 py-1.5 w-full"
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="国旗 emoji">
                    <input
                      type="text"
                      value={form.flag_emoji}
                      onChange={(e) => setForm({ ...form, flag_emoji: e.target.value })}
                      placeholder="🇹🇭"
                      className="border rounded px-3 py-1.5 w-full"
                    />
                  </Field>
                  <Field label="区号">
                    <input
                      type="text"
                      value={form.dial_code}
                      onChange={(e) => setForm({ ...form, dial_code: e.target.value })}
                      placeholder="+66"
                      className="border rounded px-3 py-1.5 w-full"
                    />
                  </Field>
                </div>
                <Field label="时区(IANA · 国家级默认)">
                  <input
                    type="text"
                    list="tz-options"
                    value={form.timezone}
                    onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                    placeholder="Asia/Bangkok"
                    className="border rounded px-3 py-1.5 w-full font-mono"
                  />
                  <datalist id="tz-options">
                    {COMMON_TZ.map((tz) => (
                      <option key={tz} value={tz} />
                    ))}
                  </datalist>
                </Field>
                <Field label="默认法币(无汇率的币种下单会回退积分模式)">
                  <select
                    value={form.default_currency}
                    onChange={(e) => setForm({ ...form, default_currency: e.target.value })}
                    className="border rounded px-3 py-1.5 w-full"
                  >
                    <option value="">— 选择 —</option>
                    {currencies.map((cur) => (
                      <option key={cur.code} value={cur.code}>
                        {cur.code} · {cur.symbol} {cur.nameZh}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="排序(小排前)">
                  <input
                    type="number"
                    min={0}
                    max={9999}
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value, 10) || 0 })}
                    className="border rounded px-3 py-1.5 w-full"
                  />
                </Field>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setEditing(null)} className="px-4 py-1.5 rounded text-sm border">
                  取消
                </button>
                <button
                  onClick={() => void save()}
                  disabled={busy || !form.timezone || !form.default_currency || (editing === 'new' && form.code.length !== 2)}
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
