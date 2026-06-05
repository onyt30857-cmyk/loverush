/**
 * 发现页 · 完整筛选抽屉
 *
 * 与顶部 chips 共享同一份 DiscoverFilters state(双向同步):
 *  - 抽屉改 → onApply 回写 page state → chips 高亮同步
 *  - chips 改 → page 把最新 filters 通过 initial 传进来 → 打开时 reset 为它
 *
 * 字段全部按后端 /therapists 契约命名映射:
 *  身高区间 height_min/height_max · 价格上限 price_max · 技能多选 skill
 *  国籍 nationality · 语言 language · 在线 online · 最低评分 min_rating(0-10)
 *
 * 设计沿用 FilterBottomSheet 的底部弹出范式(warm/rose token · rounded-3xl · grab handle)。
 */
'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

/** 发现页统一筛选 state · chips 和抽屉都读写它 */
export interface DiscoverFilters {
  online?: boolean;
  /** 最低评分 0-10(9 分天花板=9) */
  minRating?: number;
  heightMin?: number;
  heightMax?: number;
  priceMax?: number;
  /** 技能多选 */
  skills: string[];
  nationality?: string;
  language?: string;
  /** 「附近」开关 · 真 GPS · 由 page 管理坐标 */
  near?: boolean;
}

export const EMPTY_FILTERS: DiscoverFilters = { skills: [] };

const SKILL_OPTIONS = ['泰式', '油压', 'SPA', '中医', '足疗', '指压'] as const;
const NATIONALITY_OPTIONS = ['泰国', '中国', '日本', '韩国', '越南'] as const;
const LANGUAGE_OPTIONS = ['中文', '英文', '泰文'] as const;
const HEIGHT_MIN_OPTIONS = [
  { label: '不限', value: undefined },
  { label: '160+', value: 160 },
  { label: '165+', value: 165 },
  { label: '170+', value: 170 },
  { label: '175+', value: 175 },
] as const;
const HEIGHT_MAX_OPTIONS = [
  { label: '不限', value: undefined },
  { label: '≤165', value: 165 },
  { label: '≤170', value: 170 },
  { label: '≤175', value: 175 },
] as const;
const RATING_OPTIONS = [
  { label: '不限', value: undefined },
  { label: '8 分+', value: 8 },
  { label: '8.5 分+', value: 8.5 },
  { label: '9 分天花板', value: 9 },
] as const;
const PRICE_OPTIONS = [
  { label: '不限', value: undefined },
  { label: '< 3000', value: 3000 },
  { label: '< 5000', value: 5000 },
  { label: '< 8000', value: 8000 },
] as const;

interface Props {
  isOpen: boolean;
  initial: DiscoverFilters;
  onClose: () => void;
  onApply: (state: DiscoverFilters) => void;
}

/** 数一份 filters 里有多少个生效条件(用于「应用(N)」徽标) */
export function countActiveFilters(s: DiscoverFilters): number {
  let n = 0;
  if (s.online) n += 1;
  if (typeof s.minRating === 'number') n += 1;
  if (typeof s.heightMin === 'number') n += 1;
  if (typeof s.heightMax === 'number') n += 1;
  if (typeof s.priceMax === 'number') n += 1;
  if (s.nationality) n += 1;
  if (s.language) n += 1;
  n += s.skills.length;
  if (s.near) n += 1;
  return n;
}

export function FilterDrawer({ isOpen, initial, onClose, onApply }: Props) {
  const [state, setState] = useState<DiscoverFilters>(initial);

  // 打开时把抽屉 state 同步为父级最新 filters(chips 改过也跟着对)
  useEffect(() => {
    if (isOpen) setState(initial);
  }, [isOpen, initial]);

  // 锁 body 滚动
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  function toggleScalar<K extends keyof DiscoverFilters>(key: K, val: DiscoverFilters[K]) {
    setState((s) => ({ ...s, [key]: s[key] === val ? undefined : val }));
  }

  function toggleSkill(skill: string) {
    setState((s) => ({
      ...s,
      skills: s.skills.includes(skill) ? s.skills.filter((x) => x !== skill) : [...s.skills, skill],
    }));
  }

  function reset() {
    // 保留 near(由顶部 GPS chip 单独管理) · 其余清空
    setState((s) => ({ ...EMPTY_FILTERS, near: s.near }));
  }

  function apply() {
    onApply(state);
    onClose();
  }

  const n = countActiveFilters(state);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-label="关闭筛选" />
      <div
        role="dialog"
        aria-modal="true"
        className="absolute inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88%] max-w-[390px] flex-col rounded-t-3xl bg-white shadow-2xl"
      >
        {/* grab handle + 标题 */}
        <div className="shrink-0 bg-white pt-2">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink-200" />
          <div className="flex items-center justify-between border-b border-warm-100 px-4 pb-2.5">
            <h2 className="text-[15px] font-semibold text-ink-800">筛选</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 active:bg-ink-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <Section title="在线状态">
            <ChipBtn active={!!state.online} onClick={() => toggleScalar('online', true)}>
              仅看在线
            </ChipBtn>
          </Section>

          <Section title="最低评分">
            <div className="flex flex-wrap gap-1.5">
              {RATING_OPTIONS.map((r) => (
                <ChipBtn key={r.label} active={state.minRating === r.value} onClick={() => toggleScalar('minRating', r.value)}>
                  {r.label}
                </ChipBtn>
              ))}
            </div>
          </Section>

          <Section title="服务类型(可多选)">
            <div className="flex flex-wrap gap-1.5">
              {SKILL_OPTIONS.map((s) => (
                <ChipBtn key={s} active={state.skills.includes(s)} onClick={() => toggleSkill(s)}>
                  {s}
                </ChipBtn>
              ))}
            </div>
          </Section>

          <Section title="身高下限">
            <div className="flex flex-wrap gap-1.5">
              {HEIGHT_MIN_OPTIONS.map((h) => (
                <ChipBtn key={h.label} active={state.heightMin === h.value} onClick={() => toggleScalar('heightMin', h.value)}>
                  {h.label}
                </ChipBtn>
              ))}
            </div>
          </Section>

          <Section title="身高上限">
            <div className="flex flex-wrap gap-1.5">
              {HEIGHT_MAX_OPTIONS.map((h) => (
                <ChipBtn key={h.label} active={state.heightMax === h.value} onClick={() => toggleScalar('heightMax', h.value)}>
                  {h.label}
                </ChipBtn>
              ))}
            </div>
          </Section>

          <Section title="价格上限(pts · 任一档命中)">
            <div className="flex flex-wrap gap-1.5">
              {PRICE_OPTIONS.map((p) => (
                <ChipBtn key={p.label} active={state.priceMax === p.value} onClick={() => toggleScalar('priceMax', p.value)}>
                  {p.label}
                </ChipBtn>
              ))}
            </div>
          </Section>

          <Section title="国籍">
            <div className="flex flex-wrap gap-1.5">
              {NATIONALITY_OPTIONS.map((nat) => (
                <ChipBtn key={nat} active={state.nationality === nat} onClick={() => toggleScalar('nationality', nat)}>
                  {nat}
                </ChipBtn>
              ))}
            </div>
          </Section>

          <Section title="沟通语言">
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGE_OPTIONS.map((l) => (
                <ChipBtn key={l} active={state.language === l} onClick={() => toggleScalar('language', l)}>
                  {l}
                </ChipBtn>
              ))}
            </div>
          </Section>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-warm-100 bg-white px-4 py-3">
          <button
            type="button"
            onClick={reset}
            disabled={n === 0}
            className="flex-1 rounded-2xl border border-warm-100 py-2.5 text-[13px] font-medium text-ink-700 active:bg-ink-50 disabled:opacity-40"
          >
            重置
          </button>
          <button
            type="button"
            onClick={apply}
            className="flex-[2] rounded-2xl bg-gradient-cta py-2.5 text-[13px] font-semibold text-white shadow-rose-md active:scale-95"
          >
            应用{n > 0 ? `(${n})` : ''}
          </button>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[12px] font-medium text-ink-600">{title}</h3>
      {children}
    </div>
  );
}

function ChipBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-[12px] transition active:scale-95 ${
        active
          ? 'bg-gradient-cta font-semibold text-white shadow-rose-md'
          : 'border border-warm-100 bg-white text-ink-700 active:bg-warm-50'
      }`}
    >
      {children}
    </button>
  );
}
