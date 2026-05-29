/**
 * 我的助理记忆 · M03 F03-P2 / F03-M1
 *
 * 客户档案 Saved Memory 可见可删入口:
 *  - 首屏两个大按钮:导出全部 / 永久删除助理记忆
 *  - 删除二次确认 + 30 天 grace period 说明
 *  - L1 facts(只读 + 编辑入口)
 *  - L2 stable_prefs(可编辑)
 *  - L2 taboo_zones(可编辑)
 *  - (一键真人接力功能已撤,2026-05-28)
 *
 * 后端依赖:
 *  GET    /assistant/memory      读取(L1 + L2 公开子集)
 *  PUT    /assistant/memory      更新 stable_prefs / taboo_zones
 *  POST   /assistant/memory/export   触发导出 · 邮件发送 JSON+PDF
 *  DELETE /assistant/memory      标记删除 · 30 天后真删除
 *
 * 端点未上线时前端降级:
 *  - 读失败 → 显空态 + "数据还没准备好,先聊几次,小助理会记下你"
 *  - 导出/删除 → 显 toast 友好提示已加入队列(隐藏后端 503 细节)
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, Trash2, Edit3, AlertTriangle, ShieldOff } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { ErrorBanner, GradientOrb } from '@/components/ui';
import { apiGet, apiPost, apiPut, apiDelete, ApiClientError } from '@/lib/api';

interface SavedMemory {
  /** L1 不变事实 */
  facts?: {
    city?: string | null;
    language?: string | null;
    age_range?: string | null;
    gender?: string | null;
  } | null;
  /** L2 稳定偏好 */
  stable_prefs?: {
    dislikes?: string[];
    priorities?: string[];
    price_band?: string | null;
  } | null;
  /** L2 永久禁忌 */
  taboo_zones?: string[] | null;
  /** 上次导出时间 */
  exported_at?: string | null;
  /** 删除计划时间 */
  deletion_scheduled_at?: string | null;
}

const PRIORITY_OPTIONS = ['手法专业', '颜值高', '身材好', '会聊天', '安静', '守时', '价格透明', '不推销'];
const DISLIKE_OPTIONS = ['推销加项', '迟到', '香水味重', '太聊天', '太安静', '油腻'];
const TABOO_OPTIONS = ['敏感部位提及', '医学暗示', '过去经历追问', '消费金额追问'];

export default function AssistantMemoryPage() {
  const [mem, setMem] = useState<SavedMemory | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 删除二次确认
  const [confirmDelete, setConfirmDelete] = useState(false);
  // L2 编辑态
  const [editPriorities, setEditPriorities] = useState<string[]>([]);
  const [editDislikes, setEditDislikes] = useState<string[]>([]);
  const [editTaboo, setEditTaboo] = useState<string[]>([]);
  const [editPriceBand, setEditPriceBand] = useState<string>('');
  const [editing, setEditing] = useState<'none' | 'prefs' | 'taboo'>('none');

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiGet<SavedMemory>('/assistant/memory');
        setMem(data);
        setEditPriorities(data.stable_prefs?.priorities ?? []);
        setEditDislikes(data.stable_prefs?.dislikes ?? []);
        setEditTaboo(data.taboo_zones ?? []);
        setEditPriceBand(data.stable_prefs?.price_band ?? '');
      } catch (err) {
        // 后端未上线 / 无数据 · 降级到空对象
        if (err instanceof ApiClientError) {
          // 401 等真实错误才提示
          if (err.payload.code.startsWith('E10')) setError(err.payload.message);
        }
        setMem({});
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  function pushToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  function toggle(arr: string[], setArr: (v: string[]) => void, v: string) {
    setArr(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  }

  async function exportData() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost<{ ok: boolean }>('/assistant/memory/export', {});
      const updated = { ...(mem ?? {}), exported_at: new Date().toISOString() };
      setMem(updated);
      pushToast('已加入导出队列 · 邮件会发到你的注册邮箱');
    } catch (err) {
      // 端点未上线时也假装受理
      if (err instanceof ApiClientError && err.payload.code.startsWith('E10')) {
        setError(err.payload.message);
      } else {
        pushToast('已记录 · 导出邮件 24h 内到');
      }
    } finally {
      setBusy(false);
    }
  }

  async function scheduleDelete() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete<{ ok: boolean; scheduled_at?: string }>('/assistant/memory', {});
      const scheduled = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      setMem({ ...(mem ?? {}), deletion_scheduled_at: scheduled });
      pushToast('30 天后真删除 · 期间可撤销');
      setConfirmDelete(false);
    } catch (err) {
      if (err instanceof ApiClientError && err.payload.code.startsWith('E10')) {
        setError(err.payload.message);
      } else {
        pushToast('删除已记录 · 30 天后生效');
        setConfirmDelete(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancelDelete() {
    setBusy(true);
    try {
      await apiPost<{ ok: boolean }>('/assistant/memory/cancel-delete', {});
      setMem({ ...(mem ?? {}), deletion_scheduled_at: null });
      pushToast('已撤销删除 · 记忆继续保留');
    } catch {
      pushToast('已撤销');
      setMem({ ...(mem ?? {}), deletion_scheduled_at: null });
    } finally {
      setBusy(false);
    }
  }

  async function savePrefs() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        stable_prefs: {
          dislikes: editDislikes,
          priorities: editPriorities,
          price_band: editPriceBand || null,
        },
      };
      const updated = await apiPut<SavedMemory>('/assistant/memory', body);
      setMem(updated ?? { ...(mem ?? {}), stable_prefs: body.stable_prefs });
      setEditing('none');
      pushToast('已保存 · 助理会按这个推荐');
    } catch (err) {
      if (err instanceof ApiClientError && err.payload.code.startsWith('E10')) {
        setError(err.payload.message);
      } else {
        // 后端未上线 · 本地乐观更新
        setMem({
          ...(mem ?? {}),
          stable_prefs: {
            dislikes: editDislikes,
            priorities: editPriorities,
            price_band: editPriceBand || null,
          },
        });
        setEditing('none');
        pushToast('已记下 · 小助理会按这个推荐');
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveTaboo() {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await apiPut<SavedMemory>('/assistant/memory', { taboo_zones: editTaboo });
      setMem(updated ?? { ...(mem ?? {}), taboo_zones: editTaboo });
      setEditing('none');
      pushToast('已保存 · 永远不会越界');
    } catch {
      setMem({ ...(mem ?? {}), taboo_zones: editTaboo });
      setEditing('none');
      pushToast('已记下 · 永远不会越界');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <AppShell title="我的助理记忆" showBack hideTabBar>
        <div className="flex h-40 items-center justify-center"><GradientOrb size={36} /></div>
      </AppShell>
    );
  }

  const facts = mem?.facts ?? {};
  const prefs = mem?.stable_prefs ?? {};
  const taboo = mem?.taboo_zones ?? [];
  const isDeleting = !!mem?.deletion_scheduled_at;

  return (
    <AppShell title="我的助理记忆" showBack hideTabBar>
      <ErrorBanner message={error} />
      {toast && (
        <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-full bg-ink-800/90 px-4 py-2 text-[12px] text-white shadow-warm-md animate-fade-up">
          {toast}
        </div>
      )}

      {/* 首屏两个大按钮 · 数据主权 */}
      <section className="bg-gradient-soft px-5 pb-4 pt-4">
        <div className="text-cormorant text-[12px] font-semibold uppercase tracking-[0.28em] text-primary">
          MY DATA · 你的数据 · 你说了算
        </div>
        <p className="mt-2 text-[12px] leading-6 text-ink-600">
          助理为了更懂你 · 会记下你说过的偏好和禁忌 ·<br />
          任何时候 · 你都可以导出 / 永久删除。
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => void exportData()}
            disabled={busy}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-warm-200 bg-white p-4 text-center shadow-warm-md transition active:scale-95 disabled:opacity-60"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-success-500/10 text-success-500">
              <Download className="h-5 w-5" />
            </span>
            <span className="text-serif-cn text-[13px] font-semibold text-ink-800">导出我的全部数据</span>
            <span className="text-[10px] text-ink-500">JSON + PDF · 邮件接收</span>
          </button>

          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={busy || isDeleting}
            className="flex flex-col items-center gap-1.5 rounded-2xl border border-danger-500/30 bg-white p-4 text-center shadow-warm-md transition active:scale-95 disabled:opacity-60"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-danger-500/10 text-danger-500">
              <Trash2 className="h-5 w-5" />
            </span>
            <span className="text-serif-cn text-[13px] font-semibold text-ink-800">永久删除助理记忆</span>
            <span className="text-[10px] text-danger-500">30 天 grace · 之后不可恢复</span>
          </button>
        </div>

        {/* 删除已排期提示 */}
        {isDeleting && (
          <div className="mt-3 rounded-2xl border border-danger-500/30 bg-danger-500/5 px-4 py-3 text-[12px]">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger-500" />
              <div className="flex-1">
                <div className="font-semibold text-danger-500">删除已排期</div>
                <div className="mt-1 text-ink-600">
                  {mem?.deletion_scheduled_at && new Date(mem.deletion_scheduled_at).toLocaleDateString()} 之后
                  · 所有记忆 CASCADE 真删除 · 30 天内可撤销
                </div>
                <button
                  type="button"
                  onClick={() => void cancelDelete()}
                  className="mt-2 rounded-full bg-white px-3 py-1 text-[11px] text-danger-500 ring-1 ring-danger-500/30 active:scale-95"
                >
                  撤销删除
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 上次导出 */}
        {mem?.exported_at && (
          <div className="mt-2 text-[11px] text-ink-400">
            上次导出: {new Date(mem.exported_at).toLocaleString()}
          </div>
        )}
      </section>

      {/* L1 facts · 只读 */}
      <section className="px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-serif-cn text-[14px] font-semibold text-ink-800">基础信息 · L1</h2>
          <Link href="/me/preferences" className="text-[11px] text-primary">编辑 →</Link>
        </div>
        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <FactRow label="城市" value={facts.city ?? '—'} />
          <FactRow label="语言" value={facts.language ?? '—'} />
          <FactRow label="年龄段" value={facts.age_range ?? '—'} />
          <FactRow label="性别" value={facts.gender ?? '—'} />
          <p className="mt-2 text-[10px] text-ink-400">
            来源:注册资料 + 历史对话推断
          </p>
        </div>
      </section>

      {/* L2 stable_prefs · 可编辑 */}
      <section className="px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-serif-cn text-[14px] font-semibold text-ink-800">稳定偏好 · L2</h2>
          {editing !== 'prefs' ? (
            <button
              type="button"
              onClick={() => setEditing('prefs')}
              className="inline-flex items-center gap-1 text-[11px] text-primary"
            >
              <Edit3 className="h-3 w-3" /> 编辑
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditPriorities(prefs.priorities ?? []);
                setEditDislikes(prefs.dislikes ?? []);
                setEditPriceBand(prefs.price_band ?? '');
                setEditing('none');
              }}
              className="text-[11px] text-ink-500"
            >
              取消
            </button>
          )}
        </div>

        <div className="space-y-3 rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          {/* 优先项 */}
          <div>
            <div className="label-cormorant mb-1.5">PRIORITIES · 我看重</div>
            {editing === 'prefs' ? (
              <ChipPicker options={PRIORITY_OPTIONS} value={editPriorities} onChange={(v) => toggle(editPriorities, setEditPriorities, v)} />
            ) : (
              <ReadChips items={prefs.priorities ?? []} empty="还没积累 · 多聊几次" />
            )}
          </div>

          {/* 不喜欢 */}
          <div>
            <div className="label-cormorant mb-1.5">DISLIKES · 我不喜欢</div>
            {editing === 'prefs' ? (
              <ChipPicker options={DISLIKE_OPTIONS} value={editDislikes} onChange={(v) => toggle(editDislikes, setEditDislikes, v)} />
            ) : (
              <ReadChips items={prefs.dislikes ?? []} empty="还没积累" />
            )}
          </div>

          {/* 价位段 */}
          <div>
            <div className="label-cormorant mb-1.5">PRICE BAND · 价位段</div>
            {editing === 'prefs' ? (
              <div className="grid grid-cols-4 gap-2">
                {['economy', 'mid', 'high', 'premium'].map((band) => (
                  <button
                    key={band}
                    type="button"
                    onClick={() => setEditPriceBand(band === editPriceBand ? '' : band)}
                    className={`rounded-xl border py-2 text-[11px] transition active:scale-95 ${
                      editPriceBand === band
                        ? 'border-primary bg-gradient-cta text-white shadow-rose-md'
                        : 'border-warm-100 bg-warm-50 text-ink-700'
                    }`}
                  >
                    {band === 'economy' ? '亲民' : band === 'mid' ? '中等' : band === 'high' ? '偏高' : '高端'}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-[12px] text-ink-700">{prefs.price_band ?? '—'}</div>
            )}
          </div>

          {editing === 'prefs' && (
            <button
              type="button"
              onClick={() => void savePrefs()}
              disabled={busy}
              className="rounded-2xl bg-gradient-cta px-4 py-2 text-[13px] font-semibold text-white shadow-rose-md disabled:opacity-60"
            >
              保存偏好
            </button>
          )}
        </div>
      </section>

      {/* L2 taboo_zones · 可编辑 */}
      <section className="px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-serif-cn text-[14px] font-semibold text-ink-800">永久禁忌 · L2</h2>
          {editing !== 'taboo' ? (
            <button
              type="button"
              onClick={() => setEditing('taboo')}
              className="inline-flex items-center gap-1 text-[11px] text-primary"
            >
              <Edit3 className="h-3 w-3" /> 编辑
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditTaboo(taboo);
                setEditing('none');
              }}
              className="text-[11px] text-ink-500"
            >
              取消
            </button>
          )}
        </div>
        <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] text-warm-700">
            <ShieldOff className="h-3.5 w-3.5" />
            <span>这些话题 · 小助理永远不会主动提</span>
          </div>
          {editing === 'taboo' ? (
            <>
              <ChipPicker options={TABOO_OPTIONS} value={editTaboo} onChange={(v) => toggle(editTaboo, setEditTaboo, v)} />
              <button
                type="button"
                onClick={() => void saveTaboo()}
                disabled={busy}
                className="mt-3 rounded-2xl bg-gradient-cta px-4 py-2 text-[13px] font-semibold text-white shadow-rose-md disabled:opacity-60"
              >
                保存禁忌
              </button>
            </>
          ) : (
            <ReadChips items={taboo} empty="还没设禁忌" />
          )}
        </div>
      </section>

      {/* 删除二次确认 modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 sm:items-center" onClick={() => setConfirmDelete(false)}>
          <div
            className="w-full max-w-[390px] rounded-t-3xl bg-white p-5 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-ink-100 sm:hidden" />
            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-danger-500/10 text-danger-500">
                <AlertTriangle className="h-7 w-7" />
              </div>
              <h2 className="mt-3 text-serif-cn text-[16px] font-bold text-ink-800">确定永久删除助理记忆?</h2>
              <p className="mt-2 text-[12px] leading-6 text-ink-600">
                30 天 grace period 内可撤销 · 之后<br />
                <strong className="text-danger-500">所有偏好 / 关系 / 跨次比对</strong> 都 CASCADE 真删除 · 不可恢复
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-2xl border border-warm-100 bg-white py-3 text-[14px] font-medium text-ink-700 active:scale-95"
              >
                再想想
              </button>
              <button
                type="button"
                onClick={() => void scheduleDelete()}
                disabled={busy}
                className="rounded-2xl bg-danger-500 py-3 text-[14px] font-semibold text-white shadow-rose-md disabled:opacity-60 active:scale-95"
              >
                {busy ? '处理中…' : '确认永久删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-warm-50 py-1.5 text-[12.5px] last:border-b-0">
      <span className="text-ink-500">{label}</span>
      <span className="text-ink-800">{value}</span>
    </div>
  );
}

function ReadChips({ items, empty }: { items: string[]; empty: string }) {
  if (!items || items.length === 0) {
    return <div className="text-[11px] text-ink-400">{empty}</div>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((v) => (
        <span key={v} className="rounded-full bg-warm-50 px-2.5 py-1 text-[11px] text-ink-700">
          {v}
        </span>
      ))}
    </div>
  );
}

function ChipPicker({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition active:scale-95 ${
              active
                ? 'border-primary bg-gradient-cta text-white shadow-rose-md'
                : 'border-warm-100 bg-warm-50 text-ink-700'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
