/**
 * 安心评级卡 · A/B/C/D 四等级 + 4 项指标 · M03 F03-D2
 *
 * 实现 PRD §3.2 F03-D2「安心评级」:
 *  - 4 等级:A=green / B=blue(→ success 蓝调降级用 ink-600) / C=amber(warning) / D=rose(danger)
 *  - 4 指标:投诉次数 / 安心等级 / 异常订单率 / 加项嫌疑指数
 *  - 默认折叠（避免技师卡视觉嘈杂），点击展开详情
 *
 * 数据来源:技师详情/推荐卡传入 SafetyMetrics（后端 F03-D2 字段未上线时调用方传 null → 显示"数据采集中"）
 */
'use client';

import { useState } from 'react';
import { Shield, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

export type SafetyGrade = 'A' | 'B' | 'C' | 'D';

export interface SafetyMetrics {
  /** 投诉历史次数（脱敏） */
  complaintCount?: number;
  /** 安心等级 A/B/C/D */
  grade: SafetyGrade;
  /** 异常订单率 0-1 */
  abnormalOrderRate?: number;
  /** 加项嫌疑指数 0-1 */
  upsellSuspicionIndex?: number;
  /** 价格偏差率（F03-D3） */
  priceDeviationRate?: number | null;
  /** 真人核验状态（F03-D4） */
  verified?: boolean;
}

interface SafetyRatingProps {
  metrics: SafetyMetrics | null;
  /** 紧凑模式 · 推荐卡内只显徽章不可展开 */
  compact?: boolean;
}

const GRADE_STYLE: Record<SafetyGrade, { bg: string; text: string; ring: string; label: string; icon: typeof Shield }> = {
  A: { bg: 'bg-success-500/10', text: 'text-success-500', ring: 'ring-success-500/30', label: '安心', icon: CheckCircle2 },
  B: { bg: 'bg-ink-600/10', text: 'text-ink-700', ring: 'ring-ink-600/30', label: '稳', icon: Shield },
  C: { bg: 'bg-warning-500/15', text: 'text-warning-500', ring: 'ring-warning-500/30', label: '一般', icon: Info },
  D: { bg: 'bg-danger-500/10', text: 'text-danger-500', ring: 'ring-danger-500/30', label: '注意', icon: AlertTriangle },
};

export function SafetyBadge({ grade }: { grade: SafetyGrade }) {
  const s = GRADE_STYLE[grade];
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ${s.bg} ${s.text} ${s.ring}`}
      aria-label={`安心评级 ${grade} · ${s.label}`}
    >
      <Icon className="h-3 w-3" />
      <span>{grade}</span>
      <span className="ml-0.5 font-normal">{s.label}</span>
    </span>
  );
}

export function SafetyRating({ metrics, compact = false }: SafetyRatingProps) {
  const [open, setOpen] = useState(false);

  if (!metrics) {
    return (
      <div className="rounded-2xl border border-warm-100 bg-white px-4 py-3 text-[12px] text-ink-500 shadow-warm-xs">
        <span className="inline-flex items-center gap-1">
          <Info className="h-3.5 w-3.5" />
          数据采集中 · 等积累几单再看安心评级
        </span>
      </div>
    );
  }

  if (compact) {
    return <SafetyBadge grade={metrics.grade} />;
  }

  const s = GRADE_STYLE[metrics.grade];
  const Icon = s.icon;
  const ratePct = (v: number | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

  return (
    <div className="rounded-2xl border border-warm-100 bg-white shadow-warm-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-warm-50"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.bg} ${s.text}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="text-serif-cn text-[13px] font-semibold text-ink-800">
              安心评级 <span className={`${s.text} num`}>{metrics.grade}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-ink-500">
              4 项指标平台脱敏聚合 · 每日刷新
            </div>
          </div>
        </div>
        <span className={`text-[11px] ${open ? 'rotate-180' : ''} transition`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-2 border-t border-warm-100 px-4 py-3 text-[11px]">
          <Metric label="投诉次数" value={metrics.complaintCount != null ? String(metrics.complaintCount) : '—'} />
          <Metric label="安心等级" value={metrics.grade} accent={s.text} />
          <Metric label="异常订单率" value={ratePct(metrics.abnormalOrderRate)} />
          <Metric label="加项嫌疑" value={ratePct(metrics.upsellSuspicionIndex)} />
          {metrics.priceDeviationRate != null && (
            <Metric label="价格偏差" value={ratePct(metrics.priceDeviationRate)} />
          )}
          {metrics.verified != null && (
            <Metric label="真人核验" value={metrics.verified ? '已核验' : '未核验'} accent={metrics.verified ? 'text-success-500' : 'text-danger-500'} />
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-warm-50 px-2.5 py-1.5">
      <div className="label-cormorant text-[9px]">{label}</div>
      <div className={`text-display mt-0.5 text-[13px] font-bold ${accent ?? 'text-ink-800'} num`}>{value}</div>
    </div>
  );
}
