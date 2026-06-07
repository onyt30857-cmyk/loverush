'use client';

/**
 * 技师端「我的评价」· 看客户给我的真实评价 + 对差评申诉
 *
 * 数据:GET /reviews/me(收到的非隐藏评价 + 申诉状态)
 * 动作:无 pending 申诉的评价可「申诉」→ POST /reviews/:id/appeal
 */

import { useCallback, useEffect, useState } from 'react';
import { TherapistShell } from '@/components/AppShell';
import { LoadingFull } from '@/components/ui';
import { Star } from 'lucide-react';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';
import { fmtScore1000 } from '@/lib/score';

interface ReceivedReview {
  id: string;
  customerDisplayName: string | null;
  scoreOverall: number; // 0-100
  scoreService: number;
  scoreAttitude: number | null;
  scoreAuthenticity: number | null;
  scorePunctuality: number | null;
  content: string | null;
  tags: string[] | null;
  appealStatus: string | null;
  createdAt: string;
}

const DIMS: Array<{ key: keyof ReceivedReview; label: string }> = [
  { key: 'scoreService', label: '服务' },
  { key: 'scoreAttitude', label: '态度' },
  { key: 'scoreAuthenticity', label: '真人符合度' },
  { key: 'scorePunctuality', label: '守时' },
];

const APPEAL_LABEL: Record<string, string> = {
  pending: '申诉待裁决',
  resolved: '申诉已支持',
  rejected: '申诉被驳回',
};

export default function TherapistReviewsPage() {
  const [list, setList] = useState<ReceivedReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appealing, setAppealing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await apiGet<ReceivedReview[]>('/reviews/me');
      setList(rows);
      setError(null);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      setList([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitAppeal() {
    if (!appealing || !reason.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/reviews/${appealing}/appeal`, { reason: reason.trim() });
      setAppealing(null);
      setReason('');
      setToast('申诉已提交 · 等运营裁决');
      setTimeout(() => setToast(null), 4000);
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setBusy(false);
    }
  }

  if (list === null) return <LoadingFull />;

  return (
    <TherapistShell>
      <div className="px-4 py-5">
        <h1 className="text-lg font-semibold text-ink-900">我的评价</h1>
        <p className="mt-0.5 text-[12px] text-ink-500">客户的真实评价 · 对不实差评可申诉</p>

        {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</div>}

        {list.length === 0 ? (
          <div className="mt-10 text-center text-[13px] text-ink-400">还没有评价 · 完成服务后客户会来评价</div>
        ) : (
          <div className="mt-4 space-y-3">
            {list.map((r) => (
              <div key={r.id} className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-sm">
                <div className="flex items-center justify-between">
                  <div className="text-[12px] font-medium text-ink-700">
                    {r.customerDisplayName ? `${r.customerDisplayName.slice(0, 1)}***` : '匿名客户'}
                  </div>
                  <div className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-warning-500 text-warning-500" />
                    <span className="text-[13px] font-semibold text-ink-900">{fmtScore1000(r.scoreOverall * 10)}</span>
                  </div>
                </div>

                {/* 维度(有值才显) */}
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-500">
                  {DIMS.map((d) => {
                    const v = r[d.key] as number | null;
                    return v != null ? (
                      <span key={d.label}>
                        {d.label} {(v / 10).toFixed(1)}
                      </span>
                    ) : null;
                  })}
                </div>

                {r.content && <p className="mt-2 text-[12.5px] leading-6 text-ink-700">{r.content}</p>}

                {r.tags && r.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.tags.map((tg) => (
                      <span key={tg} className="rounded-full bg-warm-50 px-2 py-0.5 text-[10px] text-ink-500">
                        {tg}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-[10px] text-ink-400">{new Date(r.createdAt).toLocaleDateString()}</span>
                  {r.appealStatus ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        r.appealStatus === 'pending'
                          ? 'bg-amber-50 text-amber-700'
                          : r.appealStatus === 'resolved'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-600'
                      }`}
                    >
                      {APPEAL_LABEL[r.appealStatus] ?? r.appealStatus}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAppealing(r.id);
                        setReason('');
                      }}
                      className="rounded-full border border-warm-200 px-3 py-1 text-[11px] text-ink-600 active:bg-warm-50"
                    >
                      申诉
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 申诉弹层 */}
      {appealing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            <h3 className="text-[15px] font-semibold text-ink-900">申诉这条评价</h3>
            <p className="mt-1 text-[12px] text-ink-500">说明为什么这条评价不实/不公,运营会人工裁决。</p>
            <textarea
              className="mt-3 h-28 w-full rounded-xl border border-warm-200 p-3 text-[13px] focus:border-primary focus:outline-none"
              placeholder="申诉理由(运营可见)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAppealing(null);
                  setReason('');
                }}
                className="flex-1 rounded-full border border-warm-200 py-2 text-[13px] text-ink-600"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitAppeal()}
                disabled={busy || !reason.trim()}
                className="flex-1 rounded-full bg-gradient-cta py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {busy ? '提交中…' : '提交申诉'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink-800/90 px-4 py-2 text-[12px] text-white">
          {toast}
        </div>
      )}
    </TherapistShell>
  );
}
