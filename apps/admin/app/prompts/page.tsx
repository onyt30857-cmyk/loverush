'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface PromptRow {
  id: string;
  key: string;
  version: number;
  label: string | null;
  content: string;
  status: string;
  layer: string;
  changeNote: string | null;
  createdAt: string;
}

/** 后端返回 { data: ... } 或裸值,兼容解包 */
function pick<T>(r: unknown): T {
  return ((r as { data?: T })?.data ?? r) as T;
}

const LAYER: Record<string, { t: string; cls: string }> = {
  A: { t: 'A 风控·只读', cls: 'bg-red-50 text-red-600' },
  B: { t: 'B 调优·可改', cls: 'bg-orange-50 text-orange-600' },
  C: { t: 'C 个体', cls: 'bg-green-50 text-green-600' },
};

function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? e.payload.message : String(e);
}

export default function PromptsPage() {
  const [list, setList] = useState<PromptRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<PromptRow | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<{ key: string; rows: PromptRow[] } | null>(null);

  async function load() {
    try {
      setList(pick<PromptRow[]>(await api.get('/admin/prompts')));
    } catch (e) {
      setErr(errMsg(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function openEdit(p: PromptRow) {
    setEdit(p);
    setDraft(p.content);
    setNote('');
  }

  async function save(publish: boolean) {
    if (!edit) return;
    setBusy(true);
    setErr(null);
    try {
      const d = pick<{ version: number }>(
        await api.post(`/admin/prompts/${encodeURIComponent(edit.key)}`, {
          content: draft,
          changeNote: note || undefined,
        }),
      );
      if (publish) {
        await api.post(`/admin/prompts/${encodeURIComponent(edit.key)}/publish`, {
          version: d.version,
        });
      }
      setEdit(null);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function openHist(key: string) {
    try {
      setHist({
        key,
        rows: pick<PromptRow[]>(await api.get(`/admin/prompts/${encodeURIComponent(key)}/versions`)),
      });
    } catch (e) {
      setErr(errMsg(e));
    }
  }

  async function rollback(key: string, version: number) {
    setBusy(true);
    try {
      await api.post(`/admin/prompts/${encodeURIComponent(key)}/publish`, { version });
      setHist(null);
      await load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <h1 className="mb-1 text-2xl font-bold">Prompt 模板</h1>
      <p className="mb-4 text-sm text-ink-500">
        后台改 B 调优层 prompt 不发版即生效;A 风控层只读(改走代码 review)。改动存为新版本,可一键回滚。
      </p>
      {err && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Key</th>
              <th>名称</th>
              <th>层</th>
              <th>版本</th>
              <th>更新</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td className="font-mono text-xs">{p.key}</td>
                <td>{p.label ?? '—'}</td>
                <td>
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold ${LAYER[p.layer]?.cls ?? ''}`}
                  >
                    {LAYER[p.layer]?.t ?? p.layer}
                  </span>
                </td>
                <td className="num">v{p.version}</td>
                <td className="text-xs text-ink-500">
                  {new Date(p.createdAt).toLocaleString('zh-CN')}
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => void openHist(p.key)}
                    className="btn-ghost mr-1 h-7 px-3 text-xs"
                  >
                    历史
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    disabled={p.layer === 'A'}
                    className="btn-ghost h-7 px-3 text-xs disabled:opacity-40"
                  >
                    {p.layer === 'A' ? '只读' : '编辑'}
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-sm text-ink-400">
                  还没有 prompt · 跑 seed 脚本灌入现有人设
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={`编辑:${edit.label ?? edit.key}`} onClose={() => setEdit(null)}>
          <textarea
            className="input h-80 w-full font-mono text-xs"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <input
            className="input mt-2 w-full"
            placeholder="改动说明(可选)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setEdit(null)} className="btn-ghost flex-1">
              取消
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(false)}
              className="btn-ghost flex-1"
            >
              存草稿
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(true)}
              className="btn-primary flex-1"
            >
              存并发布
            </button>
          </div>
        </Modal>
      )}

      {hist && (
        <Modal title={`版本历史:${hist.key}`} onClose={() => setHist(null)}>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {hist.rows.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-2 rounded-lg border border-ink-100 px-3 py-2"
              >
                <span className="num text-sm font-semibold">v{v.version}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${v.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-ink-100 text-ink-500'}`}
                >
                  {v.status}
                </span>
                <span className="flex-1 truncate text-xs text-ink-500">{v.changeNote ?? '—'}</span>
                {v.status !== 'active' && v.layer !== 'A' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void rollback(hist.key, v.version)}
                    className="btn-ghost h-6 px-2 text-xs"
                  >
                    回到此版
                  </button>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </AdminShell>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div className="card w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}
