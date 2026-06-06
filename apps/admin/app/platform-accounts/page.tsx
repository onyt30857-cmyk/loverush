'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface PlatformAccount {
  id: string;
  methodType: string;
  label: string;
  fields: Record<string, string>;
  isActive: boolean;
  displayOrder: number;
  note: string | null;
}

const METHOD_OPTS = [
  { value: 'usdt_trc20', label: 'USDT-TRC20' },
  { value: 'bank', label: '银行' },
  { value: 'alipay', label: '支付宝' },
  { value: 'wechat', label: '微信' },
  { value: 'other', label: '其它' },
];

const empty = { id: '', methodType: 'usdt_trc20', label: '', address: '', qrUrl: '', note: '', isActive: true, displayOrder: 0 };

export default function AdminPlatformAccountsPage() {
  const [list, setList] = useState<PlatformAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ...empty });

  async function load() {
    try {
      setList(await api.get<PlatformAccount[]>('/admin/platform-accounts'));
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!form.label.trim() || !form.address.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.put('/admin/platform-accounts', {
        id: form.id || undefined,
        method_type: form.methodType,
        label: form.label.trim(),
        fields: { address: form.address.trim(), ...(form.qrUrl.trim() ? { qrUrl: form.qrUrl.trim() } : {}) },
        is_active: form.isActive,
        display_order: form.displayOrder,
        note: form.note.trim() || undefined,
      });
      setForm({ ...empty });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(a: PlatformAccount) {
    setBusy(true);
    try {
      await api.put('/admin/platform-accounts', {
        id: a.id,
        method_type: a.methodType,
        label: a.label,
        fields: a.fields,
        is_active: !a.isActive,
        display_order: a.displayOrder,
        note: a.note ?? undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('确认删除这个收款账户？')) return;
    setBusy(true);
    try {
      await api.delete(`/admin/platform-accounts/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <h1 className="text-xl font-bold">平台收款账户</h1>
          <p className="mt-1 text-xs text-gray-500">代理批发采购积分时往这些账户转账。启用的账户对代理可见。</p>
        </div>
        {error && <div className="rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

        {/* 列表 */}
        <section className="rounded-lg border bg-white p-5">
          <table className="w-full text-left text-sm">
            <thead className="text-gray-400">
              <tr>
                <th className="py-1">标签</th>
                <th>类型</th>
                <th>地址 / 账号</th>
                <th>状态</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} className="border-t align-top">
                  <td className="py-1.5 font-medium">{a.label}</td>
                  <td>{METHOD_OPTS.find((m) => m.value === a.methodType)?.label ?? a.methodType}</td>
                  <td className="break-all font-mono text-xs">{a.fields.address ?? Object.values(a.fields)[0]}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => toggleActive(a)}
                      disabled={busy}
                      className={a.isActive ? 'text-emerald-600' : 'text-gray-400'}
                    >
                      {a.isActive ? '● 启用' : '○ 停用'}
                    </button>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          id: a.id,
                          methodType: a.methodType,
                          label: a.label,
                          address: a.fields.address ?? '',
                          qrUrl: a.fields.qrUrl ?? '',
                          note: a.note ?? '',
                          isActive: a.isActive,
                          displayOrder: a.displayOrder,
                        })
                      }
                      className="mr-2 text-rose-600"
                    >
                      编辑
                    </button>
                    <button type="button" onClick={() => remove(a.id)} disabled={busy} className="text-gray-400">
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-gray-400">
                    还没有收款账户，下方添加
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* 表单 */}
        <section className="rounded-lg border bg-white p-5">
          <h2 className="mb-3 font-semibold">{form.id ? '编辑账户' : '新增收款账户'}</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col text-sm">
              <span className="mb-1 text-gray-500">类型</span>
              <select
                value={form.methodType}
                onChange={(e) => setForm({ ...form, methodType: e.target.value })}
                className="rounded border px-3 py-2 outline-none focus:border-rose-400"
              >
                {METHOD_OPTS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-sm">
              <span className="mb-1 text-gray-500">标签（代理看到的名字）</span>
              <input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="USDT-TRC20 主收款"
                className="rounded border px-3 py-2 outline-none focus:border-rose-400"
              />
            </label>
          </div>
          <label className="mt-3 flex flex-col text-sm">
            <span className="mb-1 text-gray-500">地址 / 账号</span>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="TRC20 钱包地址（T 开头）"
              className="rounded border px-3 py-2 font-mono outline-none focus:border-rose-400"
            />
          </label>
          <label className="mt-3 flex flex-col text-sm">
            <span className="mb-1 text-gray-500">收款二维码图片链接（可选 · 不填则代理端用地址自动生成）</span>
            <input
              value={form.qrUrl}
              onChange={(e) => setForm({ ...form, qrUrl: e.target.value })}
              placeholder="https://… 收款码图片 URL"
              className="rounded border px-3 py-2 outline-none focus:border-rose-400"
            />
          </label>
          <label className="mt-3 flex flex-col text-sm">
            <span className="mb-1 text-gray-500">备注（可选）</span>
            <input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="如:仅接收 USDT，转账请核对地址"
              className="rounded border px-3 py-2 outline-none focus:border-rose-400"
            />
          </label>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy || !form.label.trim() || !form.address.trim()}
              className="rounded bg-rose-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {form.id ? '保存修改' : '添加'}
            </button>
            {form.id && (
              <button type="button" onClick={() => setForm({ ...empty })} className="text-sm text-gray-500">
                取消编辑
              </button>
            )}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
