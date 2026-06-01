/**
 * 语音助理 BottomSheet · M03 v5 (2026-06-02)
 *
 * 替代 v3/v4 整个 /assistant 路由体系 · 单一交互:中央按钮 → 弹此 sheet → 按住麦克风说话
 *
 * 设计原则 (Tony [[loverush_m03_audit_2026_06_01]] + v5 spec):
 *  - 纯语音 · 无打字 fallback (公共场所没法用 = 用不了 · 简化心智)
 *  - 推荐卡 sheet 内浮显不跳页
 *  - 跨会话历史保留 (重启 customer_assistant_sessions · 之前 v4 deprecated 的)
 *  - Gemini 2.5 Flash 多模态 (audio in → text + 推荐 一次 round-trip)
 *
 * C1 (本 commit) · 空壳 UI 框架 · 不录音 · 不连后端 · 占位
 * C2 · 后端 voice endpoint + Gemini multimodal
 * C3 · 录音 hook + 上传 + 气泡显示 + 推荐卡浮显
 */
'use client';

import { useEffect } from 'react';
import { Mic, Sparkles, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function VoiceAssistantSheet({ isOpen, onClose }: Props) {
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
      {/* 半透明遮罩 · 点击关闭 */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      {/* sheet 主体 · 从下滑入 · 全屏覆盖 */}
      <div
        role="dialog"
        aria-modal="true"
        className="absolute inset-x-0 bottom-0 z-50 flex max-h-[90vh] min-h-[60vh] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-12px_40px_rgba(0,0,0,0.18)]"
      >
        {/* sticky 顶部 · 拖把 + 标题 + 关闭 */}
        <div className="shrink-0 bg-white">
          <div className="mx-auto mt-2.5 h-1 w-12 rounded-full bg-ink-200" />
          <div className="flex items-center justify-between px-5 pt-3 pb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-cta shadow-rose-md">
                <Sparkles className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
              </div>
              <span className="font-serif-cn text-[16px] font-semibold tracking-tight text-ink-900">
                小助理
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-500 active:bg-ink-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 对话流主体 · 可滚 (C3 接入历史) */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-cta shadow-rose-md">
              <Sparkles className="h-7 w-7 text-white" strokeWidth={2.2} />
            </div>
            <h3 className="mt-4 font-serif-cn text-[18px] font-semibold text-ink-900">
              按住下面说话
            </h3>
            <p className="mt-1.5 max-w-[280px] text-[12.5px] leading-relaxed text-ink-500">
              告诉我你想要什么样的技师 · 我帮你挑出 3 个
              <br />
              <span className="text-ink-400">支持中文 · English · ภาษาไทย · Tiếng Việt</span>
            </p>
          </div>
        </div>

        {/* 底部 · 大圆麦克风按钮 (C3 接 MediaRecorder) */}
        <div className="shrink-0 border-t border-warm-100 bg-white px-5 pb-8 pt-5">
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              disabled
              className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-cta shadow-rose-lg transition active:scale-95 disabled:opacity-50"
              aria-label="按住说话"
            >
              <Mic className="h-9 w-9 text-white" strokeWidth={2.3} />
            </button>
            <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">
              按住说话 · 即将上线
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
