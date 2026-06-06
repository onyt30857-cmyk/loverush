// apps/web/lib/appointment-time.ts
// 订单预约时间工具 · 单一真相源（原在 components/chat/OrderCard.tsx）
// UTC 墙上分量当本地 → 同城精确显示（v1 按 UTC 存、按本地墙上时间显示）

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const pad = (n: number) => String(n).padStart(2, '0');

/** UTC 墙上分量当本地 → 真实本地 Date（同城精确） */
export function apptLocalDate(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
}

/** 绝对时间标签：今天/明天/后天 HH:MM、周X HH:MM、M月D日 HH:MM */
export function absLabel(appt: Date): string {
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

/** 期待型分段倒计时：靠近、暖、不焦虑、不全程跳秒；已过点返回 null */
export function countdownLabel(appt: Date, now: number, therapistName: string): string | null {
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
  const days = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  return `还有 ${days} 天就见到${therapistName}`;
}
