/**
 * 对话内订单卡 · OrderCard
 *
 * 下单成功后推进对话的事实卡:服务+时长 / 上门或到店+地点 / 预约时间(绝对+相对+期待型倒计时) /
 * 技师 / 状态 stepper / 诚意金。点「查看订单」跳 /order/[id]。
 *
 * 体验设计(调研背书):
 * - 倒计时是「期待型」非「焦虑型」:主语=靠近她不是时间流逝;暖色;分段递进禁全程跳秒;倒计时区零推销钩子。
 * - 时间「绝对为主+相对为辅」;ETA 报范围不报死点(本卡只到"约定时刻"粒度,实时ETA留 Phase B/C)。
 * - 上门/到店醒目区分(用户视角:她来我这 vs 我去她那),地点+隐私/找路提示。
 * 时区:scheduledAt 是 UTC 墙上时间,getUTC* 取墙上分量当本地(O2O 客户与技师同城,精确)。
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, Car, Store, ChevronRight, ShieldCheck, Sparkles } from 'lucide-react';
import { apptLocalDate, absLabel, countdownLabel } from '@/lib/appointment-time';
import { apiGet, apiPost, ApiClientError } from '@/lib/api';

// M-OAC · 技师主路径操作(对话卡内直接 POST,无参数)→ {端点, 按钮文案}
const INLINE_ACTIONS: Record<string, { endpoint: string; label: string }> = {
  confirm: { endpoint: 'confirm', label: '确认接单 · 锁价' },
  confirm_offline_paid: { endpoint: 'confirm-offline-paid', label: '确认已线下收款' },
  start: { endpoint: 'start', label: '开始服务' },
  complete: { endpoint: 'complete', label: '标记完成' },
};

export interface OrderCardData {
  orderId: string;
  status: string;
  serviceName: string;
  durationMin: number;
  scheduledAt: string | null;
  serviceMode: 'incall' | 'outcall';
  therapistId: string | null;
  therapistName: string;
  therapistAvatar: string | null;
  areaName: string | null;
  depositPoints: number;
}

interface Props {
  data: OrderCardData;
  onOpen: (orderId: string, opts?: { review?: boolean }) => void;
  /** 当前登录用户 id(判技师/客户视角) */
  me?: string | null;
  /** 本单技师 userId(me===此值 → 技师视角) */
  therapistUserId?: string | null;
  /** 父级刷新触发器(任一处操作成功后 +1,卡重拉最新状态) */
  refreshKey?: number;
  /** 卡内操作成功回调(父级 bump refreshKey,联动顶部条/其他卡) */
  onActed?: () => void;
}

const STEPS = ['待确认', '已锁定', '服务中', '完成'];

// 我不是当前行动方时的等待提示(viewer-aware)
function waitingHintFor(status: string, isMeTherapist: boolean): string | null {
  if (isMeTherapist) {
    if (status === 'COMPLETED') return '等客户评价';
    if (status === 'LOCKED') return '等客户支付';
    return null;
  }
  switch (status) {
    case 'PENDING_CONFIRM':
      return '等技师确认接单…';
    case 'LOCKED':
      return '线下付款给技师 · 等技师确认收款';
    case 'PAID':
      return '等技师开始服务…';
    case 'IN_SERVICE':
      return '服务中,放松等待 💆';
    default:
      return null;
  }
}

function statusMeta(status: string): { label: string; step: number; bg: string; fg: string; dot: string } {
  switch (status) {
    case 'PENDING_CONFIRM':
      return { label: '等技师确认中…', step: 0, bg: 'bg-amber-50', fg: 'text-amber-700', dot: 'bg-amber-400' };
    case 'CONFIRMED':
    case 'LOCKED':
    case 'PAID':
      return { label: '已锁定 · 等你来', step: 1, bg: 'bg-blue-50', fg: 'text-blue-700', dot: 'bg-blue-400' };
    case 'IN_SERVICE':
      return { label: '服务中', step: 2, bg: 'bg-emerald-50', fg: 'text-emerald-700', dot: 'bg-emerald-400' };
    case 'COMPLETED':
      return { label: '已完成', step: 3, bg: 'bg-ink-50', fg: 'text-ink-500', dot: 'bg-ink-300' };
    case 'CANCELLED':
      return { label: '已取消', step: -1, bg: 'bg-ink-50', fg: 'text-ink-400', dot: 'bg-ink-300' };
    case 'DISPUTED':
      return { label: '处理中', step: -1, bg: 'bg-ink-50', fg: 'text-ink-500', dot: 'bg-ink-300' };
    default:
      return { label: '预约中', step: 0, bg: 'bg-amber-50', fg: 'text-amber-700', dot: 'bg-amber-400' };
  }
}

export function OrderCard({ data, onOpen, me, therapistUserId, refreshKey = 0, onActed }: Props) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!data.scheduledAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000); // 分钟粒度,30s tick 足够,不跳秒
    return () => clearInterval(id);
  }, [data.scheduledAt]);

  // M-OAC · 实时拉订单状态 + 当前 viewer 可做操作(失败降级到下单时快照,绝不崩)
  const [live, setLive] = useState<{ status: string; viewerActions: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    apiGet<{ status: string; viewerActions: string[] }>(`/orders/${data.orderId}`)
      .then((d) => {
        if (alive) setLive({ status: d.status, viewerActions: d.viewerActions ?? [] });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [data.orderId, refreshKey]);

  const effectiveStatus = live?.status ?? data.status;
  const acts = live?.viewerActions ?? [];
  const isMeTherapist = !!me && me === therapistUserId;

  const runAction = useCallback(
    async (action: string) => {
      const ep = INLINE_ACTIONS[action]?.endpoint;
      if (!ep || busy) return;
      setBusy(action);
      setActErr(null);
      try {
        await apiPost(`/orders/${data.orderId}/${ep}`);
        onActed?.(); // 父级 bump refreshKey → 本卡 + 顶部条 + 兄弟卡全部重拉
      } catch (err) {
        setActErr(err instanceof ApiClientError ? err.payload.message : '操作失败,请重试');
      } finally {
        setBusy(null);
      }
    },
    [busy, data.orderId, onActed],
  );

  const st = statusMeta(effectiveStatus);
  const appt = data.scheduledAt ? apptLocalDate(data.scheduledAt) : null;
  const countdown = appt && st.step >= 0 && st.step < 2 ? countdownLabel(appt, now, data.therapistName) : null;
  const isOutcall = data.serviceMode === 'outcall';
  // 临近仪式态:预约 3 小时内、还没开始服务、且在未来 → 卡片升级成暖色「仪式卡」,把"快见面了"做出期待峰值
  const msToAppt = appt ? appt.getTime() - now : null;
  const imminent = !!(msToAppt != null && st.step >= 0 && st.step < 2 && msToAppt > 0 && msToAppt <= 3 * 3_600_000);

  return (
    <div
      className={`w-[286px] max-w-full overflow-hidden rounded-2xl rounded-bl-md bg-white transition ${
        imminent
          ? 'border border-primary/30 shadow-[0_2px_22px_-6px_rgba(255,85,119,0.45)]'
          : 'border border-warm-100 shadow-warm-sm'
      }`}
    >
      {/* 状态徽章 */}
      <div className={`flex items-center gap-1.5 px-4 py-2 ${st.bg}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
        <span className={`text-[12px] font-semibold ${st.fg}`}>{st.label}</span>
      </div>

      <div className="space-y-2.5 p-4">
        {/* 服务 + 时长 */}
        <div className="font-serif-cn text-[15px] font-semibold text-ink-900">
          {data.serviceName} · {data.durationMin} 分钟
        </div>

        {/* 预约时间:绝对为主 + 期待型倒计时为辅;临近时升级成暖色仪式块,倒计时升格为主角 */}
        {appt && (
          <div
            className={`rounded-xl px-3 py-2.5 transition ${
              imminent
                ? 'bg-gradient-to-br from-primary/14 to-rose-50 ring-1 ring-primary/15'
                : 'bg-gradient-to-br from-primary/6 to-warm-50/70'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 shrink-0 text-primary" />
              <span className="num text-[15px] font-bold text-ink-900">{absLabel(appt)}</span>
            </div>
            {countdown && (
              <div
                className={`mt-1 flex items-center gap-1 pl-[22px] font-medium text-primary ${
                  imminent ? 'text-[13px] font-semibold' : 'text-[11.5px]'
                }`}
              >
                {imminent && <Sparkles className="h-3.5 w-3.5 animate-pulse text-primary" />}
                {countdown}
              </div>
            )}
          </div>
        )}

        {/* 技师 */}
        <div className="flex items-center gap-2">
          {data.therapistAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.therapistAvatar} alt="" className="h-7 w-7 rounded-full object-cover" />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-warm-100 text-[11px] text-ink-400">
              {data.therapistName.slice(0, 1)}
            </div>
          )}
          <span className="text-[13px] font-medium text-ink-800">{data.therapistName}</span>
        </div>

        {/* 上门 / 到店 · 醒目区分 */}
        <div className="rounded-xl border border-warm-100 bg-warm-50/50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-800">
            {isOutcall ? <Car className="h-4 w-4 text-primary" /> : <Store className="h-4 w-4 text-primary" />}
            {isOutcall ? '上门服务 · 她到你这儿' : '到店服务 · 你去她那儿'}
          </div>
          <div className="mt-0.5 pl-[22px] text-[11px] leading-4 text-ink-500">
            {data.areaName ? `${data.areaName}` : isOutcall ? '你的位置' : '门店'}
            {isOutcall ? ' · 技师确认后才解锁完整门牌给她导航' : ' · 详细门店地址/找店指引在订单里'}
          </div>
        </div>

        {/* 诚意金 */}
        {data.depositPoints > 0 && (
          <div className="flex items-center gap-1.5 text-[11.5px] text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            诚意金 <span className="num font-semibold text-emerald-700">{data.depositPoints}</span> 已锁定
            <span className="text-ink-400">· 服务后自动退还</span>
          </div>
        )}

        {/* stepper */}
        {st.step >= 0 && (
          <div className="flex items-center gap-1 pt-0.5">
            {STEPS.map((s, i) => (
              <div key={s} className="flex flex-1 items-center gap-1">
                <div className="flex flex-col items-center gap-0.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      i < st.step ? 'bg-emerald-400' : i === st.step ? 'bg-primary ring-2 ring-primary/20' : 'bg-ink-200'
                    }`}
                  />
                  <span className={`text-[8.5px] ${i === st.step ? 'font-semibold text-primary' : 'text-ink-400'}`}>{s}</span>
                </div>
                {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < st.step ? 'bg-emerald-300' : 'bg-ink-150'}`} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* M-OAC · 操作区:技师主路径就地 POST · 客户付款/评价跳详情 · 等待态提示 · 始终留查看详情 */}
      <div className="border-t border-warm-100">
        {actErr && <div className="px-4 pt-2 text-[11px] text-red-500">{actErr}</div>}

        {/* 技师主路径操作(通常一个,按状态出现) */}
        {acts
          .filter((a) => a in INLINE_ACTIONS)
          .map((a) => (
            <button
              key={a}
              type="button"
              disabled={busy != null}
              onClick={() => void runAction(a)}
              className="flex w-full items-center justify-center gap-1 bg-primary py-2.5 text-[13px] font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
            >
              {busy === a ? '处理中…' : INLINE_ACTIONS[a]!.label}
            </button>
          ))}

        {/* 客户:去支付(积分模式)/ 给技师评价 → 详情页完成(需额外输入) */}
        {acts.includes('pay') && (
          <button
            type="button"
            onClick={() => onOpen(data.orderId)}
            className="flex w-full items-center justify-center gap-1 bg-primary py-2.5 text-[13px] font-semibold text-white transition active:scale-[0.99]"
          >
            去支付 →
          </button>
        )}
        {acts.includes('review') && (
          <button
            type="button"
            onClick={() => onOpen(data.orderId, { review: true })}
            className="flex w-full items-center justify-center gap-1 py-2.5 text-[13px] font-semibold text-warning-600 transition active:bg-warm-50"
          >
            给技师评价 →
          </button>
        )}

        {/* 等待态:我不是当前行动方 */}
        {!acts.some((a) => a in INLINE_ACTIONS || a === 'pay' || a === 'review') &&
          waitingHintFor(effectiveStatus, isMeTherapist) && (
            <div className="px-4 py-2 text-center text-[12px] text-ink-400">
              {waitingHintFor(effectiveStatus, isMeTherapist)}
            </div>
          )}

        {/* 始终保留:查看订单详情(异常操作 / 完整信息在详情页) */}
        <button
          type="button"
          onClick={() => onOpen(data.orderId)}
          className="flex w-full items-center justify-center gap-1 py-2 text-[11.5px] text-ink-400 transition active:bg-warm-50"
        >
          查看订单详情 <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
