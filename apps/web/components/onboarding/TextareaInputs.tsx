/**
 * 多 textarea 表单 · 0522 文档 step 8-9 用
 *
 * 把 visible_textareas 列表渲染成多个 textarea + 一个提交按钮。
 * payload 字段名 = textarea.name(后端 onboarding.ts mergePayloadIntoFacts 读取)
 */
'use client';

import { useState } from 'react';
import type { OnboardingTextarea } from './types';

interface Props {
  textareas: OnboardingTextarea[];
  submitting: boolean;
  ctaLabel?: string;
  onSubmit: (payload: Record<string, string>) => void;
  onSkip?: () => void;
}

export function TextareaInputs({ textareas, submitting, ctaLabel, onSubmit, onSkip }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});

  function set(name: string, v: string) {
    setValues((cur) => ({ ...cur, [name]: v }));
  }

  function handleSubmit() {
    const payload: Record<string, string> = {};
    for (const t of textareas) {
      const v = (values[t.name] ?? '').trim();
      if (v) payload[t.name] = v;
    }
    onSubmit(payload);
  }

  // 全空也可"跳过"(走 skip 路径) · 任意一个填了才显示"提交"为高亮
  const anyFilled = Object.values(values).some((v) => (v ?? '').trim().length > 0);

  return (
    <div className="space-y-3">
      {textareas.map((t) => (
        <div key={t.name} className="space-y-1.5">
          <label className="px-1 text-[11px] font-medium text-ink-500" htmlFor={`ta-${t.name}`}>
            {t.label}
          </label>
          <textarea
            id={`ta-${t.name}`}
            value={values[t.name] ?? ''}
            onChange={(e) => set(t.name, e.target.value)}
            placeholder={t.placeholder}
            maxLength={t.maxLength}
            rows={3}
            disabled={submitting}
            className="w-full resize-none rounded-xl border border-warm-100 bg-white px-3 py-2.5 text-[13px] outline-none transition focus:border-primary disabled:opacity-50"
          />
          {t.maxLength ? (
            <div className="px-1 text-right text-[10px] text-ink-400">
              {(values[t.name] ?? '').length} / {t.maxLength}
            </div>
          ) : null}
        </div>
      ))}

      <div className="flex gap-2">
        {onSkip ? (
          <button
            type="button"
            disabled={submitting}
            onClick={onSkip}
            className="flex-1 rounded-full border border-warm-200 bg-white py-3 text-[13px] font-medium text-ink-600 transition active:scale-[0.98] disabled:opacity-40"
          >
            跳过
          </button>
        ) : null}
        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className={`rounded-full py-3 text-[14px] font-semibold text-white shadow-rose-md transition active:scale-[0.98] disabled:opacity-40 ${
            onSkip ? 'flex-[2]' : 'w-full'
          } ${anyFilled ? 'bg-gradient-cta' : 'bg-ink-300'}`}
        >
          {ctaLabel ?? '下一步'}
        </button>
      </div>
    </div>
  );
}
