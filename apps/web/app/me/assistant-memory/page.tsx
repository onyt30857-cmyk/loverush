'use client';

/**
 * /me/assistant-memory · 我的助理记忆(轻量重建,M03)
 *
 * 展示"助理记得你什么"(L1 facts + L2 stable_prefs + 禁忌)+ 导出 + 一键擦除。
 * 只读自 GET /assistant/memory(无副作用);导出 GET /assistant/memory/export;
 * 擦除 POST /assistant/memory/delete(30 天 grace)。仅本人可见。
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { LoadingFull } from '@/components/ui';
import { Brain, Download, Trash2, ShieldCheck } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';

interface MemoryData {
  facts: Record<string, unknown>;
  stablePrefs: { dislikes?: string[]; priorities?: string[]; priceBand?: string; [k: string]: unknown };
  tabooZones: string[];
  hasAny: boolean;
  exportedAt: string | null;
  deletionScheduledAt: string | null;
}

// 只展示这些有意义的偏好键(白名单)· 其余(onboarding_* 内部状态、uuid、对象)一律不显
const FACT_LABEL: Record<string, string> = {
  primary_focus: '常去城市',
  service_area: '可接受车程',
  gender_pref: '偏好性别',
  age_pref: '偏好年龄',
  height_pref: '偏好身高',
  bust_pref: '偏好罩杯',
  body_type: '身材偏好',
  nationality_pref: '偏好国籍',
  language: '语言',
  service_style: '喜欢的风格',
  service_strength: '力度偏好',
  tip_band: '消费档位',
  // 兼容 schema 注释里的旧键
  city: '城市', gender: '性别', ageRange: '年龄段', origin: '来源',
};
// 偏好键展示顺序(白名单同时定义顺序)
const FACT_ORDER = Object.keys(FACT_LABEL);
// 值翻译(英文码 → 中文)
const VAL_MAP: Record<string, string> = {
  female: '女', male: '男', any: '不限', all: '不限', unknown: '不限',
};
const PRICE_LABEL: Record<string, string> = { low: '经济', mid: '适中', high: '高端' };

function fmtVal(v: string): string {
  return VAL_MAP[v] ?? v;
}

export default function AssistantMemoryPage() {
  const [mem, setMem] = useState<MemoryData | null>(null);
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMem(await apiGet<MemoryData>('/assistant/memory'));
    } catch {
      setMem({ facts: {}, stablePrefs: {}, tabooZones: [], hasAny: false, exportedAt: null, deletionScheduledAt: null });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };

  async function exportData() {
    setBusy('export');
    try {
      const d = await apiGet<unknown>('/assistant/memory/export');
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `loverush-memory-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('已导出到本地');
    } catch {
      showToast('导出失败 · 稍后再试');
    } finally {
      setBusy(null);
    }
  }

  async function eraseAll() {
    setBusy('delete');
    try {
      await apiPost('/assistant/memory/delete', { confirm: true });
      setConfirmDel(false);
      showToast('已申请擦除 · 30 天后真删除');
      await load();
    } catch {
      showToast('操作失败 · 稍后再试');
    } finally {
      setBusy(null);
    }
  }

  if (mem === null) return <LoadingFull />;

  // 白名单 + 只取 string/number(过滤 onboarding_* 内部状态、对象 [object Object]、uuid)· 按 FACT_ORDER 排序
  const factEntries: Array<[string, string]> = FACT_ORDER.flatMap((k) => {
    const v = mem.facts[k];
    if (v == null || v === '' || (typeof v !== 'string' && typeof v !== 'number')) return [];
    return [[k, String(v)] as [string, string]];
  });
  const priorities = mem.stablePrefs.priorities ?? [];
  const dislikes = mem.stablePrefs.dislikes ?? [];
  const priceBand = mem.stablePrefs.priceBand;

  return (
    <AppShell title="我的助理记忆" showBack>
      {/* 头图 */}
      <div className="bg-gradient-to-b from-primary-50/70 to-transparent px-5 pb-3 pt-5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-warm-sm">
            <Brain className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold text-ink-900">助理记得你什么</h1>
            <div className="flex items-center gap-1 text-[11px] text-ink-500"><ShieldCheck className="h-3 w-3" />仅你自己可见 · 随时可删</div>
          </div>
        </div>
      </div>

      <div className="px-4 pb-8">
        {mem.deletionScheduledAt && (
          <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-600">
            已申请擦除 · 30 天后真删除(期间继续使用助理会重新建立记忆)
          </div>
        )}

        {!mem.hasAny ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Brain className="h-12 w-12 text-warm-200" />
            <p className="mt-4 text-[13.5px] font-medium text-ink-600">助理还没记住关于你的信息</p>
            <p className="mt-1 text-[12px] text-ink-400">多和助理聊聊,它会越来越懂你的偏好</p>
            <Link href="/home" className="mt-6 rounded-full bg-gradient-cta px-6 py-2.5 text-[13px] font-semibold text-white">和助理聊聊</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {/* 助理了解你的偏好 */}
            {factEntries.length > 0 && (
              <Section title="助理了解你的偏好">
                <div className="divide-y divide-warm-100">
                  {factEntries.map(([k, v]) => {
                    const parts = v.split(',').map((s) => fmtVal(s.trim())).filter(Boolean);
                    return (
                      <div key={k} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                        <span className="shrink-0 text-ink-500">{FACT_LABEL[k] ?? k}</span>
                        {parts.length > 1 ? (
                          <div className="flex flex-wrap justify-end gap-1">
                            {parts.map((p) => (
                              <span key={p} className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] text-primary">{p}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-right font-medium text-ink-800">{parts[0] ?? v}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* 偏好 */}
            {(priorities.length > 0 || dislikes.length > 0 || priceBand) && (
              <Section title="偏好">
                {priceBand && (
                  <div className="mb-2 flex items-center justify-between text-[13px]">
                    <span className="text-ink-500">价位倾向</span>
                    <span className="font-medium text-ink-800">{PRICE_LABEL[priceBand] ?? priceBand}</span>
                  </div>
                )}
                {priorities.length > 0 && <ChipRow label="在意" items={priorities} tone="primary" />}
                {dislikes.length > 0 && <ChipRow label="不喜欢" items={dislikes} tone="ink" />}
              </Section>
            )}

            {/* 禁忌 */}
            {mem.tabooZones.length > 0 && (
              <Section title="禁忌(永不触碰)">
                <ChipRow items={mem.tabooZones} tone="rose" />
              </Section>
            )}
          </div>
        )}

        {/* 数据自主 */}
        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={() => void exportData()}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-warm-200 bg-white py-3 text-[13px] font-medium text-ink-700 active:bg-warm-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />{busy === 'export' ? '导出中…' : '导出我的数据'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDel(true)}
            disabled={busy !== null || !!mem.deletionScheduledAt}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-rose-200 bg-white py-3 text-[13px] font-medium text-rose-500 active:bg-rose-50 disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />{mem.deletionScheduledAt ? '已申请擦除' : '擦除全部记忆'}
          </button>
        </div>
      </div>

      {/* 擦除确认 */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setConfirmDel(false)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-ink-900">擦除全部助理记忆?</h3>
            <p className="mt-1.5 text-[12.5px] leading-6 text-ink-500">
              助理将忘记你的所有偏好。标记后 <strong>30 天</strong>真删除,期间继续聊会重新建立。
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setConfirmDel(false)} className="flex-1 rounded-full border border-warm-200 py-2.5 text-[13px] text-ink-600">取消</button>
              <button type="button" onClick={() => void eraseAll()} disabled={busy === 'delete'} className="flex-1 rounded-full bg-rose-500 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50">
                {busy === 'delete' ? '处理中…' : '确认擦除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink-800/90 px-4 py-2 text-[12px] text-white">{toast}</div>
      )}
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-warm-100 bg-white p-4">
      <div className="mb-1.5 text-[12px] font-semibold text-ink-700">{title}</div>
      {children}
    </div>
  );
}

function ChipRow({ label, items, tone }: { label?: string; items: string[]; tone: 'primary' | 'ink' | 'rose' }) {
  const cls =
    tone === 'primary' ? 'bg-primary-50 text-primary' : tone === 'rose' ? 'bg-rose-50 text-rose-600' : 'bg-warm-100 text-ink-600';
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {label && <span className="text-[11px] text-ink-400">{label}</span>}
      {items.map((t) => (
        <span key={t} className={`rounded-full px-2.5 py-0.5 text-[11px] ${cls}`}>{t}</span>
      ))}
    </div>
  );
}
