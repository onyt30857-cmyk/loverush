/**
 * 客户档案弹层(技师视角)
 *
 * 功能:
 *   - 可编辑:昵称、备注、标签
 *   - 只读展示:分身已收集的会话摘要(interactionMemory.summary)
 *   - 保存调 PUT /therapists/me/customers/:customerId/notes
 *   - 乐观更新 + loading/成功/失败态(UX 铁律)
 */
'use client';

import { useEffect, useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { apiGet, apiPut, ApiClientError } from '@/lib/api';

interface NotesData {
  privateNotes: string | null;
  customerNickname: string | null;
  privateTags: string[];
  aiSummary: string | null;
}

interface CustomerNotesSheetProps {
  isOpen: boolean;
  customerId: string;
  onClose: () => void;
}

export function CustomerNotesSheet({ isOpen, customerId, onClose }: CustomerNotesSheetProps) {
  const [data, setData] = useState<NotesData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 编辑中的表单值
  const [nickname, setNickname] = useState('');
  const [notes, setNotes] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  // 保存状态
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // 打开时拉数据
  useEffect(() => {
    if (!isOpen || !customerId) return;
    setData(null);
    setLoadError(null);
    setSaveError(null);
    setSaveOk(false);
    void (async () => {
      try {
        const res = await apiGet<NotesData>(`/therapists/me/customers/${customerId}/notes`);
        setData(res);
        setNickname(res.customerNickname ?? '');
        setNotes(res.privateNotes ?? '');
        setTagsInput((res.privateTags ?? []).join('、'));
      } catch (err) {
        setLoadError(err instanceof ApiClientError ? err.payload.message : '加载失败');
      }
    })();
  }, [isOpen, customerId]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    const tags = tagsInput
      .split(/[,，、\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10);
    try {
      const res = await apiPut<NotesData>(`/therapists/me/customers/${customerId}/notes`, {
        customer_nickname: nickname.trim() || null,
        private_notes: notes.trim() || null,
        private_tags: tags,
      });
      setData((prev) => (prev ? { ...prev, ...res } : res));
      setSaveOk(true);
      // 1.5s 后自动清除成功提示
      setTimeout(() => setSaveOk(false), 1500);
    } catch (err) {
      setSaveError(err instanceof ApiClientError ? err.payload.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 z-30 bg-black/30" onClick={onClose} />
      {/* 弹层 */}
      <div className="fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 rounded-t-2xl bg-white shadow-warm-lg">
        {/* 把手 */}
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-ink-200" />

        {/* 头部 */}
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-[15px] font-semibold text-ink-900">客户档案</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-400 active:bg-ink-100"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="max-h-[70vh] overflow-y-auto px-5 pb-6">
          {loadError ? (
            <div className="py-8 text-center text-[13px] text-red-500">{loadError}</div>
          ) : !data ? (
            <div className="flex items-center justify-center py-10 gap-2 text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-[13px]">加载中…</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 昵称 */}
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-ink-600">
                  昵称 <span className="font-normal text-ink-400">(仅你可见，不超过 40 字)</span>
                </label>
                <input
                  type="text"
                  value={nickname}
                  maxLength={40}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="给 TA 起个私密昵称…"
                  className="w-full rounded-xl border border-warm-200 bg-warm-50 px-3.5 py-2.5 text-[13.5px] text-ink-800 outline-none placeholder:text-ink-300 focus:border-warm-400 focus:bg-white transition"
                />
              </div>

              {/* 备注 */}
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-ink-600">
                  备注 <span className="font-normal text-ink-400">(偏好、禁忌、提醒等，不超过 500 字)</span>
                </label>
                <textarea
                  value={notes}
                  maxLength={500}
                  rows={4}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="记录客户偏好、注意事项…"
                  className="w-full resize-none rounded-xl border border-warm-200 bg-warm-50 px-3.5 py-2.5 text-[13.5px] text-ink-800 outline-none placeholder:text-ink-300 focus:border-warm-400 focus:bg-white transition"
                />
                <div className="mt-0.5 text-right text-[11px] text-ink-300">{notes.length}/500</div>
              </div>

              {/* 标签 */}
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-ink-600">
                  标签 <span className="font-normal text-ink-400">(逗号或空格分隔，最多 10 个)</span>
                </label>
                <input
                  type="text"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="例:爱聊天、回头客、按摩偏重手法…"
                  className="w-full rounded-xl border border-warm-200 bg-warm-50 px-3.5 py-2.5 text-[13.5px] text-ink-800 outline-none placeholder:text-ink-300 focus:border-warm-400 focus:bg-white transition"
                />
              </div>

              {/* 分身收集的会话摘要(只读) */}
              {data.aiSummary ? (
                <div className="rounded-xl border border-warm-100 bg-warm-50/60 px-3.5 py-3">
                  <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-warm-500">
                    分身记录
                  </div>
                  <div className="text-[12.5px] leading-relaxed text-ink-600">{data.aiSummary}</div>
                </div>
              ) : null}

              {/* 错误 / 成功提示 */}
              {saveError && (
                <div className="rounded-xl bg-red-50 px-3.5 py-2.5 text-[12.5px] text-red-600">{saveError}</div>
              )}
              {saveOk && (
                <div className="rounded-xl bg-green-50 px-3.5 py-2.5 text-[12.5px] text-green-700">已保存</div>
              )}

              {/* 保存按钮 */}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-cta py-3 text-[14px] font-semibold text-white shadow-rose-md disabled:opacity-60 active:scale-[0.98] transition"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
