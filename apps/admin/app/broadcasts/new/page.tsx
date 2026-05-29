/**
 * Admin · 新建群发编辑器 · M13 Phase 0
 *
 * 5 段:基础信息 / 受众规则 / 投递配置 / 受众预览 / 提交
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

type AudienceKind = 'all_active' | 'by_city' | 'by_locale' | 'dormant' | 'high_value';

interface AudienceState {
  kind: AudienceKind;
  userType: '' | 'customer' | 'therapist';
  cities: string;     // 逗号分隔
  locales: string;    // 逗号分隔
  daysSince: number;
  minOrders: number;
}

interface PreviewResp {
  count: number;
  sample: Array<{ id: string; displayName: string | null; userType: string }>;
}

export default function NewBroadcastPage() {
  const router = useRouter();

  // 基础信息
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState<'info' | 'important' | 'critical' | 'silent'>('info');
  const [category, setCategory] = useState<'promo' | 'system'>('promo');
  const [deepLink, setDeepLink] = useState('');

  // 受众规则
  const [audience, setAudience] = useState<AudienceState>({
    kind: 'all_active',
    userType: '',
    cities: '',
    locales: 'zh',
    daysSince: 30,
    minOrders: 5,
  });

  // 投递配置
  const [chInApp, setChInApp] = useState(true);
  const [chWebPush, setChWebPush] = useState(true);
  const [bypassPrefs, setBypassPrefs] = useState(false);

  // 预览
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function buildAudienceRule(): Record<string, unknown> {
    const r: Record<string, unknown> = { kind: audience.kind };
    if (audience.userType && audience.kind !== 'high_value') r.userType = audience.userType;
    if (audience.kind === 'by_city') {
      r.cities = audience.cities
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (audience.kind === 'by_locale') {
      r.locales = audience.locales
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (audience.kind === 'dormant') {
      r.daysSince = audience.daysSince;
      r.userType = audience.userType || 'customer';
    } else if (audience.kind === 'high_value') {
      r.minOrders = audience.minOrders;
    }
    return r;
  }

  async function doPreview() {
    setPreviewing(true);
    setError(null);
    try {
      const res = await api.post<PreviewResp>('/admin/broadcasts/preview-audience', {
        audience_rule: buildAudienceRule(),
      });
      setPreview(res);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function saveDraft(thenSend: boolean) {
    if (!preview) {
      setError('请先点"预览受众"看清楚再保存');
      return;
    }
    const channels: string[] = [];
    if (chInApp) channels.push('in_app');
    if (chWebPush) channels.push('web_push');
    if (channels.length === 0) {
      setError('至少选一个投递渠道');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.post<{ id: string }>('/admin/broadcasts', {
        name,
        title,
        body: body || null,
        level,
        category,
        deep_link: deepLink || null,
        audience_rule: buildAudienceRule(),
        channels,
        bypass_user_prefs: bypassPrefs,
      });
      if (thenSend) {
        if (!confirm(`将发送给 ${preview.count} 位用户 · 不可撤回 · 是否继续？`)) {
          router.push('/broadcasts');
          return;
        }
        await api.post(`/admin/broadcasts/${created.id}/send`);
      }
      router.push('/broadcasts');
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">📣 新建群发</h1>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      <div className="space-y-6">
        {/* 1. 基础信息 */}
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">① 基础信息</h2>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-ink-500">内部识别名(运营自用)</label>
              <input
                className="input w-full"
                placeholder="0530-spring-festival-promo"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-500">标题(用户看到)</label>
              <input
                className="input w-full"
                placeholder="春节充值满 1000 送 200"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-500">正文(可选)</label>
              <textarea
                className="h-20 w-full rounded-lg border border-ink-100 p-3 text-sm"
                placeholder="详细文案 · 支持简单换行"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs text-ink-500">分级</label>
                <select
                  className="input w-full"
                  value={level}
                  onChange={(e) => setLevel(e.target.value as typeof level)}
                >
                  <option value="info">info(普通)</option>
                  <option value="important">important(重要)</option>
                  <option value="critical">critical(关键 · 穿透静默)</option>
                  <option value="silent">silent(仅 in_app · 不弹推送)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink-500">类别</label>
                <select
                  className="input w-full"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as typeof category)}
                >
                  <option value="promo">promo(营销)</option>
                  <option value="system">system(系统公告)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink-500">深链(可选)</label>
                <input
                  className="input w-full"
                  placeholder="/me/recharge"
                  value={deepLink}
                  onChange={(e) => setDeepLink(e.target.value)}
                />
              </div>
            </div>
          </div>
        </section>

        {/* 2. 受众规则 */}
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">② 受众规则</h2>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {(['all_active', 'by_locale', 'by_city', 'dormant', 'high_value'] as AudienceKind[]).map((k) => (
                <label
                  key={k}
                  className={`flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-xs ${
                    audience.kind === k
                      ? 'bg-primary text-white'
                      : 'border border-ink-100 bg-white text-ink-700'
                  }`}
                >
                  <input
                    type="radio"
                    className="hidden"
                    checked={audience.kind === k}
                    onChange={() => setAudience({ ...audience, kind: k })}
                  />
                  {k === 'all_active' && '全部活跃'}
                  {k === 'by_locale' && '按语言'}
                  {k === 'by_city' && '按城市(技师)'}
                  {k === 'dormant' && '沉睡用户'}
                  {k === 'high_value' && '高价值客户'}
                </label>
              ))}
            </div>

            {audience.kind !== 'high_value' && (
              <div>
                <label className="mb-1 block text-xs text-ink-500">用户类型(可选)</label>
                <select
                  className="input w-full"
                  value={audience.userType}
                  onChange={(e) => setAudience({ ...audience, userType: e.target.value as AudienceState['userType'] })}
                >
                  <option value="">不限</option>
                  <option value="customer">仅客户</option>
                  <option value="therapist">仅技师</option>
                </select>
              </div>
            )}

            {audience.kind === 'by_locale' && (
              <div>
                <label className="mb-1 block text-xs text-ink-500">locale 列表(逗号分隔)</label>
                <input
                  className="input w-full"
                  placeholder="zh, en, th"
                  value={audience.locales}
                  onChange={(e) => setAudience({ ...audience, locales: e.target.value })}
                />
              </div>
            )}

            {audience.kind === 'by_city' && (
              <div>
                <label className="mb-1 block text-xs text-ink-500">城市列表(逗号分隔 · 仅技师)</label>
                <input
                  className="input w-full"
                  placeholder="曼谷, 清迈"
                  value={audience.cities}
                  onChange={(e) => setAudience({ ...audience, cities: e.target.value })}
                />
              </div>
            )}

            {audience.kind === 'dormant' && (
              <div>
                <label className="mb-1 block text-xs text-ink-500">沉睡天数(N 天未活跃)</label>
                <input
                  type="number"
                  className="input w-full"
                  value={audience.daysSince}
                  onChange={(e) => setAudience({ ...audience, daysSince: Number(e.target.value) || 30 })}
                />
              </div>
            )}

            {audience.kind === 'high_value' && (
              <div>
                <label className="mb-1 block text-xs text-ink-500">订单数下限</label>
                <input
                  type="number"
                  className="input w-full"
                  value={audience.minOrders}
                  onChange={(e) => setAudience({ ...audience, minOrders: Number(e.target.value) || 5 })}
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => void doPreview()}
              className="btn-ghost w-full"
              disabled={previewing}
            >
              {previewing ? '计算中…' : '🔍 预览受众'}
            </button>

            {preview && (
              <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm">
                <div className="font-medium text-blue-800">命中 {preview.count} 位用户</div>
                {preview.sample.length > 0 && (
                  <div className="mt-2 text-xs text-blue-700">
                    样本：
                    {preview.sample
                      .map((s) => `${s.displayName ?? s.id.slice(0, 8)}(${s.userType})`)
                      .join(' · ')}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 3. 投递配置 */}
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">③ 投递配置</h2>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={chInApp} onChange={(e) => setChInApp(e.target.checked)} />
              站内通知(in_app · 强制开)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={chWebPush} onChange={(e) => setChWebPush(e.target.checked)} />
              Web Push 浏览器推送
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm text-red-700">
              <input type="checkbox" checked={bypassPrefs} onChange={(e) => setBypassPrefs(e.target.checked)} />
              ⚠️ 强制投递(穿透用户偏好 · 仅 admin role · 必须 level=critical)
            </label>
          </div>
        </section>

        {/* 4. 提交 */}
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">④ 提交</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void saveDraft(false)}
              className="btn-ghost flex-1"
              disabled={submitting || !preview || !name || !title}
            >
              保存草稿
            </button>
            <button
              type="button"
              onClick={() => void saveDraft(true)}
              className="btn-primary flex-1"
              disabled={submitting || !preview || !name || !title}
            >
              保存并立即发送
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-500">
            必须先预览受众 + 填名称/标题才能提交
          </p>
        </section>
      </div>
    </AdminShell>
  );
}
