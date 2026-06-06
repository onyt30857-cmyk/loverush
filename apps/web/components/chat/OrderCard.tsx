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

import { useEffect, useState } from 'react';
import { Clock, Car, Store, ChevronRight, ShieldCheck, Sparkles } from 'lucide-react';

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
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const STEPS = ['待确认', '已锁定', '服务中', '完成'];

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

const pad = (n: number) => String(n).padStart(2, '0');
// UTC 墙上分量当本地 → 真实本地 Date(同城精确)
function apptLocalDate(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
}
function absLabel(appt: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(appt.getFullYear(), appt.getMonth(), appt.getDate());
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const time = `${pad(appt.getHours())}:${pad(appt.getMinutes())}`;
  if (diff === 0) return `今天 ${time}`;
  if (diff === 1) return `明天 ${time}`;
  if (diff === 2) return `后天 ${time}`;
  if (diff > 2 && diff < 7) return `周${WEEK[appt.getDay()]} ${time}`;
  return `${appt.getMonth() + 1}月${appt.getDate()}日 ${time}`;
}
// 期待型分段倒计时:主语=靠近,暖,不焦虑,禁全程跳秒
function countdownLabel(appt: Date, now: number, therapistName: string): string | null {
  const ms = appt.getTime() - now;
  if (ms <= 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 30) return `马上就能见到${therapistName}啦 ✨`;
  if (min < 180) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `还有 ${h} 小时${m ? ` ${m} 分` : ''}就见面`;
  }
  const day = new Date(appt.getFullYear(), appt.getMonth(), appt.getDate());
  const t = new Date(now);
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  if (day.getTime() === today.getTime()) return `就在今天 · 期待和你见面`;
  const days = Math.ceil(ms / 86_400_000);
  return `还有 ${days} 天就见到${therapistName}`;
}

export function OrderCard({ data, onOpen }: Props) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!data.scheduledAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000); // 分钟粒度,30s tick 足够,不跳秒
    return () => clearInterval(id);
  }, [data.scheduledAt]);

  const st = statusMeta(data.status);
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

      {/* 操作:已完成 → 引导给技师评价(深链 ?review=1 一键直达);其余 → 查看订单详情 */}
      <button
        type="button"
        onClick={() => onOpen(data.orderId, data.status === 'COMPLETED' ? { review: true } : undefined)}
        className={`flex w-full items-center justify-center gap-1 border-t border-warm-100 py-2.5 text-[12.5px] font-semibold transition active:bg-warm-50 ${
          data.status === 'COMPLETED' ? 'text-warning-600' : 'text-primary font-medium'
        }`}
      >
        {data.status === 'COMPLETED' ? '给技师评价' : '查看订单详情'}
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
