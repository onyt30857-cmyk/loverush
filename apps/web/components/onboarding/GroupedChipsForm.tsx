/**
 * 多组 chips 多选表单 · 0522 文档 step 4-7 用
 *
 * 把 visible_options(含 group 字段)按 group 拆成多个 section,
 * 每个 section 渲染:小标题 + 横向 chips。
 *
 * payload:每个 group → 已选 values[](所有 group 都必须有选)
 */
'use client';

import { useMemo, useState } from 'react';
import type { OnboardingOption } from './types';

interface Props {
  options: OnboardingOption[];
  submitting: boolean;
  /** 分组维度标签映射 · 默认按 group 名展示 */
  groupLabels?: Record<string, string>;
  /** 各组是否单选(默认全多选) */
  groupSingle?: Record<string, boolean>;
  onSubmit: (payload: Record<string, string | string[]>) => void;
}

function vibrate() {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(10);
    }
  } catch {
    // ignore
  }
}

const DEFAULT_LABELS: Record<string, string> = {
  age_pref: '年龄段',
  height_pref: '身高',
  body_type: '体型',
  bust_pref: '胸围',
  service_style: '服务风格',
  service_strength: '服务力度',
  nationality_pref: '国籍',
  language: '语言',
  service_area: '距离',
  price_range: '价位',
  privacy_mode: '隐私',
  tip_band: '小费',
  time_slot: '时段',
  primary_focus: '最在意',
};

/** 单选维度(默认值之外) */
const DEFAULT_SINGLE: Record<string, boolean> = {
  language: true,
  price_range: true,
  privacy_mode: true,
  tip_band: true,
  time_slot: true,
};

export function GroupedChipsForm({
  options,
  submitting,
  groupLabels,
  groupSingle,
  onSubmit,
}: Props) {
  const labels = { ...DEFAULT_LABELS, ...(groupLabels ?? {}) };
  const singles = { ...DEFAULT_SINGLE, ...(groupSingle ?? {}) };

  // 按 group 拆 options
  const groups = useMemo(() => {
    const map = new Map<string, OnboardingOption[]>();
    for (const o of options) {
      const g = o.group ?? '_default';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(o);
    }
    return Array.from(map.entries());
  }, [options]);

  // 各组已选
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  function toggle(group: string, value: string) {
    vibrate();
    setSelected((cur) => {
      const arr = cur[group] ?? [];
      const isSingle = singles[group] === true;
      if (isSingle) {
        return { ...cur, [group]: [value] };
      }
      if (arr.includes(value)) {
        return { ...cur, [group]: arr.filter((x) => x !== value) };
      }
      return { ...cur, [group]: [...arr, value] };
    });
  }

  function handleSubmit() {
    const payload: Record<string, string | string[]> = {};
    for (const [g] of groups) {
      const arr = selected[g] ?? [];
      if (arr.length === 0) continue;
      if (singles[g] === true) {
        const first = arr[0];
        if (first !== undefined) payload[g] = first;
      } else {
        payload[g] = arr;
      }
    }
    onSubmit(payload);
  }

  // 至少有一组选了才能提交
  const canSubmit = Object.values(selected).some((arr) => arr.length > 0);

  return (
    <div className="space-y-4">
      {groups.map(([group, opts]) => {
        const arr = selected[group] ?? [];
        const label = labels[group] ?? group;
        return (
          <section key={group} className="space-y-1.5">
            <div className="px-1 text-[11px] font-medium text-ink-500">{label}</div>
            <div className="flex flex-wrap gap-1.5">
              {opts.map((o) => {
                const on = arr.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    disabled={submitting}
                    onClick={() => toggle(group, o.value)}
                    aria-pressed={on}
                    className={`rounded-full border px-3 py-1.5 text-[12px] transition active:scale-95 ${
                      on
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-warm-100 bg-white text-ink-600 hover:border-warm-300'
                    } disabled:opacity-50`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <button
        type="button"
        disabled={submitting || !canSubmit}
        onClick={handleSubmit}
        className="w-full rounded-full bg-gradient-cta py-3 text-[14px] font-semibold text-white shadow-rose-md transition active:scale-[0.98] disabled:opacity-40"
      >
        下一步
      </button>
    </div>
  );
}
