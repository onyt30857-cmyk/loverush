/**
 * 技师端排班页 · /t/me/schedule
 *
 * 三大功能:
 *   1. 每周固定排班(7 天 · 每天开始/结束时间 · 整天关)
 *   2. 临时挡时段(休假 / 不接单)
 *   3. 高级:slot_minutes(时段粒度)+ buffer_minutes(单间缓冲)
 *
 * 一键模板:
 *   - 平日班(周一-五 18:00-23:00)
 *   - 周末班(周六日 14:00-23:00)
 *   - 全勤(每天 12:00-23:00)
 */
'use client';

import { useEffect, useState } from 'react';
import { TherapistShell } from '@/components/AppShell';
import { ErrorBanner, LoadingFull, PrimaryButton } from '@/components/ui';
import { apiGet, apiPost, apiPut, apiDelete, ApiClientError } from '@/lib/api';

interface WorkingHour {
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

interface ScheduleResp {
  working_hours: WorkingHour[];
  slot_minutes: number;
  buffer_minutes: number;
}

interface UnavailRow {
  id: string;
  start_at: string;
  end_at: string;
  reason: string | null;
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const DEFAULT_HOURS = Array.from({ length: 7 }, (_, i) => ({
  weekday: i,
  start_time: '18:00',
  end_time: '23:00',
  is_active: false,
}));

const TEMPLATES: Record<string, WorkingHour[]> = {
  '平日班': Array.from({ length: 7 }, (_, i) => ({
    weekday: i,
    start_time: '18:00',
    end_time: '23:00',
    is_active: i >= 1 && i <= 5,
  })),
  '周末班': Array.from({ length: 7 }, (_, i) => ({
    weekday: i,
    start_time: '14:00',
    end_time: '23:30',
    is_active: i === 0 || i === 6,
  })),
  '全勤': Array.from({ length: 7 }, (_, i) => ({
    weekday: i,
    start_time: '12:00',
    end_time: '23:00',
    is_active: true,
  })),
};

function fmtTime(t: string): string {
  return t.length === 5 ? t : t.slice(0, 5);
}

function fmtUnavailDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function TherapistSchedulePage() {
  const [hours, setHours] = useState<WorkingHour[]>(DEFAULT_HOURS);
  const [slotMin, setSlotMin] = useState(30);
  const [bufferMin, setBufferMin] = useState(15);
  const [unavail, setUnavail] = useState<UnavailRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // 临时挡时段 form
  const [unavailFrom, setUnavailFrom] = useState('');
  const [unavailTo, setUnavailTo] = useState('');
  const [unavailReason, setUnavailReason] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [s, u] = await Promise.all([
          apiGet<ScheduleResp>('/therapists/me/schedule'),
          apiGet<UnavailRow[]>('/therapists/me/unavailable').catch(() => [] as UnavailRow[]),
        ]);
        const mergedHours = DEFAULT_HOURS.map((d) => {
          const existing = s.working_hours.find((w) => w.weekday === d.weekday);
          return existing
            ? { ...d, start_time: fmtTime(existing.start_time), end_time: fmtTime(existing.end_time), is_active: existing.is_active }
            : d;
        });
        setHours(mergedHours);
        setSlotMin(s.slot_minutes);
        setBufferMin(s.buffer_minutes);
        setUnavail(u);
      } catch (err) {
        if (err instanceof ApiClientError) setError(err.payload.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function update(weekday: number, patch: Partial<WorkingHour>) {
    setHours((curr) => curr.map((h) => (h.weekday === weekday ? { ...h, ...patch } : h)));
  }

  function applyTemplate(name: keyof typeof TEMPLATES) {
    const tpl = TEMPLATES[name];
    if (tpl) setHours(tpl);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiPut('/therapists/me/schedule', { working_hours: hours });
      await apiPut('/therapists/me/schedule/config', {
        slot_minutes: slotMin,
        buffer_minutes: bufferMin,
      });
      setSavedAt(new Date());
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setSaving(false);
    }
  }

  async function addUnavailable() {
    if (!unavailFrom || !unavailTo) {
      setError('请填开始和结束时间');
      return;
    }
    try {
      const body = {
        start_at: new Date(unavailFrom).toISOString(),
        end_at: new Date(unavailTo).toISOString(),
        reason: unavailReason || undefined,
      };
      const resp = await apiPost<{ id: string; start_at: string; end_at: string }>(
        '/therapists/me/unavailable',
        body,
      );
      setUnavail((curr) => [
        ...(curr ?? []),
        { id: resp.id, start_at: resp.start_at, end_at: resp.end_at, reason: unavailReason || null },
      ]);
      setUnavailFrom('');
      setUnavailTo('');
      setUnavailReason('');
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  async function removeUnavailable(id: string) {
    try {
      await apiDelete(`/therapists/me/unavailable/${id}`);
      setUnavail((curr) => (curr ?? []).filter((u) => u.id !== id));
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  if (loading) {
    return (
      <TherapistShell title="排班" showBack hideTabBar>
        <LoadingFull />
      </TherapistShell>
    );
  }

  return (
    <TherapistShell title="排班" showBack hideTabBar>
      <div className="min-h-full space-y-5 bg-gradient-soft px-5 py-5">
        <ErrorBanner message={error} />

        {/* 一键模板 */}
        <section className="rounded-2xl bg-white p-4 shadow-warm-xs">
          <div className="mb-2 text-sm font-semibold text-ink-900">快速模板</div>
          <div className="mb-3 text-[11px] text-ink-500">点一下,7 天排班一次性设好</div>
          <div className="flex gap-2">
            {Object.keys(TEMPLATES).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => applyTemplate(name as keyof typeof TEMPLATES)}
                className="flex-1 rounded-xl border border-warm-200 bg-white px-3 py-2 text-[12.5px] font-medium text-ink-700 transition active:scale-95"
              >
                {name}
              </button>
            ))}
          </div>
        </section>

        {/* 7 天排班 */}
        <section className="rounded-2xl bg-white p-4 shadow-warm-xs">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <div className="text-sm font-semibold text-ink-900">每周排班</div>
              <div className="mt-0.5 text-[11px] text-ink-500">关掉不接单的日子</div>
            </div>
          </div>

          <div className="space-y-2">
            {hours.map((h) => (
              <div key={h.weekday} className="flex items-center gap-2.5">
                <div className="w-7 shrink-0 text-center text-sm font-semibold text-ink-700">
                  {WEEKDAY_LABELS[h.weekday]}
                </div>
                <button
                  type="button"
                  onClick={() => update(h.weekday, { is_active: !h.is_active })}
                  className={`flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition active:scale-95 ${
                    h.is_active
                      ? 'bg-gradient-cta text-white shadow-rose-md'
                      : 'border border-warm-200 bg-white text-ink-400'
                  }`}
                >
                  {h.is_active ? '接单' : '休息'}
                </button>
                {h.is_active ? (
                  <>
                    <input
                      type="time"
                      value={h.start_time}
                      onChange={(e) => update(h.weekday, { start_time: e.target.value })}
                      className="flex-1 rounded-lg border border-warm-100 px-2 py-1.5 text-[12px] outline-none focus:border-primary"
                    />
                    <span className="text-[11px] text-ink-400">→</span>
                    <input
                      type="time"
                      value={h.end_time}
                      onChange={(e) => update(h.weekday, { end_time: e.target.value })}
                      className="flex-1 rounded-lg border border-warm-100 px-2 py-1.5 text-[12px] outline-none focus:border-primary"
                    />
                  </>
                ) : (
                  <div className="flex-1 text-[11px] text-ink-300">不接单</div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* 高级 · 时段粒度 + 缓冲 */}
        <section className="rounded-2xl bg-white p-4 shadow-warm-xs">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink-900">高级设置</div>
            <div className="mt-0.5 text-[11px] text-ink-500">不动也能用 · 默认 30 分钟时段 · 单间缓冲 15 分钟</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-ink-700">时段粒度(分)</label>
              <select
                value={slotMin}
                onChange={(e) => setSlotMin(Number(e.target.value))}
                className="w-full rounded-lg border border-warm-100 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-primary"
              >
                {[15, 30, 45, 60].map((v) => (
                  <option key={v} value={v}>{v} 分钟</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-ink-700">两单间隔(分)</label>
              <select
                value={bufferMin}
                onChange={(e) => setBufferMin(Number(e.target.value))}
                className="w-full rounded-lg border border-warm-100 bg-white px-3 py-2 text-[12.5px] outline-none focus:border-primary"
              >
                {[0, 15, 30, 45, 60].map((v) => (
                  <option key={v} value={v}>{v} 分钟</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-2 text-[10.5px] leading-relaxed text-ink-500">
            上门服务推荐 15-30 分钟间隔(交通 + 整理)· 影响客户能选的时段
          </div>
        </section>

        {/* 临时挡时段 */}
        <section className="rounded-2xl bg-white p-4 shadow-warm-xs">
          <div className="mb-3">
            <div className="text-sm font-semibold text-ink-900">临时挡时段</div>
            <div className="mt-0.5 text-[11px] text-ink-500">临时休假 / 私事 · 不动周排班</div>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="datetime-local"
                value={unavailFrom}
                onChange={(e) => setUnavailFrom(e.target.value)}
                placeholder="开始"
                className="rounded-lg border border-warm-100 bg-white px-3 py-2 text-[12px] outline-none focus:border-primary"
              />
              <input
                type="datetime-local"
                value={unavailTo}
                onChange={(e) => setUnavailTo(e.target.value)}
                placeholder="结束"
                className="rounded-lg border border-warm-100 bg-white px-3 py-2 text-[12px] outline-none focus:border-primary"
              />
            </div>
            <input
              type="text"
              value={unavailReason}
              onChange={(e) => setUnavailReason(e.target.value)}
              placeholder="原因(可选 · 仅自己可见)"
              maxLength={100}
              className="w-full rounded-lg border border-warm-100 bg-white px-3 py-2 text-[12px] outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => void addUnavailable()}
              className="w-full rounded-xl border border-primary/30 bg-primary/5 py-2 text-[12.5px] font-medium text-primary transition active:scale-[0.99]"
            >
              + 添加挡时段
            </button>
          </div>

          {unavail && unavail.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {unavail.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-2 rounded-lg border border-warm-100 bg-warm-50/50 px-2.5 py-2 text-[11.5px]"
                >
                  <span className="flex-1 truncate">
                    {fmtUnavailDate(u.start_at)} → {fmtUnavailDate(u.end_at)}
                    {u.reason ? <span className="ml-1 text-ink-400">· {u.reason}</span> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeUnavailable(u.id)}
                    className="text-[10.5px] text-primary hover:underline"
                  >
                    撤销
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3 text-[11px] text-ink-400">暂无</div>
          )}
        </section>

        {savedAt && (
          <div className="text-center text-[11px] text-success-500">
            已保存 · {savedAt.toLocaleTimeString()}
          </div>
        )}

        <PrimaryButton onClick={() => void save()} loading={saving}>
          保存排班
        </PrimaryButton>
      </div>
    </TherapistShell>
  );
}
