'use client';

/**
 * AI 分身 · 健康仪表盘（M06b 模块②）
 *
 * 给每个开了分身的技师一个 0-100 综合健康分（4 维子分透明），最差排在最前，
 * 让运营一眼看出"哪个技师的 AI 在出问题、问题出在哪一维"。
 * 数据来自 /admin/ai-system/health；「刷新健康分」手动触发重算（纯读库算分，不碰客户）。
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface TherapistRow {
  therapistUserId: string;
  displayName: string | null;
  enabled: boolean;
  killSwitchReason: string | null;
  overallScore: number | null;
  redlineFreqScore: number | null;
  simhashRepeatScore: number | null;
  negativeFeedbackScore: number | null;
  volumeScore: number | null;
  metrics: {
    redlineCount?: number;
    simhashRepeatCount?: number;
    blockCount?: number;
    reviewLowScoreCount?: number;
    alterMessageCount?: number;
  } | null;
  scoreDate: string | null;
}

interface HealthData {
  overview: {
    enabledCount: number;
    scoredCount: number;
    avgScore: number | null;
    riskCount: number;
    lastComputedAt: string | null;
  };
  therapists: TherapistRow[];
}

// 子分上限，用于进度条归一化
const SUB_MAX = { redline: 40, simhash: 25, negative: 20, volume: 15 };

function scoreTone(score: number | null): { bg: string; text: string; label: string } {
  if (score === null) return { bg: 'bg-gray-100', text: 'text-gray-400', label: '未算分' };
  if (score >= 80) return { bg: 'bg-green-50', text: 'text-green-700', label: '健康' };
  if (score >= 50) return { bg: 'bg-amber-50', text: 'text-amber-700', label: '注意' };
  return { bg: 'bg-red-50', text: 'text-red-700', label: '风险' };
}

export default function AiHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api.get<HealthData>('/admin/ai-system/health');
      setData(r);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.payload.message : '加载失败');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const recompute = async () => {
    setRecomputing(true);
    setToast(null);
    try {
      const r = await api.post<{ computed: number }>('/admin/ai-system/health/recompute', {});
      setToast(`已重算 ${r.computed} 位技师的健康分`);
      await load();
    } catch (e) {
      setToast(e instanceof ApiClientError ? e.payload.message : '重算失败');
    } finally {
      setRecomputing(false);
    }
  };

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">AI 分身 · 健康仪表盘</h1>
            <p className="mt-1 text-sm text-gray-500">
              每个开了分身的技师一个 0-100 健康分，最差排在最前。分低说明她的 AI 在出问题，点开看是哪一维拖了后腿。
            </p>
          </div>
          <button
            type="button"
            onClick={recompute}
            disabled={recomputing}
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {recomputing ? '重算中…' : '刷新健康分'}
          </button>
        </div>

        {toast && <div className="mt-4 rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-700">{toast}</div>}
        {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
        {!data && !error && <div className="mt-6 text-sm text-gray-400">加载中…</div>}

        {data && (
          <>
            {/* 概览卡 */}
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <OverviewCard label="开启分身" value={String(data.overview.enabledCount)} hint="已启用 AI 的技师数" />
              <OverviewCard
                label="平均健康分"
                value={data.overview.avgScore !== null ? String(data.overview.avgScore) : '—'}
                hint={`${data.overview.scoredCount} 位已算分`}
                tone={data.overview.avgScore}
              />
              <OverviewCard
                label="风险技师"
                value={String(data.overview.riskCount)}
                hint="健康分 < 50"
                danger={data.overview.riskCount > 0}
              />
              <OverviewCard
                label="最近重算"
                value={data.overview.lastComputedAt ?? '从未'}
                hint={data.overview.lastComputedAt ? '点右上角刷新更新' : '点右上角「刷新健康分」'}
              />
            </div>

            {data.overview.scoredCount === 0 && (
              <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                还没有任何健康分。点右上角「刷新健康分」做首次计算。
              </div>
            )}

            {/* 技师健康榜 */}
            {data.therapists.length > 0 && (
              <div className="mt-6 space-y-3">
                {data.therapists.map((t) => (
                  <TherapistCard key={t.therapistUserId} t={t} />
                ))}
              </div>
            )}

            {/* 算法说明 */}
            <div className="mt-7 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-600">
              <span className="font-medium text-gray-700">健康分怎么算（满分 100，7 天滑窗）：</span>
              红线频率 40 分（被自动拦截/改写越多扣越多）· 重复度 25 分（说车轱辘话越多扣越多）·
              负反馈 20 分（差评 + 被客户拉黑）· 活跃度 15 分（完全不代发给 0，过量缓降）。
              分数越低越要优先处理。
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function OverviewCard({
  label,
  value,
  hint,
  tone,
  danger,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: number | null;
  danger?: boolean;
}) {
  const t = tone !== undefined ? scoreTone(tone) : null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${danger ? 'text-red-600' : t ? t.text : 'text-gray-900'}`}>
        {value}
      </div>
      <div className="mt-1 text-[11px] text-gray-400">{hint}</div>
    </div>
  );
}

function TherapistCard({ t }: { t: TherapistRow }) {
  const tone = scoreTone(t.overallScore);
  const m = t.metrics ?? {};
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-12 w-12 flex-col items-center justify-center rounded-lg ${tone.bg}`}>
            <span className={`text-lg font-bold ${tone.text}`}>{t.overallScore ?? '—'}</span>
          </div>
          <div>
            <div className="font-semibold text-gray-900">{t.displayName || '（未命名技师）'}</div>
            <div className="mt-0.5 flex items-center gap-2 text-xs">
              <span className={`rounded-full px-2 py-0.5 ${tone.bg} ${tone.text}`}>{tone.label}</span>
              {t.killSwitchReason && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-700">已关停：{t.killSwitchReason}</span>
              )}
              {!t.enabled && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500">未启用</span>}
            </div>
          </div>
        </div>
        <div className="text-right text-[11px] text-gray-400">
          {t.scoreDate ? `算分日 ${t.scoreDate}` : '未算分'}
          <div className="mt-0.5">代发 {m.alterMessageCount ?? 0} 条 / 7 天</div>
        </div>
      </div>

      {/* 4 维子分 */}
      {t.overallScore !== null && (
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
          <SubScore label="红线频率" score={t.redlineFreqScore} max={SUB_MAX.redline} detail={`${m.redlineCount ?? 0} 次被拦`} />
          <SubScore
            label="重复度"
            score={t.simhashRepeatScore}
            max={SUB_MAX.simhash}
            detail={`${m.simhashRepeatCount ?? 0} 条重复`}
          />
          <SubScore
            label="负反馈"
            score={t.negativeFeedbackScore}
            max={SUB_MAX.negative}
            detail={`拉黑 ${m.blockCount ?? 0}`}
          />
          <SubScore label="活跃度" score={t.volumeScore} max={SUB_MAX.volume} detail={`${m.alterMessageCount ?? 0} 条`} />
        </div>
      )}
    </div>
  );
}

function SubScore({
  label,
  score,
  max,
  detail,
}: {
  label: string;
  score: number | null;
  max: number;
  detail: string;
}) {
  const pct = score !== null ? Math.round((score / max) * 100) : 0;
  const barColor = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-gray-800">
          {score ?? '—'}
          <span className="text-gray-400">/{max}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-0.5 text-[10px] text-gray-400">{detail}</div>
    </div>
  );
}
