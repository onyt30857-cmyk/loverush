/**
 * 翻译目标语言选择 BottomSheet
 *
 * 用户在对话页选目标翻译语言(或关闭)
 * 后端 /translate 支持:zh / en / th / vi / ms / id
 * 'off' = 不翻译
 *
 * 设计对齐 FilterBottomSheet · 复用 .chip / btn-primary 样式
 */
'use client';

import { useEffect } from 'react';
import { X, Globe, Check } from 'lucide-react';

export type TranslateLang = 'off' | 'zh' | 'en' | 'th' | 'vi' | 'ms' | 'id';

export const TRANSLATE_LANG_LABEL: Record<TranslateLang, string> = {
  off: '不翻译',
  zh: '中文',
  en: 'English',
  th: 'ภาษาไทย',
  vi: 'Tiếng Việt',
  ms: 'Bahasa Melayu',
  id: 'Bahasa Indonesia',
};

const ORDER: TranslateLang[] = ['off', 'zh', 'en', 'th', 'vi', 'ms', 'id'];

interface Props {
  isOpen: boolean;
  current: TranslateLang;
  onClose: () => void;
  onSelect: (lang: TranslateLang) => void;
}

export function TranslateLangSheet({ isOpen, current, onClose, onSelect }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 animate-fade-in"
        onClick={onClose}
        aria-label="关闭语言选择"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="选择翻译语言"
        className="absolute inset-x-0 bottom-0 z-50 max-h-[85%] overflow-hidden rounded-t-3xl bg-white shadow-2xl animate-slide-up"
      >
        {/* 顶部 grab handle + 标题 */}
        <div className="sticky top-0 z-10 bg-white pt-2">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink-200" />
          <div className="flex items-start justify-between border-b border-warm-100 px-5 pb-3">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              <div>
                <h2 className="font-serif-cn text-[15px] font-semibold text-ink-900">翻译语言</h2>
                <div className="text-[10.5px] text-ink-400 mt-0.5">
                  对方消息会自动译成你选的语言
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="-mr-2 -mt-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-400 hover:bg-ink-50 active:bg-ink-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 语言列表 */}
        <div className="max-h-[60vh] overflow-y-auto px-4 pt-3 pb-5">
          <div className="space-y-1.5">
            {ORDER.map((lang) => {
              const isCurrent = lang === current;
              const isOff = lang === 'off';
              return (
                <button
                  key={lang}
                  type="button"
                  onClick={() => {
                    onSelect(lang);
                    onClose();
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition active:scale-[0.99] ${
                    isCurrent
                      ? 'border-primary bg-primary/5'
                      : 'border-warm-100 bg-white hover:border-warm-200'
                  } ${isOff ? '' : ''}`}
                >
                  <div className="flex-1">
                    <div
                      className={`text-[14px] font-medium ${
                        isCurrent ? 'text-primary' : 'text-ink-900'
                      } ${isOff ? 'italic text-ink-500' : ''}`}
                    >
                      {TRANSLATE_LANG_LABEL[lang]}
                    </div>
                    {!isOff ? (
                      <div className="mt-0.5 text-[10.5px] uppercase tracking-wider text-ink-400">
                        {lang}
                      </div>
                    ) : null}
                  </div>
                  {isCurrent ? <Check className="h-4 w-4 text-primary" /> : null}
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-xl bg-warm-50/60 px-3 py-2.5 text-[10.5px] leading-relaxed text-ink-500">
            选了语言之后,对方发来的不同语言消息会自动译成此语言显示在原文下方。
            你发出去的不翻译 · 对方那边也会按 ta 选的语言收到译文。
          </div>
        </div>
      </div>
    </>
  );
}
