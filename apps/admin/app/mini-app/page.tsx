'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface ConfigRow {
  key: string;
  scope: string;
  label: string | null;
  value: Record<string, unknown>;
  enabled: boolean;
  updatedAt: string;
}

export default function MiniAppPage() {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [vals, setVals] = useState<Record<string, Record<string, unknown>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api.get<ConfigRow[]>('/admin/app-config');
      setRows(data);
      const m: Record<string, Record<string, unknown>> = {};
      for (const r of data) m[r.key] = JSON.parse(JSON.stringify(r.value));
      setVals(m);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }
  useEffect(() => { void load(); }, []);

  async function save(key: string) {
    try {
      await api.put(`/admin/app-config/${key}`, { value: vals[key] });
      setSaved(key);
      setTimeout(() => setSaved(null), 1500);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  const byKey = useMemo(() => Object.fromEntries(rows.map((r) => [r.key, r])), [rows]);
  function set(key: string, path: string, v: unknown) {
    setVals((prev) => {
      const next = { ...prev, [key]: { ...(prev[key] ?? {}) } };
      // 简单一层/嵌套 set(path 形如 'subtitle' 或 'items.0.title')
      const parts = path.split('.');
      let cur: any = next[key];
      for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]!] = Array.isArray(cur[parts[i]!]) ? [...cur[parts[i]!]] : { ...cur[parts[i]!] };
        cur = cur[parts[i]!];
      }
      cur[parts[parts.length - 1]!] = v;
      return next;
    });
  }

  const SaveBtn = ({ k }: { k: string }) => (
    <button type="button" onClick={() => void save(k)} className="btn-primary h-8 px-4 text-xs">
      {saved === k ? '已保存 ✓' : '保存'}
    </button>
  );

  const bt = (vals['bot.texts'] ?? {}) as Record<string, string>;
  const bc = (vals['bot.commands'] ?? {}) as { commands?: Array<{ command: string; description: string }> };
  const hp = (vals['home.promise'] ?? {}) as { subtitle?: string; title?: string; items?: Array<{ title: string; sub: string }> };
  const hf = (vals['home.brandFooter'] ?? {}) as Record<string, string>;

  return (
    <AdminShell>
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Telegram 小程序配置</h1>
      </div>
      <p className="mb-5 text-xs text-ink-500">
        控制小程序前端的运营内容。改动即时生效(前端 60s 内刷新);缺配置时前端回退默认文案,绝不空白。
      </p>
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {rows.length === 0 ? (
        <div className="card text-sm text-ink-500">加载中…</div>
      ) : (
        <>
          {/* ───── B1 · Bot 文案与菜单 ───── */}
          <Section title="Bot 文案 · /start 与 inline">
            <Field label="欢迎语(/start)"><input className="input w-full" value={bt.welcomeMessage ?? ''} onChange={(e) => set('bot.texts', 'welcomeMessage', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="打开 App 按钮"><input className="input w-full" value={bt.startButton ?? ''} onChange={(e) => set('bot.texts', 'startButton', e.target.value)} /></Field>
              <Field label="inline 浏览全部按钮"><input className="input w-full" value={bt.inlineButton ?? ''} onChange={(e) => set('bot.texts', 'inlineButton', e.target.value)} /></Field>
              <Field label="约技师按钮"><input className="input w-full" value={bt.bookButton ?? ''} onChange={(e) => set('bot.texts', 'bookButton', e.target.value)} /></Field>
              <Field label="技师未找到提示"><input className="input w-full" value={bt.notFound ?? ''} onChange={(e) => set('bot.texts', 'notFound', e.target.value)} /></Field>
            </div>
            <div className="mt-2 text-right"><SaveBtn k="bot.texts" /></div>
          </Section>

          <Section title="Bot 命令菜单 · 保存即推送到 Telegram">
            {(bc.commands ?? []).map((cmd, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <span className="text-ink-400">/</span>
                <input className="input w-32" value={cmd.command} onChange={(e) => set('bot.commands', `commands.${i}.command`, e.target.value.replace(/[^a-z0-9_]/g, ''))} />
                <input className="input flex-1" placeholder="描述" value={cmd.description} onChange={(e) => set('bot.commands', `commands.${i}.description`, e.target.value)} />
                <button type="button" className="text-ink-300" onClick={() => set('bot.commands', 'commands', (bc.commands ?? []).filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button type="button" className="btn-ghost h-7 px-3 text-xs" onClick={() => set('bot.commands', 'commands', [...(bc.commands ?? []), { command: '', description: '' }])}>+ 加命令</button>
              <SaveBtn k="bot.commands" />
            </div>
          </Section>

          {/* ───── B2 · 首页运营内容 ───── */}
          <Section title="小程序首页 · 承诺区">
            <div className="grid grid-cols-2 gap-3">
              <Field label="小标题"><input className="input w-full" value={hp.subtitle ?? ''} onChange={(e) => set('home.promise', 'subtitle', e.target.value)} /></Field>
              <Field label="大标题"><input className="input w-full" value={hp.title ?? ''} onChange={(e) => set('home.promise', 'title', e.target.value)} /></Field>
            </div>
            {(hp.items ?? []).map((it, i) => (
              <div key={i} className="mt-2 grid grid-cols-2 gap-3 rounded-lg bg-ink-50 p-2">
                <Field label={`第${i + 1}条 标题`}><input className="input w-full" value={it.title} onChange={(e) => set('home.promise', `items.${i}.title`, e.target.value)} /></Field>
                <Field label="副文案"><input className="input w-full" value={it.sub} onChange={(e) => set('home.promise', `items.${i}.sub`, e.target.value)} /></Field>
              </div>
            ))}
            <div className="mt-2 text-right"><SaveBtn k="home.promise" /></div>
            <p className="mt-1 text-[11px] text-ink-400">图标与配色固定在代码,此处改文字。</p>
          </Section>

          <Section title="小程序首页 · 品牌脚注">
            <div className="grid grid-cols-2 gap-3">
              <Field label="品牌字标"><input className="input w-full" value={hf.wordmark ?? ''} onChange={(e) => set('home.brandFooter', 'wordmark', e.target.value)} /></Field>
              <Field label="标语"><input className="input w-full" value={hf.tagline ?? ''} onChange={(e) => set('home.brandFooter', 'tagline', e.target.value)} /></Field>
            </div>
            <div className="mt-2 text-right"><SaveBtn k="home.brandFooter" /></div>
          </Section>

          {/* ───── B3 · 底部导航 ───── */}
          {(['nav.customer', 'nav.therapist'] as const).map((navKey) => {
            const nv = (vals[navKey] ?? {}) as { tabs?: Array<{ key: string; label: string; enabled: boolean; order: number }> };
            return (
              <Section key={navKey} title={`底部导航 · ${navKey === 'nav.customer' ? '客户端' : '技师端'}`}>
                {(nv.tabs ?? []).map((tab, i) => (
                  <div key={tab.key} className="mb-2 flex items-center gap-3">
                    <span className="w-20 font-mono text-[11px] text-ink-400">{tab.key}</span>
                    <input className="input w-28" value={tab.label} onChange={(e) => set(navKey, `tabs.${i}.label`, e.target.value)} />
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={tab.enabled !== false} onChange={(e) => set(navKey, `tabs.${i}.enabled`, e.target.checked)} /> 显示
                    </label>
                    <label className="flex items-center gap-1 text-xs text-ink-400">
                      顺序 <input type="number" className="input w-14" value={tab.order} onChange={(e) => set(navKey, `tabs.${i}.order`, Number(e.target.value))} />
                    </label>
                  </div>
                ))}
                <div className="text-right"><SaveBtn k={navKey} /></div>
              </Section>
            );
          })}

          {/* ───── 聚合入口:已有的影响小程序前端的配置 ───── */}
          <div className="card mb-6">
            <div className="mb-2 text-sm font-semibold">其它影响小程序的配置</div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Link href="/splash" className="btn-ghost h-8 px-3">启动页配图</Link>
              <Link href="/flags" className="btn-ghost h-8 px-3">功能灰度开关</Link>
              <Link href="/broadcasts" className="btn-ghost h-8 px-3">公告/Banner 推送</Link>
              <Link href="/integrations" className="btn-ghost h-8 px-3">第三方服务(含 TG bot)</Link>
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card mb-4">
      <div className="mb-3 text-sm font-semibold text-ink-700">{title}</div>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="mb-1 text-xs text-ink-500">{label}</div>
      {children}
    </div>
  );
}
