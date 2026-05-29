/**
 * 语言切换 BottomSheet · M07 Phase 0
 *
 * 6 语种(zh/en/th/vi/ms/id) · 单选 · 选中即触发 onSelect + 关闭
 * absolute 贴 .mobile-container 内部底部 · 与 FilterBottomSheet 同款 H5 风格
 *
 * 本期只做"持久化 locale 偏好":
 * - 调 PATCH /me/locale
 * - 更新 AuthContext user.locale
 * - 写 localStorage(下次进站不丢)
 *
 * 文案全量翻译留 M07 主 PRD · 这里只解锁能力
 */
'use client';

import { useEffect } from 'react';
import { Check, X } from 'lucide-react';

export type LocaleCode = 'zh' | 'en' | 'th' | 'vi' | 'ms' | 'id';

interface LocaleOption {
  code: LocaleCode;
  flag: string;
  cn: string;
  native: string;
}

const LOCALE_OPTIONS: LocaleOption[] = [
  { code: 'zh', flag: '🇨🇳', cn: '中文', native: '中文' },
  { code: 'en', flag: '🇬🇧', cn: '英文', native: 'English' },
  { code: 'th', flag: '🇹🇭', cn: '泰文', native: 'ภาษาไทย' },
  { code: 'vi', flag: '🇻🇳', cn: '越南文', native: 'Tiếng Việt' },
  { code: 'ms', flag: '🇲🇾', cn: '马来文', native: 'Bahasa Melayu' },
  { code: 'id', flag: '🇮🇩', cn: '印尼文', native: 'Bahasa Indonesia' },
];

interface Props {
  isOpen: boolean;
  current?: LocaleCode | null;
  onClose: () => void;
  onSelect: (locale: LocaleCode) => void;
}

export function LocaleSheet({ isOpen, current, onClose, onSelect }: Props) {
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

  return (
    <>
      {/* overlay · 全屏盖 · 点击外关闭 */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-label="关闭"
      />
      {/* sheet · absolute 贴 .mobile-container 底 */}
      <div
        role="dialog"
        aria-modal="true"
        className="absolute inset-x-0 bottom-0 z-50 max-h-[85%] overflow-y-auto rounded-t-3xl bg-white shadow-2xl"
      >
        <div className="sticky top-0 z-10 bg-white pt-2">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink-200" />
          <div className="flex items-center justify-between border-b border-warm-100 px-4 pb-2.5">
            <h2 className="text-[15px] font-semibold text-ink-800">语言 / Language</h2>
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

        <ul className="px-2 py-2">
          {LOCALE_OPTIONS.map((opt) => {
            const active = opt.code === current;
            return (
              <li key={opt.code}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(opt.code);
                    onClose();
                  }}
                  className={`flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition active:bg-warm-50 ${
                    active ? 'bg-warm-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{opt.flag}</span>
                    <div>
                      <div className="text-[14px] font-medium text-ink-800">{opt.native}</div>
                      <div className="text-[11.5px] text-ink-500">{opt.cn}</div>
                    </div>
                  </div>
                  {active && <Check className="h-4 w-4 text-primary" />}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="px-5 pb-4 pt-1 text-[11px] leading-5 text-ink-400">
          注：当前仅保存偏好 · 全站文案翻译将在 M07 阶段陆续上线
        </p>
      </div>
    </>
  );
}
