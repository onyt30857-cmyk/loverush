'use client';

/**
 * 真人核验队列 · admin 直接看 therapists 表(独立 KYC 通道)
 *
 * 与 /audit 区别:
 * - /audit = M11 通用审核工单(媒体/profile),走 contentAuditRecords
 * - /verifications = 技师真人核验专用,直接看 therapists.verification_status
 *   + 内嵌 liveness 视频/短视频直接预览,审核效率高
 *
 * 审批通过 → 技师变为可被推荐;拒绝 → 技师收到通知后可重新提交
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface VerificationRow {
  user_id: string;
  display_name: string | null;
  email: string | null;
  verification_status: 'pending' | 'in_review' | 'passed' | 'failed';
  liveness_video_url: string | null;
  short_video_url: string | null;
  nationality: string | null;
  service_city: string | null;
  service_area: string | null;
  realness_check_last_at: string | null;
  verified_at: string | null;
  created_at: string;
}

type Tab = 'pending' | 'passed' | 'failed' | 'all';

const TAB_LABEL: Record<Tab, string> = {
  pending: '待审 (pending + in_review)',
  passed: '已通过',
  failed: '已拒绝',
  all: '全部',
};

const STATUS_META: Record<VerificationRow['verification_status'], { label: string; cls: string }> = {
  pending: { label: '待审', cls: 'bg-yellow-100 text-yellow-700' },
  in_review: { label: '审核中', cls: 'bg-blue-100 text-blue-700' },
  passed: { label: '已通过', cls: 'bg-green-100 text-green-700' },
  failed: { label: '已拒绝', cls: 'bg-rose-100 text-rose-700' },
};

export default function VerificationsPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [list, setList] = useState<VerificationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<VerificationRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectMode, setRejectMode] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const rows = await api.get<VerificationRow[]>('/admin/therapists/verifications', {
        status: tab,
        limit: 100,
      });
      setList(rows);
      setError(null);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function decide(decision: 'approve' | 'reject') {
    if (!active) return;
    if (decision === 'reject' && !rejectReason.trim()) {
      alert('请填写拒绝原因');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/admin/therapists/${active.user_id}/verify`, {
        decision,
        reason: decision === 'reject' ? rejectReason.trim() : undefined,
      });
      setActive(null);
      setRejectMode(false);
      setRejectReason('');
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">真人核验队列</h1>
          <p className="mt-1 text-sm text-ink-500">技师 KYC · liveness 视频审核 → 通过后才可被推荐</p>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="mb-4 flex gap-1 border-b border-ink-100">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`relative px-4 py-2 text-sm transition ${
              tab === t
                ? 'font-semibold text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary'
                : 'text-ink-500 hover:text-ink-700'
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {/* 队列表 */}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>技师</th>
              <th>状态</th>
              <th>国籍</th>
              <th>服务城市/区</th>
              <th>提交时间</th>
              <th>liveness</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-ink-500">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-ink-500">
                  {tab === 'pending' ? '🎉 当前无待审核验' : '暂无数据'}
                </td>
              </tr>
            )}
            {list.map((r) => {
              const meta = STATUS_META[r.verification_status];
              return (
                <tr key={r.user_id}>
                  <td>
                    <div className="text-sm font-medium">{r.display_name ?? '(未填昵称)'}</div>
                    <div className="font-mono text-[10px] text-ink-400">{r.user_id.slice(0, 12)}…</div>
                  </td>
                  <td>
                    <span className={`rounded px-2 py-0.5 text-xs ${meta.cls}`}>{meta.label}</span>
                  </td>
                  <td className="text-xs">{r.nationality ?? '—'}</td>
                  <td className="text-xs">
                    {r.service_city ?? '—'}
                    {r.service_area && <span className="text-ink-400"> · {r.service_area}</span>}
                  </td>
                  <td className="text-xs">{new Date(r.created_at).toLocaleString('zh-CN')}</td>
                  <td>
                    {r.liveness_video_url ? (
                      <span className="text-xs text-green-700">✓ 有</span>
                    ) : (
                      <span className="text-xs text-rose-500">✗ 缺失</span>
                    )}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setActive(r);
                        setRejectMode(false);
                        setRejectReason('');
                      }}
                      className="btn-primary h-7 px-3 text-xs"
                    >
                      查看 / 裁决
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 详情 + 裁决弹层 */}
      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
          <div className="card max-h-[90vh] w-full max-w-3xl overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold">{active.display_name ?? '(未填昵称)'}</h3>
                <div className="mt-1 font-mono text-xs text-ink-400">{active.user_id}</div>
              </div>
              <button
                type="button"
                onClick={() => setActive(null)}
                className="text-2xl text-ink-400 hover:text-ink-700"
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            {/* 基础信息 */}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Info label="当前状态">
                <span className={`rounded px-2 py-0.5 text-xs ${STATUS_META[active.verification_status].cls}`}>
                  {STATUS_META[active.verification_status].label}
                </span>
              </Info>
              <Info label="邮箱">{active.email ?? '—'}</Info>
              <Info label="国籍">{active.nationality ?? '—'}</Info>
              <Info label="服务区">
                {active.service_city ?? '—'} {active.service_area && `· ${active.service_area}`}
              </Info>
              <Info label="提交时间">{new Date(active.created_at).toLocaleString('zh-CN')}</Info>
              <Info label="最近核验">
                {active.realness_check_last_at
                  ? new Date(active.realness_check_last_at).toLocaleString('zh-CN')
                  : '—'}
              </Info>
            </dl>

            {/* 视频证据 */}
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <VideoBox label="真人 liveness 视频 · 必看" url={active.liveness_video_url} required />
              <VideoBox label="短视频 (可选展示)" url={active.short_video_url} />
            </div>

            {/* 裁决区 */}
            <div className="mt-6 border-t border-ink-100 pt-4">
              {!rejectMode ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void decide('approve')}
                    disabled={busy || !active.liveness_video_url || active.verification_status === 'passed'}
                    className="btn-primary flex-1"
                  >
                    {active.verification_status === 'passed' ? '已通过' : '✓ 通过核验'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectMode(true)}
                    disabled={busy || active.verification_status === 'failed'}
                    className="btn-danger flex-1"
                  >
                    {active.verification_status === 'failed' ? '已拒绝' : '✗ 拒绝'}
                  </button>
                </div>
              ) : (
                <div>
                  <label className="text-sm font-medium">拒绝原因 (技师可见)</label>
                  <textarea
                    className="mt-2 h-24 w-full rounded-lg border border-ink-100 p-3 text-sm"
                    placeholder="例:liveness 视频模糊无法辨认 / 与短视频不符 / 视频中出现第二人 ..."
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRejectMode(false);
                        setRejectReason('');
                      }}
                      className="btn-ghost flex-1"
                    >
                      返回
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide('reject')}
                      disabled={busy || !rejectReason.trim()}
                      className="btn-danger flex-1"
                    >
                      确认拒绝
                    </button>
                  </div>
                </div>
              )}
              {!active.liveness_video_url && !rejectMode && (
                <p className="mt-2 text-xs text-rose-500">
                  ⚠ 该技师未提交 liveness 视频,无法通过 (拒绝并要求补交)
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function VideoBox({ label, url, required }: { label: string; url: string | null; required?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-xs text-ink-500">
        {label} {required && <span className="text-rose-500">*</span>}
      </div>
      {url ? (
        <video
          controls
          src={url}
          className="w-full rounded-lg bg-black"
          style={{ maxHeight: 360 }}
        >
          您的浏览器不支持视频播放,请<a href={url} target="_blank" rel="noreferrer" className="underline">点此下载</a>
        </video>
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-ink-200 text-xs text-ink-400">
          未提交
        </div>
      )}
    </div>
  );
}
