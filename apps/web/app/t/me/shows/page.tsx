/**
 * 技师 · 节目管理 · M02b/M04 Phase 1
 *
 * 列表 + 创建/编辑 drawer · 状态机 UI
 * 拉公开字典 GET /service-categories 给类型 select 用
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { TherapistShell } from '@/components/AppShell';
import { LoadingFull, Section } from '@/components/ui';
import { useDialog } from '@/components/UIDialog';
import { apiGet, apiPost, apiPut, apiDelete, ApiClientError } from '@/lib/api';

interface ServiceCategory {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
  iconEmoji: string | null;
  displayOrder: number;
  isActive: number;
}

interface AddOn {
  name: string;
  pricePoints: number;
  isDefault?: boolean;
}

interface Show {
  id: string;
  therapistUserId: string;
  categoryCode: string;
  startTime: string;
  durationMin: number;
  pricePoints: number;
  addOns: AddOn[];
  includesNote: string | null;
  excludesNote: string | null;
  slotsTotal: number;
  slotsRemaining: number;
  serviceCity: string | null;
  serviceArea: string | null;
  status: 'draft' | 'open' | 'closed' | 'completed';
  createdAt: string;
}

const DURATIONS = [60, 90, 120, 150, 180];

export default function TherapistShowsPage() {
  const { confirm, alert } = useDialog();
  const [shows, setShows] = useState<Show[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerShow, setDrawerShow] = useState<Show | 'new' | null>(null);

  const reload = useCallback(async () => {
    const [s, c] = await Promise.all([
      apiGet<Show[]>('/shows/me'),
      apiGet<ServiceCategory[]>('/service-categories'),
    ]);
    setShows(s);
    setCategories(c);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await reload();
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

  async function handleDelete(s: Show) {
    if (s.status !== 'draft') {
      await alert({ title: '不可删除', message: '仅 draft 草稿态节目可删除 · 已发布的请先下架' });
      return;
    }
    const ok = await confirm({
      title: '删除节目?',
      message: `${categoryName(s.categoryCode)} · ${formatTime(s.startTime)}`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiDelete(`/shows/me/${s.id}`);
      await reload();
    } catch (err) {
      await alert({ title: '删除失败', message: err instanceof ApiClientError ? err.payload.message : String(err) });
    }
  }

  async function handleStatusToggle(s: Show, target: 'open' | 'closed') {
    const verb = target === 'open' ? '发布' : '下架';
    const ok = await confirm({
      title: `${verb}节目?`,
      message: target === 'open'
        ? '发布后客户可立即看到并拍单 · 时段/类型/价格不可再改 · 仅加项可调'
        : '下架后节目从客户视图消失 · 已下单的不影响 · 可随时再开放',
      confirmText: verb,
    });
    if (!ok) return;
    try {
      await apiPut(`/shows/me/${s.id}`, { status: target });
      await reload();
    } catch (err) {
      await alert({ title: `${verb}失败`, message: err instanceof ApiClientError ? err.payload.message : String(err) });
    }
  }

  function categoryName(code: string) {
    const cat = categories.find((c) => c.code === code);
    return cat ? `${cat.iconEmoji ?? ''} ${cat.nameZh}` : code;
  }

  if (loading) return <TherapistShell title="节目管理" showBack><LoadingFull /></TherapistShell>;

  return (
    <TherapistShell title="节目管理" showBack>
      <div className="px-5 pt-3 pb-2 flex items-center justify-between">
        <div className="text-[12px] text-ink-500">
          我的节目 {shows.length} · 草稿 {shows.filter((s) => s.status === 'draft').length} · 开放 {shows.filter((s) => s.status === 'open').length}
        </div>
        <button
          type="button"
          onClick={() => setDrawerShow('new')}
          className="rounded-full bg-gradient-cta px-4 py-1.5 text-[12px] font-semibold text-white active:scale-95"
        >
          + 发布节目
        </button>
      </div>

      {shows.length === 0 ? (
        <div className="px-8 py-12 text-center">
          <div className="text-4xl mb-2">🎫</div>
          <div className="text-[14px] font-semibold text-ink-800 text-serif-cn">还没发布节目</div>
          <div className="mt-1 text-[12px] text-ink-500">点上方 + 按钮发布第一个节目 · 客户能在"今晚特惠"看到</div>
        </div>
      ) : (
        <div className="px-3 space-y-2">
          {shows.map((s) => (
            <ShowCard
              key={s.id}
              show={s}
              categoryName={categoryName(s.categoryCode)}
              onEdit={() => setDrawerShow(s)}
              onDelete={() => void handleDelete(s)}
              onPublish={() => void handleStatusToggle(s, 'open')}
              onClose={() => void handleStatusToggle(s, 'closed')}
            />
          ))}
        </div>
      )}

      {drawerShow && (
        <ShowDrawer
          show={drawerShow === 'new' ? null : drawerShow}
          categories={categories}
          onClose={() => setDrawerShow(null)}
          onSaved={async () => {
            setDrawerShow(null);
            await reload();
          }}
        />
      )}
    </TherapistShell>
  );
}

// ──────────────── ShowCard ────────────────

function ShowCard({
  show: s, categoryName, onEdit, onDelete, onPublish, onClose,
}: {
  show: Show;
  categoryName: string;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: () => void;
  onClose: () => void;
}) {
  const isDraft = s.status === 'draft';
  const isOpen = s.status === 'open';
  const statusBadge = isDraft
    ? { label: '草稿', cls: 'bg-ink-100 text-ink-700' }
    : isOpen
      ? { label: '开放中', cls: 'bg-success-500/10 text-success-500' }
      : s.status === 'closed'
        ? { label: '已下架', cls: 'bg-warning-500/10 text-warning-500' }
        : { label: '已结束', cls: 'bg-ink-100 text-ink-500' };

  return (
    <div className="rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
            <span className="text-[13px] font-semibold text-ink-800 truncate">{categoryName}</span>
          </div>
          <div className="mt-1.5 text-[12px] text-ink-600">
            {formatTime(s.startTime)} · {s.durationMin}分钟 · <span className="font-bold text-primary">{s.pricePoints} 积分</span>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-500">
            名额 {s.slotsRemaining}/{s.slotsTotal} · 加项 {s.addOns.length}
            {s.serviceCity && <> · {s.serviceCity}{s.serviceArea && `/${s.serviceArea}`}</>}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        {isDraft && (
          <button onClick={onPublish} className="flex-1 rounded-lg bg-primary text-white py-1.5 text-[11px] font-medium active:scale-95">
            发布
          </button>
        )}
        {isOpen && (
          <button onClick={onClose} className="flex-1 rounded-lg border border-warm-300 text-warm-700 py-1.5 text-[11px] active:bg-warm-50">
            下架
          </button>
        )}
        {s.status === 'closed' && (
          <button onClick={onPublish} className="flex-1 rounded-lg border border-primary text-primary py-1.5 text-[11px] active:bg-primary/5">
            重新开放
          </button>
        )}
        {s.status !== 'completed' && (
          <button onClick={onEdit} className="flex-1 rounded-lg border border-warm-200 text-ink-700 py-1.5 text-[11px] active:bg-warm-50">
            {isOpen ? '改加项' : '编辑'}
          </button>
        )}
        {isDraft && (
          <button onClick={onDelete} className="rounded-lg border border-danger-500/30 text-danger-500 px-2 py-1.5 text-[11px] active:bg-danger-500/5">
            删除
          </button>
        )}
      </div>
    </div>
  );
}

// ──────────────── ShowDrawer ────────────────

function ShowDrawer({
  show, categories, onClose, onSaved,
}: {
  show: Show | null;
  categories: ServiceCategory[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { alert } = useDialog();
  const isNew = !show;
  const isOpen = show?.status === 'open';
  const isClosed = show?.status === 'closed';
  // open 态只能改 add_ons + notes · 字段锁定
  const fieldsLocked = isOpen || isClosed;

  // 默认值
  const now = new Date();
  now.setHours(now.getHours() + 2, 0, 0, 0); // 默认 2h 后
  const defaultStart = show ? new Date(show.startTime) : now;

  const [categoryCode, setCategoryCode] = useState(show?.categoryCode ?? categories[0]?.code ?? '');
  const [startDate, setStartDate] = useState(defaultStart.toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState(defaultStart.toTimeString().slice(0, 5));
  const [durationMin, setDurationMin] = useState(show?.durationMin ?? 60);
  const [pricePoints, setPricePoints] = useState(show?.pricePoints ?? 100);
  const [slotsTotal, setSlotsTotal] = useState(show?.slotsTotal ?? 1);
  const [serviceCity, setServiceCity] = useState(show?.serviceCity ?? '');
  const [serviceArea, setServiceArea] = useState(show?.serviceArea ?? '');
  const [includesNote, setIncludesNote] = useState(show?.includesNote ?? '精油 / 毛巾 / 热敷');
  const [excludesNote, setExcludesNote] = useState(show?.excludesNote ?? '加钟 / 私密服务');
  const [addOns, setAddOns] = useState<AddOn[]>(show?.addOns ?? []);
  const [busy, setBusy] = useState(false);

  function addAddOn() {
    setAddOns([...addOns, { name: '', pricePoints: 50, isDefault: false }]);
  }
  function updateAddOn(i: number, patch: Partial<AddOn>) {
    setAddOns(addOns.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }
  function removeAddOn(i: number) {
    setAddOns(addOns.filter((_, idx) => idx !== i));
  }

  async function handleSave(publish: boolean) {
    if (!categoryCode) {
      await alert({ title: '请选择服务类型' });
      return;
    }
    // 拼时间
    const startISO = new Date(`${startDate}T${startTime}:00`).toISOString();
    const payload = fieldsLocked
      ? {
          // open 态:仅 add_ons + notes
          add_ons: addOns.filter((a) => a.name.trim()),
          includes_note: includesNote || undefined,
          excludes_note: excludesNote || undefined,
        }
      : {
          category_code: categoryCode,
          start_time: startISO,
          duration_min: durationMin,
          price_points: pricePoints,
          slots_total: slotsTotal,
          add_ons: addOns.filter((a) => a.name.trim()),
          includes_note: includesNote || undefined,
          excludes_note: excludesNote || undefined,
          service_city: serviceCity || undefined,
          service_area: serviceArea || undefined,
        };

    setBusy(true);
    try {
      let saved: Show;
      if (isNew) {
        saved = await apiPost<Show>('/shows/me', payload);
      } else {
        saved = await apiPut<Show>(`/shows/me/${show!.id}`, payload);
      }
      if (publish && saved.status === 'draft') {
        await apiPut(`/shows/me/${saved.id}`, { status: 'open' });
      }
      await onSaved();
    } catch (err) {
      await alert({ title: '保存失败', message: err instanceof ApiClientError ? err.payload.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <div
        className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-3xl bg-white p-5 pb-12"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-base font-semibold text-ink-800 text-serif-cn">
            {isNew ? '发布节目' : isOpen ? '改加项 (已发布)' : '编辑节目'}
          </div>
          <button onClick={onClose} className="text-ink-400 text-2xl leading-none">×</button>
        </div>

        {fieldsLocked && (
          <div className="mb-3 rounded-xl bg-warning-500/10 px-3 py-2 text-[11px] text-warning-500">
            已发布的节目仅可改加项 + 套餐说明 · 时段/类型/价格已锁定
          </div>
        )}

        {/* 服务类型 */}
        <Field label="服务类型">
          <select
            value={categoryCode}
            disabled={fieldsLocked}
            onChange={(e) => setCategoryCode(e.target.value)}
            className="w-full rounded-xl border border-warm-200 bg-white px-3 py-2 text-[14px] disabled:bg-warm-50"
          >
            {categories.map((c) => (
              <option key={c.code} value={c.code}>{c.iconEmoji} {c.nameZh}</option>
            ))}
          </select>
        </Field>

        {/* 时段 */}
        <div className="grid grid-cols-2 gap-2">
          <Field label="日期">
            <input
              type="date"
              value={startDate}
              disabled={fieldsLocked}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-xl border border-warm-200 px-3 py-2 text-[14px] disabled:bg-warm-50"
            />
          </Field>
          <Field label="开始时间">
            <input
              type="time"
              value={startTime}
              disabled={fieldsLocked}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-xl border border-warm-200 px-3 py-2 text-[14px] disabled:bg-warm-50"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label="时长">
            <select
              value={durationMin}
              disabled={fieldsLocked}
              onChange={(e) => setDurationMin(parseInt(e.target.value, 10))}
              className="w-full rounded-xl border border-warm-200 px-3 py-2 text-[14px] disabled:bg-warm-50"
            >
              {DURATIONS.map((d) => <option key={d} value={d}>{d}分钟</option>)}
            </select>
          </Field>
          <Field label="价格(积分)">
            <input
              type="number"
              value={pricePoints}
              disabled={fieldsLocked}
              onChange={(e) => setPricePoints(Math.max(1, parseInt(e.target.value, 10) || 1))}
              min={1}
              max={99999}
              className="w-full rounded-xl border border-warm-200 px-3 py-2 text-[14px] disabled:bg-warm-50"
            />
          </Field>
          <Field label="名额">
            <input
              type="number"
              value={slotsTotal}
              disabled={fieldsLocked}
              onChange={(e) => setSlotsTotal(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)))}
              min={1}
              max={10}
              className="w-full rounded-xl border border-warm-200 px-3 py-2 text-[14px] disabled:bg-warm-50"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="服务城市">
            <input
              type="text"
              value={serviceCity}
              disabled={fieldsLocked}
              onChange={(e) => setServiceCity(e.target.value)}
              placeholder="曼谷 / 吉隆坡 / ..."
              className="w-full rounded-xl border border-warm-200 px-3 py-2 text-[14px] disabled:bg-warm-50"
            />
          </Field>
          <Field label="区域">
            <input
              type="text"
              value={serviceArea}
              disabled={fieldsLocked}
              onChange={(e) => setServiceArea(e.target.value)}
              placeholder="Asok / 中央区 / ..."
              className="w-full rounded-xl border border-warm-200 px-3 py-2 text-[14px] disabled:bg-warm-50"
            />
          </Field>
        </div>

        {/* 含项 / 不含项 */}
        <Field label="套餐含项">
          <textarea
            value={includesNote}
            onChange={(e) => setIncludesNote(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-warm-200 px-3 py-2 text-[13px]"
          />
        </Field>
        <Field label="套餐不含项">
          <textarea
            value={excludesNote}
            onChange={(e) => setExcludesNote(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-warm-200 px-3 py-2 text-[13px]"
          />
        </Field>

        {/* 加项编辑器 */}
        <Field label={`加项 (${addOns.length})`}>
          <div className="space-y-2">
            {addOns.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={a.name}
                  onChange={(e) => updateAddOn(i, { name: e.target.value })}
                  placeholder="精油升级 / 拔罐 / ..."
                  className="flex-1 rounded-xl border border-warm-200 px-3 py-2 text-[13px]"
                />
                <input
                  type="number"
                  value={a.pricePoints}
                  onChange={(e) => updateAddOn(i, { pricePoints: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                  className="w-20 rounded-xl border border-warm-200 px-3 py-2 text-[13px]"
                />
                <button
                  type="button"
                  onClick={() => removeAddOn(i)}
                  className="text-danger-500 px-2 text-[18px]"
                >×</button>
              </div>
            ))}
            <button
              type="button"
              onClick={addAddOn}
              className="w-full rounded-xl border border-dashed border-warm-300 py-2 text-[12px] text-warm-700 active:bg-warm-50"
            >+ 添加加项</button>
          </div>
        </Field>

        {/* CTA */}
        <div className="mt-5 flex gap-2 sticky bottom-0 bg-white pt-2">
          {isNew && (
            <>
              <button
                onClick={() => void handleSave(false)}
                disabled={busy}
                className="flex-1 rounded-2xl border border-warm-300 py-3 text-[14px] font-medium text-ink-700 active:bg-warm-50 disabled:opacity-50"
              >草稿保存</button>
              <button
                onClick={() => void handleSave(true)}
                disabled={busy}
                className="flex-1 rounded-2xl bg-gradient-cta py-3 text-[14px] font-semibold text-white active:scale-95 disabled:opacity-50"
              >直接发布</button>
            </>
          )}
          {!isNew && (
            <button
              onClick={() => void handleSave(false)}
              disabled={busy}
              className="flex-1 rounded-2xl bg-gradient-cta py-3 text-[14px] font-semibold text-white active:scale-95 disabled:opacity-50"
            >{busy ? '保存中…' : '保存'}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[11px] font-medium text-ink-600">{label}</div>
      {children}
    </div>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
