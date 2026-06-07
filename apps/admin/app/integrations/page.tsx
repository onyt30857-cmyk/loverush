'use client';

import { useEffect, useMemo, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface EnvStatus {
  name: string;
  present: boolean;
  preview: string | null;
}
interface Integration {
  id: string;
  key: string;
  displayName: string;
  category: string;
  purpose: string;
  envVars: string[];
  criticality: 'critical' | 'important' | 'optional';
  docsUrl: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
  notes: string | null;
  sortOrder: number;
  updatedAt: string;
  env: EnvStatus[];
  configSource: 'env' | 'db';
  configured: boolean;
}

const CAT_LABEL: Record<string, string> = {
  llm: '大模型', voice: '语音', storage: '存储 / CDN', push: '推送', payment: '支付',
  monitoring: '监控', geo: '地理', messaging: '消息渠道', alert: '预警', email: '邮件', fx: '汇率', other: '其他',
};
const CRIT_LABEL: Record<string, string> = { critical: '核心', important: '重要', optional: '可选' };
const CRIT_CLS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700', important: 'bg-amber-100 text-amber-700', optional: 'bg-ink-100 text-ink-500',
};

export default function IntegrationsPage() {
  const [list, setList] = useState<Integration[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Integration | null>(null);

  async function load() {
    try {
      setList(await api.get<Integration[]>('/admin/integrations'));
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!editing) return;
    try {
      await api.patch(`/admin/integrations/${editing.key}`, {
        display_name: editing.displayName,
        purpose: editing.purpose,
        criticality: editing.criticality,
        docs_url: editing.docsUrl || null,
        enabled: editing.enabled,
        notes: editing.notes || null,
        config: editing.config,
      });
      setEditing(null);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  const stats = useMemo(() => ({
    total: list.length,
    configured: list.filter((s) => s.configured).length,
    enabled: list.filter((s) => s.enabled).length,
  }), [list]);

  // 按 category 分组展示
  const groups = useMemo(() => {
    const m = new Map<string, Integration[]>();
    for (const s of list) {
      const arr = m.get(s.category) ?? [];
      arr.push(s);
      m.set(s.category, arr);
    }
    return Array.from(m.entries());
  }, [list]);

  return (
    <AdminShell>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">第三方服务</h1>
        <div className="text-sm text-ink-500">
          共 {stats.total} 个 · 已配置 <span className="font-semibold text-green-600">{stats.configured}</span> · 启用 {stats.enabled}
        </div>
      </div>
      <p className="mb-5 text-xs text-ink-500">
        平台当前接入的外部服务清单与用途明细。密钥本身不在此修改(走 Railway 环境变量),此处可查看是否已配置(脱敏)并维护用途/启用/非密钥参数。
      </p>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {groups.map(([cat, items]) => (
        <div key={cat} className="mb-6">
          <div className="mb-2 text-sm font-semibold text-ink-500">{CAT_LABEL[cat] ?? cat}</div>
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((s) => (
              <div key={s.key} className="card">
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold">{s.displayName}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${CRIT_CLS[s.criticality]}`}>{CRIT_LABEL[s.criticality]}</span>
                    {!s.enabled && <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-400">已停用</span>}
                  </div>
                  <span className={`flex items-center gap-1 text-xs ${s.configured ? 'text-green-600' : 'text-ink-400'}`}>
                    <span className={`inline-block h-2 w-2 rounded-full ${s.configured ? 'bg-green-500' : 'bg-ink-200'}`} />
                    {s.configured ? (s.configSource === 'db' ? 'DB 配置' : '已配置') : '未配置'}
                  </span>
                </div>
                <div className="mb-2 text-xs leading-relaxed text-ink-600">{s.purpose}</div>
                {s.env.length > 0 && (
                  <div className="mb-2 space-y-0.5">
                    {s.env.map((e) => (
                      <div key={e.name} className="flex items-center justify-between font-mono text-[11px]">
                        <span className={e.present ? 'text-ink-500' : 'text-red-400'}>{e.name}</span>
                        <span className={e.present ? 'text-ink-400' : 'text-red-400'}>{e.present ? e.preview : '— 未设置'}</span>
                      </div>
                    ))}
                  </div>
                )}
                {Object.keys(s.config).length > 0 && (
                  <div className="mb-2 text-[11px] text-ink-400">
                    参数：{Object.entries(s.config).map(([k, v]) => `${k}=${String(v)}`).join(' · ')}
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  {s.docsUrl ? (
                    <a href={s.docsUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline">控制台 ↗</a>
                  ) : <span />}
                  <button type="button" onClick={() => setEditing({ ...s })} className="btn-ghost h-7 px-3 text-xs">编辑</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {editing && (
        <Modal title={`编辑 · ${editing.displayName}`} onClose={() => setEditing(null)}>
          <div className="mb-3">
            <div className="mb-1 text-xs text-ink-500">名称</div>
            <input className="input w-full" value={editing.displayName}
              onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} />
          </div>
          <div className="mb-3">
            <div className="mb-1 text-xs text-ink-500">用途</div>
            <textarea className="h-20 w-full rounded-lg border border-ink-100 p-3 text-sm" value={editing.purpose}
              onChange={(e) => setEditing({ ...editing, purpose: e.target.value })} />
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 text-xs text-ink-500">关键性</div>
              <select className="input w-full" value={editing.criticality}
                onChange={(e) => setEditing({ ...editing, criticality: e.target.value as Integration['criticality'] })}>
                <option value="critical">核心</option>
                <option value="important">重要</option>
                <option value="optional">可选</option>
              </select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={editing.enabled}
                onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
              启用该服务
            </label>
          </div>
          <div className="mb-3">
            <div className="mb-1 text-xs text-ink-500">控制台 / 文档 URL</div>
            <input className="input w-full" placeholder="https://..." value={editing.docsUrl ?? ''}
              onChange={(e) => setEditing({ ...editing, docsUrl: e.target.value })} />
          </div>
          <div className="mb-3">
            <div className="mb-1 text-xs text-ink-500">备注</div>
            <textarea className="h-16 w-full rounded-lg border border-ink-100 p-3 text-sm" value={editing.notes ?? ''}
              onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
          </div>
          {editing.env.length > 0 && (
            <div className="mb-3 rounded-lg bg-ink-50 p-3">
              <div className="mb-1 text-xs font-semibold text-ink-500">环境变量(密钥只读 · 改值请在 Railway env)</div>
              {editing.env.map((e) => (
                <div key={e.name} className="flex items-center justify-between font-mono text-[11px]">
                  <span className={e.present ? 'text-ink-500' : 'text-red-400'}>{e.name}</span>
                  <span className="text-ink-400">{e.present ? e.preview : '— 未设置'}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(null)} className="btn-ghost flex-1">取消</button>
            <button type="button" onClick={() => void save()} className="btn-primary flex-1">保存</button>
          </div>
        </Modal>
      )}
    </AdminShell>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="text-ink-300">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
