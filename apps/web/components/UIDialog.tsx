/**
 * 统一 Dialog · alert/confirm/prompt 三态
 *
 * 替换 window.alert/confirm/prompt 难看的 native UI · 跟暖橙粉品牌一致
 * 用法:
 *   const { confirm, prompt, alert } = useDialog();
 *   const ok = await confirm({ title: '确定删除?', message: '不可撤回', danger: true });
 *   const text = await prompt({ title: '举报原因', placeholder: '骚扰/欺诈/...' });
 *   await alert({ title: '已提交', message: '24h 内处理' });
 *
 * 中心 modal 风格 · 跟 LocaleSheet/ServiceTierSheet 视觉同源
 * 用 Promise 异步 · 调用方 await 即可
 */
'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface AlertOpts {
  title?: string;
  message?: string;
  confirmText?: string;
}

interface ConfirmOpts {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface PromptOpts {
  title?: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  minLength?: number;
  multiline?: boolean;
}

interface DialogContextValue {
  alert: (opts: AlertOpts) => Promise<void>;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    // 容错:如果忘了套 Provider,退回原生(不至于崩)
    return {
      alert: async (o) => { window.alert(o.message ?? o.title ?? ''); },
      confirm: async (o) => window.confirm(`${o.title ?? ''}\n${o.message ?? ''}`.trim()),
      prompt: async (o) => window.prompt(`${o.title ?? ''}\n${o.message ?? ''}`.trim(), o.defaultValue),
    };
  }
  return ctx;
}

type DialogState =
  | ({ kind: 'alert' } & AlertOpts & { resolve: (v: void) => void })
  | ({ kind: 'confirm' } & ConfirmOpts & { resolve: (v: boolean) => void })
  | ({ kind: 'prompt' } & PromptOpts & { resolve: (v: string | null) => void });

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);
  const [inputValue, setInputValue] = useState('');

  const alert = useCallback(
    (opts: AlertOpts) =>
      new Promise<void>((resolve) => {
        setState({ kind: 'alert', ...opts, resolve });
      }),
    [],
  );

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        setState({ kind: 'confirm', ...opts, resolve });
      }),
    [],
  );

  const prompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        setInputValue(opts.defaultValue ?? '');
        setState({ kind: 'prompt', ...opts, resolve });
      }),
    [],
  );

  function close(result: unknown) {
    if (!state) return;
    (state.resolve as (v: unknown) => void)(result);
    setState(null);
    setInputValue('');
  }

  function handleConfirm() {
    if (!state) return;
    if (state.kind === 'prompt') {
      const trimmed = inputValue.trim();
      if (state.minLength && trimmed.length < state.minLength) return; // 不关 · 等用户补
      close(trimmed.length > 0 ? trimmed : null);
    } else if (state.kind === 'confirm') {
      close(true);
    } else {
      close(undefined);
    }
  }

  function handleCancel() {
    if (!state) return;
    if (state.kind === 'confirm') close(false);
    else if (state.kind === 'prompt') close(null);
    else close(undefined);
  }

  return (
    <DialogContext.Provider value={{ alert, confirm, prompt }}>
      {children}

      {state && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-6 backdrop-blur-[2px] fade-in"
          onClick={(e) => {
            // 点黑背景 · 当作取消(alert 直接关 · confirm/prompt 取消)
            if (e.target === e.currentTarget) handleCancel();
          }}
        >
          <div
            className="w-full max-w-[320px] overflow-hidden rounded-3xl bg-white shadow-warm-xl fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 · 标题 + 消息 */}
            <div className="px-5 pt-5 pb-1">
              {state.title && (
                <div className="text-serif-cn text-[16px] font-semibold leading-snug text-ink-800">
                  {state.title}
                </div>
              )}
              {state.message && (
                <div className={`text-[13px] leading-[1.6] text-ink-600 ${state.title ? 'mt-2' : ''}`}>
                  {state.message}
                </div>
              )}
            </div>

            {/* prompt 输入 */}
            {state.kind === 'prompt' && (
              <div className="px-5 pt-3 pb-1">
                {state.multiline ? (
                  <textarea
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={state.placeholder}
                    rows={3}
                    autoFocus
                    className="w-full rounded-xl border border-warm-200 bg-warm-50/40 px-3 py-2.5 text-[13px] leading-relaxed text-ink-800 placeholder:text-ink-400 focus:border-primary focus:bg-white focus:outline-none"
                  />
                ) : (
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleConfirm();
                      } else if (e.key === 'Escape') {
                        handleCancel();
                      }
                    }}
                    placeholder={state.placeholder}
                    autoFocus
                    className="w-full rounded-xl border border-warm-200 bg-warm-50/40 px-3 py-2.5 text-[13px] text-ink-800 placeholder:text-ink-400 focus:border-primary focus:bg-white focus:outline-none"
                  />
                )}
                {state.minLength && inputValue.trim().length > 0 && inputValue.trim().length < state.minLength && (
                  <div className="mt-1.5 text-[11px] text-warm-700">至少 {state.minLength} 个字符</div>
                )}
              </div>
            )}

            {/* 底部按钮 · 取消/确定 */}
            <div className="mt-4 flex border-t border-warm-100">
              {state.kind !== 'alert' && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex-1 border-r border-warm-100 py-3.5 text-[14px] font-medium text-ink-600 transition active:bg-warm-50"
                >
                  {(state.kind === 'confirm' ? state.cancelText : state.kind === 'prompt' ? state.cancelText : null) ?? '取消'}
                </button>
              )}
              <button
                type="button"
                onClick={handleConfirm}
                disabled={state.kind === 'prompt' && state.minLength != null && inputValue.trim().length < state.minLength}
                className={`flex-1 py-3.5 text-[14px] font-semibold transition active:bg-warm-50 disabled:opacity-40 disabled:active:bg-transparent ${
                  state.kind === 'confirm' && state.danger
                    ? 'text-danger-500'
                    : 'text-primary'
                }`}
              >
                {(state.kind === 'confirm' || state.kind === 'prompt' || state.kind === 'alert' ? state.confirmText : null) ?? '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
