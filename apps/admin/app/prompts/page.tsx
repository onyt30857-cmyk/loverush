'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface PromptRow {
  id: string;
  key: string;
  version: number;
  label: string | null;
  content: string;
  status: string; // active / draft / archived
  layer: string; // A / B / C
  changeNote: string | null;
  createdAt: string;
}

const C = {
  a: '#E5484D',
  b: '#E8730C',
  c: '#2DA44E',
  accent: '#4F46E5',
  accentSoft: '#EEF0FF',
  ink: '#1A1D29',
  ink2: '#5B6472',
  ink3: '#9AA1AD',
  line: '#E6E8EC',
  line2: '#EEF0F3',
  add: '#E6F4EA',
  addLine: '#1A7F37',
  del: '#FCEBEC',
  delLine: '#C0344A',
  mono: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace',
};
const LAYER: Record<string, { t: string; color: string }> = {
  A: { t: 'A 风控层 · 只读', color: C.a },
  B: { t: 'B 调优层 · 可改', color: C.b },
  C: { t: 'C 个体层', color: C.c },
};

function pick<T>(r: unknown): T {
  return ((r as { data?: T })?.data ?? r) as T;
}
function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? e.payload.message : String(e);
}

/** 把人设 prompt 按【标题】拆段(开头无标题内容归到首段 title='') */
function parseSegments(content: string): { title: string; body: string }[] {
  const lines = content.split('\n');
  const segs: { title: string; body: string[] }[] = [];
  let cur: { title: string; body: string[] } | null = null;
  for (const ln of lines) {
    const m = ln.match(/^(【.*?】)\s*$/);
    if (m) {
      if (cur) segs.push(cur);
      cur = { title: m[1] ?? '', body: [] };
    } else {
      if (!cur) cur = { title: '', body: [] };
      cur.body.push(ln);
    }
  }
  if (cur) segs.push(cur);
  return segs.map((s) => ({ title: s.title, body: s.body.join('\n').trim() })).filter((s) => s.title || s.body);
}

/** 行级 LCS diff */
function lineDiff(oldStr: string, newStr: string): { type: 'ctx' | 'add' | 'del'; text: string }[] {
  const a = oldStr.split('\n');
  const b = newStr.split('\n');
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: { type: 'ctx' | 'add' | 'del'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'del', text: a[i]! });
      i++;
    } else {
      out.push({ type: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < m) out.push({ type: 'del', text: a[i++]! });
  while (j < n) out.push({ type: 'add', text: b[j++]! });
  return out;
}

export default function PromptsPage() {
  const [list, setList] = useState<PromptRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [versions, setVersions] = useState<PromptRow[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [diffVer, setDiffVer] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const active = useMemo(() => versions.find((v) => v.status === 'active') ?? versions[0] ?? null, [versions]);
  const selRow = useMemo(() => list.find((r) => r.key === selKey) ?? null, [list, selKey]);
  const layer = selRow?.layer ?? active?.layer ?? 'B';
  const readOnly = layer === 'A';

  const loadList = useCallback(async () => {
    try {
      const rows = pick<PromptRow[]>(await api.get('/admin/prompts'));
      setList(rows);
      setSelKey((cur) => cur ?? rows[0]?.key ?? null);
    } catch (e) {
      setErr(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadVersions = useCallback(async (key: string) => {
    try {
      const rows = pick<PromptRow[]>(await api.get(`/admin/prompts/${encodeURIComponent(key)}/versions`));
      setVersions(rows);
      const act = rows.find((v) => v.status === 'active') ?? rows[0];
      setDraft(act?.content ?? '');
      setEditMode(false);
      setDiffVer(null);
      setNote('');
      setCollapsed(new Set());
    } catch (e) {
      setErr(errMsg(e));
    }
  }, []);

  useEffect(() => {
    if (selKey) void loadVersions(selKey);
  }, [selKey, loadVersions]);

  const dirty = active != null && draft !== active.content;

  async function save(publish: boolean) {
    if (!selKey) return;
    setBusy(true);
    setErr(null);
    try {
      const d = pick<{ version: number }>(
        await api.post(`/admin/prompts/${encodeURIComponent(selKey)}`, {
          content: draft,
          changeNote: note || undefined,
        }),
      );
      if (publish) {
        await api.post(`/admin/prompts/${encodeURIComponent(selKey)}/publish`, { version: d.version });
      }
      await loadVersions(selKey);
      await loadList();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function rollback(version: number) {
    if (!selKey) return;
    setBusy(true);
    try {
      await api.post(`/admin/prompts/${encodeURIComponent(selKey)}/publish`, { version });
      await loadVersions(selKey);
      await loadList();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const g: Record<string, PromptRow[]> = { B: [], A: [], C: [] };
    for (const r of list) (g[r.layer] ?? (g[r.layer] = [])).push(r);
    return g;
  }, [list]);

  const segs = useMemo(() => parseSegments(active?.content ?? ''), [active]);
  const diffRow = diffVer != null ? versions.find((v) => v.version === diffVer) ?? null : null;
  const diffLines = diffRow && active ? lineDiff(diffRow.content, active.content) : [];

  return (
    <AdminShell>
      <div style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>Prompt 工作台</h1>
        <p style={{ fontSize: 12.5, color: C.ink3, marginTop: 2 }}>
          后台改 B 调优层不发版即生效 · A 风控层只读(改走代码 review) · 改动存为新版本,可一键回滚
        </p>
      </div>

      {err && (
        <div style={{ marginBottom: 12, borderRadius: 8, background: C.del, color: C.delLine, padding: '9px 14px', fontSize: 12.5 }}>
          {err}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          height: 'calc(100vh - 160px)',
          background: '#fff',
          border: `1px solid ${C.line}`,
          borderRadius: 12,
          overflow: 'hidden',
          fontSize: 13,
          color: C.ink,
        }}
      >
        {/* 左:分层列表 */}
        <div style={{ width: 250, borderRight: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <ColHead label="提示词" right={`${list.length}`} />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {(['B', 'A', 'C'] as const).map((lk) =>
              (grouped[lk]?.length ?? 0) === 0 ? null : (
                <div key={lk} style={{ padding: '10px 0 4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 14px', fontSize: 11, fontWeight: 700 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: LAYER[lk]!.color }} />
                    {LAYER[lk]!.t}
                  </div>
                  {grouped[lk]!.map((r) => {
                    const on = r.key === selKey;
                    return (
                      <button
                        key={r.id}
                        onClick={() => setSelKey(r.key)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '7px 14px 7px 26px',
                          cursor: 'pointer',
                          border: 'none',
                          borderLeft: `2px solid ${on ? C.accent : 'transparent'}`,
                          background: on ? C.accentSoft : 'transparent',
                        }}
                      >
                        <div style={{ fontFamily: C.mono, fontSize: 11, fontWeight: 600 }}>{r.key}</div>
                        <div style={{ fontSize: 11, color: C.ink2, marginTop: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {r.label ?? '—'}
                          <span style={{ color: C.ink3 }}>v{r.version}</span>
                          <StatusDot status={r.status} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              ),
            )}
            {list.length === 0 && (
              <div style={{ padding: 20, fontSize: 12, color: C.ink3, textAlign: 'center' }}>
                还没有 prompt · 跑 seed 脚本灌入现有人设
              </div>
            )}
          </div>
        </div>

        {/* 中:编辑区 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: C.line2 }}>
          {active ? (
            <>
              <div
                style={{
                  background: '#fff',
                  borderBottom: `1px solid ${C.line}`,
                  padding: '11px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexShrink: 0,
                }}
              >
                <span style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 700 }}>{active.key}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 5, color: '#fff', background: LAYER[layer]!.color }}>
                  {layer} {layer === 'A' ? '风控' : layer === 'B' ? '调优' : '个体'}
                </span>
                <span style={{ fontSize: 11.5, color: C.ink2 }}>
                  v{active.version} · <span style={{ color: C.c, fontWeight: 600 }}>●active</span> · {active.content.length.toLocaleString()} 字
                </span>
                <span style={{ flex: 1 }} />
                {!readOnly && !editMode && (
                  <button style={btn()} onClick={() => setEditMode(true)}>
                    编辑全文
                  </button>
                )}
                {!readOnly && editMode && (
                  <>
                    <button style={btn()} disabled={busy} onClick={() => void save(false)}>
                      存草稿
                    </button>
                    <button style={btn(true)} disabled={busy} onClick={() => void save(true)}>
                      存并发布
                    </button>
                  </>
                )}
                {readOnly && <span style={{ fontSize: 11.5, color: C.ink3 }}>🔒 只读 · 改动走代码</span>}
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 18, minHeight: 0 }}>
                <div style={{ maxWidth: 800, margin: '0 auto' }}>
                  {editMode ? (
                    <>
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        style={{
                          width: '100%',
                          height: 'calc(100vh - 360px)',
                          fontFamily: C.mono,
                          fontSize: 12.5,
                          lineHeight: 1.7,
                          padding: 14,
                          border: `1px solid ${C.line}`,
                          borderRadius: 10,
                          resize: 'none',
                          color: '#2C3140',
                        }}
                      />
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="改动说明(进版本历史)"
                        style={{ marginTop: 8, width: '100%', padding: '8px 12px', border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12.5 }}
                      />
                    </>
                  ) : (
                    /* 分段折叠视图 */
                    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden' }}>
                      {segs.map((s, idx) => {
                        const open = !collapsed.has(idx);
                        return (
                          <div key={idx} style={{ borderBottom: idx < segs.length - 1 ? `1px solid ${C.line2}` : 'none' }}>
                            <button
                              onClick={() =>
                                setCollapsed((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(idx)) next.delete(idx);
                                  else next.add(idx);
                                  return next;
                                })
                              }
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                width: '100%',
                                padding: '9px 16px',
                                background: '#FAFBFD',
                                border: 'none',
                                cursor: 'pointer',
                                textAlign: 'left',
                              }}
                            >
                              <span style={{ color: C.ink3, fontSize: 10, width: 10 }}>{open ? '▾' : '▸'}</span>
                              <span style={{ fontWeight: 700, fontSize: 12.5 }}>{s.title || '(开头)'}</span>
                              <span style={{ marginLeft: 'auto', fontSize: 10.5, color: C.ink3, fontFamily: C.mono }}>
                                {s.body.split('\n').filter(Boolean).length} 行
                              </span>
                            </button>
                            {open && s.body && (
                              <div
                                style={{
                                  padding: '6px 16px 12px 34px',
                                  fontFamily: C.mono,
                                  fontSize: 12,
                                  lineHeight: 1.7,
                                  color: '#2C3140',
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {s.body}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  background: '#fff',
                  borderTop: `1px solid ${C.line}`,
                  padding: '9px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  fontSize: 11.5,
                  color: C.ink2,
                  flexShrink: 0,
                }}
              >
                <span style={{ fontFamily: C.mono }}>
                  {(editMode ? draft : active.content).length.toLocaleString()} 字 · {segs.length} 段
                </span>
                {dirty && <span style={{ color: C.b }}>● 有未保存改动</span>}
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.ink3, fontSize: 13 }}>
              选左侧一个 prompt 开始
            </div>
          )}
        </div>

        {/* 右:版本时间线 */}
        <div style={{ width: 290, borderLeft: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <ColHead label="版本历史" />
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {versions.map((v, idx) => (
              <div key={v.id} style={{ position: 'relative', padding: '11px 16px 11px 34px' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 19,
                    top: idx === 0 ? 16 : 0,
                    bottom: idx === versions.length - 1 ? 'auto' : 0,
                    height: idx === versions.length - 1 ? 16 : undefined,
                    width: 2,
                    background: C.line,
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    left: 13,
                    top: 15,
                    width: 13,
                    height: 13,
                    borderRadius: '50%',
                    background: v.status === 'active' ? C.c : '#fff',
                    border: `2px solid ${v.status === 'active' ? C.c : C.line}`,
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 700 }}>v{v.version}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: v.status === 'active' ? C.add : '#F1F2F4',
                      color: v.status === 'active' ? C.addLine : C.ink3,
                    }}
                  >
                    {v.status}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: C.ink2, marginTop: 3 }}>{v.changeNote ?? '—'}</div>
                <div style={{ fontSize: 10.5, color: C.ink3, marginTop: 3 }}>{new Date(v.createdAt).toLocaleString('zh-CN')}</div>
                {v.status !== 'active' && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                    <button style={tlBtn()} onClick={() => setDiffVer(diffVer === v.version ? null : v.version)}>
                      {diffVer === v.version ? '收起 diff' : '查看 diff'}
                    </button>
                    {!readOnly && (
                      <button style={tlBtn()} disabled={busy} onClick={() => void rollback(v.version)}>
                        回到此版
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {versions.length === 0 && (
              <div style={{ padding: 16, fontSize: 11.5, color: C.ink3 }}>选一个 prompt 看版本历史</div>
            )}
          </div>
        </div>
      </div>

      {/* diff 浮层 */}
      {diffRow && (
        <div
          style={{
            position: 'fixed',
            right: 320,
            bottom: 40,
            width: 440,
            background: '#fff',
            border: `1px solid ${C.line}`,
            borderRadius: 10,
            boxShadow: '0 12px 40px -8px rgba(20,25,45,.25)',
            overflow: 'hidden',
            zIndex: 50,
          }}
        >
          <div style={{ padding: '9px 14px', borderBottom: `1px solid ${C.line2}`, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700 }}>
            v{diffRow.version} → v{active?.version}(当前) 改动
            <span style={{ marginLeft: 'auto', color: C.ink3, cursor: 'pointer' }} onClick={() => setDiffVer(null)}>
              ✕
            </span>
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 11.5, lineHeight: 1.65, maxHeight: 260, overflowY: 'auto' }}>
            {diffLines.map((d, i) => (
              <div
                key={i}
                style={{
                  padding: '1px 14px 1px 28px',
                  position: 'relative',
                  whiteSpace: 'pre-wrap',
                  background: d.type === 'add' ? C.add : d.type === 'del' ? C.del : 'transparent',
                  color: d.type === 'ctx' ? C.ink2 : C.ink,
                }}
              >
                <span style={{ position: 'absolute', left: 12, fontWeight: 700, color: d.type === 'add' ? C.addLine : d.type === 'del' ? C.delLine : 'transparent' }}>
                  {d.type === 'add' ? '+' : d.type === 'del' ? '−' : ''}
                </span>
                {d.text || ' '}
              </div>
            ))}
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function ColHead({ label, right }: { label: string; right?: string }) {
  return (
    <div
      style={{
        height: 38,
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
        fontSize: 11,
        fontWeight: 700,
        color: C.ink2,
        letterSpacing: '.05em',
        borderBottom: `1px solid ${C.line2}`,
        flexShrink: 0,
      }}
    >
      {label}
      {right && <span style={{ marginLeft: 'auto', color: C.ink3, fontWeight: 500 }}>{right}</span>}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const isActive = status === 'active';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: isActive ? C.c : C.b }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: isActive ? C.c : C.b }} />
      {isActive ? 'active' : status === 'draft' ? '草稿' : status}
    </span>
  );
}

function btn(primary = false): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 13px',
    borderRadius: 7,
    border: `1px solid ${primary ? C.accent : C.line}`,
    background: primary ? C.accent : '#fff',
    color: primary ? '#fff' : C.ink,
    cursor: 'pointer',
  };
}
function tlBtn(): React.CSSProperties {
  return {
    fontSize: 10.5,
    fontWeight: 600,
    padding: '3px 9px',
    borderRadius: 5,
    border: `1px solid ${C.line}`,
    background: '#fff',
    color: C.ink2,
    cursor: 'pointer',
  };
}
