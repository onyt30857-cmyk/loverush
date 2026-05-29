'use client';

/**
 * 启动页图片管理 · admin
 *
 * customer/therapist 各 N 张轮播图(默认 4/2 张),可在此调整 URL 列表 + 顺序
 * 真上传等 R2 SDK 集成后再做 multipart
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

type Scope = 'customer' | 'therapist';

interface SplashConfig {
  scope: Scope;
  images: string[];
  defaults: string[];
  hasOverride: boolean;
}

export default function AdminSplashPage() {
  const [scope, setScope] = useState<Scope>('customer');
  const [config, setConfig] = useState<SplashConfig | null>(null);
  const [edits, setEdits] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load(s: Scope) {
    try {
      const data = await api.get<SplashConfig>('/admin/splash/config', { scope: s });
      setConfig(data);
      setEdits(data.images.length > 0 ? data.images : data.defaults);
      setError(null);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String(err));
    }
  }

  useEffect(() => {
    void load(scope);
  }, [scope]);

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      // 过滤空字符串
      const cleaned = edits.map((s) => s.trim()).filter(Boolean);
      await api.post('/admin/splash/config', { scope, images: cleaned });
      setMsg(`✓ 已保存 ${cleaned.length} 张图片`);
      await load(scope);
      setTimeout(() => setMsg(null), 3000);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function resetToDefault() {
    if (!config) return;
    setEdits(config.defaults);
  }

  function addRow() {
    setEdits([...edits, '']);
  }

  function removeRow(i: number) {
    setEdits(edits.filter((_, idx) => idx !== i));
  }

  function moveRow(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= edits.length) return;
    const next = [...edits];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setEdits(next);
  }

  function setRow(i: number, val: string) {
    const next = [...edits];
    next[i] = val;
    setEdits(next);
  }

  return (
    <AdminShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">🎬 启动页图片管理</h1>
        <p className="mt-1 text-xs text-ink-500">
          客户端/技师端启动页(splash)的轮播图。URL 顺序就是展示顺序。
          R2 SDK 接入前先填外部 URL,接入后可直接上传文件。
        </p>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
      {msg && <div className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{msg}</div>}

      {/* Scope 切换 */}
      <div className="mb-4 flex gap-2">
        {(['customer', 'therapist'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              scope === s
                ? 'bg-gradient-to-r from-rose-500 to-rose-400 text-white shadow'
                : 'border border-ink-200 bg-white text-ink-700 hover:bg-ink-50'
            }`}
          >
            {s === 'customer' ? '客户启动页' : '技师启动页'}
          </button>
        ))}
        {config && (
          <span className="ml-2 self-center text-xs text-ink-500">
            {config.hasOverride ? `已自定义 · ${config.images.length} 张` : '使用默认 · 未自定义'}
          </span>
        )}
      </div>

      {/* 编辑列表 */}
      <section className="card mb-4">
        <h2 className="mb-3 text-sm font-semibold">图片 URL 列表(顺序 = 展示顺序)</h2>
        <ul className="space-y-2">
          {edits.map((url, i) => (
            <li key={i} className="flex items-start gap-2">
              <div className="flex w-8 shrink-0 flex-col items-center gap-1 pt-1">
                <button type="button" onClick={() => moveRow(i, -1)} disabled={i === 0} className="text-xs disabled:opacity-30">
                  ↑
                </button>
                <span className="text-[10px] font-mono text-ink-400">{i + 1}</span>
                <button type="button" onClick={() => moveRow(i, 1)} disabled={i === edits.length - 1} className="text-xs disabled:opacity-30">
                  ↓
                </button>
              </div>
              <div className="flex-1">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setRow(i, e.target.value)}
                  placeholder="https://r2.../splash-1.png 或 /proto-images/splash-c-1.png"
                  className="input w-full font-mono text-xs"
                />
                {url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt="预览"
                    className="mt-2 max-h-32 rounded-lg ring-1 ring-ink-100"
                    onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                    onLoad={(e) => ((e.target as HTMLImageElement).style.display = 'block')}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100"
              >
                删除
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={addRow}
            className="rounded border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50"
          >
            + 加一张
          </button>
          <button
            type="button"
            onClick={resetToDefault}
            className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-100"
          >
            ↺ 还原默认
          </button>
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => void load(scope)} className="btn-ghost" disabled={busy}>
          重新加载
        </button>
        <button type="button" onClick={() => void save()} className="btn-primary" disabled={busy}>
          {busy ? '保存中…' : '保存 + 立即生效'}
        </button>
      </div>
    </AdminShell>
  );
}
