/**
 * 首页 / 全局通用筛选 BottomSheet · M02 Phase 5
 *
 * 触发:home 页"筛选"FAB / 部分 chip 点击
 * 字段:服务类型(skill) / 语言(language) / 身高下限(slider) / 评分下限(slider) / 价格上限(input)
 * 提交:onApply 回调拿到 FilterState · 父组件负责拼 query 跳 /search/results
 *
 * 设计:
 *  - 移动 H5 优先 · 底部弹出 · max-h 80vh
 *  - overlay 点击 / 顶部"取消"关闭
 *  - 底部"重置"清空 · "确认"应用
 *  - 多选用 .chip / .chip.active 已有样式
 */
'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export interface FilterState {
  skill?: string;
  language?: string;
  heightMin?: number;
  scoreMin?: number;
  priceMax?: number;
}

const SKILL_OPTIONS = ['泰式', '油压', 'SPA', '中医', '足疗', '指压'] as const;
const LANGUAGE_OPTIONS = ['中文', '英文', '泰文'] as const;
const HEIGHT_OPTIONS = [
  { label: '不限', value: undefined },
  { label: '160cm+', value: 160 },
  { label: '165cm+', value: 165 },
  { label: '170cm+', value: 170 },
  { label: '175cm+', value: 175 },
] as const;
const SCORE_OPTIONS = [
  { label: '不限', value: undefined },
  { label: '4.0★+', value: 40 },
  { label: '4.5★+', value: 45 },
  { label: '9 分天花板', value: 90 },
] as const;
const PRICE_OPTIONS = [
  { label: '不限', value: undefined },
  { label: '< ฿500', value: 500 },
  { label: '< ฿1000', value: 1000 },
  { label: '< ฿2000', value: 2000 },
] as const;

interface Props {
  isOpen: boolean;
  initial?: FilterState;
  onClose: () => void;
  onApply: (state: FilterState) => void;
}

export function FilterBottomSheet({ isOpen, initial, onClose, onApply }: Props) {
  const [state, setState] = useState<FilterState>(initial ?? {});

  // 打开时 reset state 为 initial
  useEffect(() => {
    if (isOpen) setState(initial ?? {});
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

  function toggle<K extends keyof FilterState>(key: K, val: FilterState[K]) {
    setState((s) => ({ ...s, [key]: s[key] === val ? undefined : val }));
  }

  function reset() {
    setState({});
  }

  function apply() {
    onApply(state);
    onClose();
  }

  const hasAny = Object.values(state).some((v) => v !== undefined);

  return (
    <>
      {/* overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-label="关闭筛选"
      />
      {/* sheet */}
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white shadow-2xl"
      >
        {/* 顶部 grab handle */}
        <div className="sticky top-0 z-10 bg-white pt-2">
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

        <div className="space-y-4 px-4 py-4">
          {/* 服务类型 */}
          <Section title="服务类型">
            <div className="flex flex-wrap gap-1.5">
              {SKILL_OPTIONS.map((s) => (
                <ChipBtn key={s} active={state.skill === s} onClick={() => toggle('skill', s)}>
                  {s}
                </ChipBtn>
              ))}
            </div>
          </Section>

          {/* 语言 */}
          <Section title="沟通语言">
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGE_OPTIONS.map((l) => (
                <ChipBtn key={l} active={state.language === l} onClick={() => toggle('language', l)}>
                  {l}
                </ChipBtn>
              ))}
            </div>
          </Section>

          {/* 身高下限 */}
          <Section title="身高">
            <div className="flex flex-wrap gap-1.5">
              {HEIGHT_OPTIONS.map((h) => (
                <ChipBtn
                  key={h.label}
                  active={state.heightMin === h.value}
                  onClick={() => toggle('heightMin', h.value)}
                >
                  {h.label}
                </ChipBtn>
              ))}
            </div>
          </Section>

          {/* 评分下限 */}
          <Section title="评分">
            <div className="flex flex-wrap gap-1.5">
              {SCORE_OPTIONS.map((s) => (
                <ChipBtn
                  key={s.label}
                  active={state.scoreMin === s.value}
                  onClick={() => toggle('scoreMin', s.value)}
                >
                  {s.label}
                </ChipBtn>
              ))}
            </div>
          </Section>

          {/* 价格上限 */}
          <Section title="价格上限 (任一档命中即显)">
            <div className="flex flex-wrap gap-1.5">
              {PRICE_OPTIONS.map((p) => (
                <ChipBtn
                  key={p.label}
                  active={state.priceMax === p.value}
                  onClick={() => toggle('priceMax', p.value)}
                >
                  {p.label}
                </ChipBtn>
              ))}
            </div>
          </Section>
        </div>

        {/* 底部 cta */}
        <div className="sticky bottom-0 flex gap-2 border-t border-warm-100 bg-white px-4 py-3">
          <button
            type="button"
            onClick={reset}
            disabled={!hasAny}
            className="flex-1 rounded-2xl border border-warm-100 py-2.5 text-[13px] font-medium text-ink-700 active:bg-ink-50 disabled:opacity-40"
          >
            重置
          </button>
          <button
            type="button"
            onClick={apply}
            className="flex-[2] rounded-2xl bg-gradient-cta py-2.5 text-[13px] font-semibold text-white shadow-rose-md active:scale-95"
          >
            应用筛选
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
      className={`rounded-full px-3 py-1.5 text-[12px] transition ${
        active
          ? 'bg-gradient-cta font-semibold text-white shadow-rose-md'
          : 'border border-warm-100 bg-white text-ink-700 active:bg-warm-50'
      }`}
    >
      {children}
    </button>
  );
}

/** 把 FilterState 转成 /search/results 的 query string · 工具函数 */
export function filterStateToQuery(state: FilterState): URLSearchParams {
  const q = new URLSearchParams();
  if (state.skill) q.set('skill', state.skill);
  if (state.language) q.set('language', state.language);
  if (typeof state.heightMin === 'number') q.set('height_min', String(state.heightMin));
  if (typeof state.scoreMin === 'number') q.set('score_min', String(state.scoreMin));
  if (typeof state.priceMax === 'number') q.set('price_max', String(state.priceMax));
  return q;
}
