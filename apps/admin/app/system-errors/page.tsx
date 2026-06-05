'use client';

/**
 * 系统报错监管页 · 聚合 system_errors 表 + 登录异常 risk_events
 *
 * 左侧:系统错误聚合表(同 fingerprint 累加 count)
 * 右侧:登录异常表(暴力破解/异常 IP/封号尝试)
 * 点开每行展开自查表 hint(reason + checkSteps)
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface ErrorHint {
  impact?: string;
  reason: string;
  checkSteps: string[];
  severity?: number;
}

interface SystemError {
  id: string;
  fingerprint: string;
  errorType: string;
  errorCode: string | null;
  httpStatus: number | null;
  route: string | null;
  method: string | null;
  message: string;
  stack: string | null;
  severity: number;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sampleUserId: string | null;
  sampleRequestId: string | null;
  samplePayload: Record<string, unknown>;
  resolvedAt: string | null;
  resolution: string | null;
  hint: ErrorHint | null;
  /** 英文原始报错翻成的人话标题(后端 humanizeMessage) · 匹配不到为 null */
  humanMessage: string | null;
}

/** errorType 技术词 → 中文(运营看得懂) */
const ERROR_TYPE_LABEL: Record<string, string> = {
  server: '后端代码',
  db: '数据库',
  external: '外部服务',
  auth: '登录认证',
  validation: '参数校验',
  rate_limit: '限流',
};

interface RiskEvent {
  id: string;
  subjectUserId: string | null;
  subjectType: string;
  eventType: string;
  severity: number;
  payload: Record<string, unknown>;
  resolvedAt: string | null;
  createdAt: string;
}

const SEVERITY_COLOR = (s: number) => {
  if (s >= 80) return 'bg-rose-100 text-rose-700 border-rose-300';
  if (s >= 60) return 'bg-orange-100 text-orange-700 border-orange-300';
  if (s >= 40) return 'bg-amber-100 text-amber-700 border-amber-300';
  return 'bg-emerald-100 text-emerald-700 border-emerald-300';
};

const SEVERITY_LABEL = (s: number) => {
  if (s >= 80) return '高危';
  if (s >= 60) return '严重';
  if (s >= 40) return '中等';
  return '低';
};

export default function SystemErrorsPage() {
  const [errors, setErrors] = useState<SystemError[]>([]);
  const [loginRisks, setLoginRisks] = useState<RiskEvent[]>([]);
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const [errorType, setErrorType] = useState<string>('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [errs, risks] = await Promise.all([
        api.get<SystemError[]>('/admin/system-errors', {
          unresolved_only: unresolvedOnly ? 'true' : 'false',
          ...(errorType ? { error_type: errorType } : {}),
          limit: 100,
        }),
        api.get<RiskEvent[]>('/admin/system-errors/risk-login'),
      ]);
      setErrors(errs);
      setLoginRisks(risks);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresolvedOnly, errorType]);

  async function resolve(id: string, resolution: 'fixed' | 'wont_fix' | 'duplicate' | 'external') {
    try {
      await api.post(`/admin/system-errors/${id}/resolve`, { resolution });
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  const activeHighSeverity = errors.filter((e) => !e.resolvedAt && e.severity >= 70).length;

  return (
    <AdminShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-ink-900">系统报错与登录异常</h1>
          <div className="flex items-center gap-3 text-xs text-ink-500">
            <span>
              共 {errors.length} 个聚合错误 · 登录异常 {loginRisks.length} 条
            </span>
          </div>
        </div>

        {/* 预警 banner · 高危未解决 */}
        {activeHighSeverity > 0 && (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-rose-700">
              ⚠️ 高危预警 · {activeHighSeverity} 个未解决错误 severity ≥ 70
            </div>
            <p className="mt-1 text-xs text-rose-600">点开下方红色高危行 · 看 hint 自查表跟进</p>
          </div>
        )}

        {error && <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

        {/* === 系统错误聚合表 === */}
        <section className="rounded-xl border border-ink-100 bg-white">
          <div className="flex items-center gap-3 border-b border-ink-100 p-3">
            <h2 className="flex-1 text-sm font-semibold text-ink-900">系统报错聚合</h2>
            <label className="flex items-center gap-2 text-xs text-ink-600">
              <input
                type="checkbox"
                checked={unresolvedOnly}
                onChange={(e) => setUnresolvedOnly(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              只看未解决
            </label>
            <select
              value={errorType}
              onChange={(e) => setErrorType(e.target.value)}
              className="rounded border border-ink-200 px-2 py-1 text-xs"
            >
              <option value="">全部类型</option>
              <option value="server">server 5xx</option>
              <option value="db">db 数据库</option>
              <option value="external">external 外部 API</option>
              <option value="auth">auth 认证</option>
              <option value="validation">validation 参数</option>
            </select>
          </div>

          {errors.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-400">无错误 · 一切正常 ✓</div>
          ) : (
            <div className="divide-y divide-ink-100">
              {errors.map((e) => (
                <div key={e.id} className="p-3 hover:bg-ink-50">
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                    className="w-full text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${SEVERITY_COLOR(e.severity)}`}
                      >
                        {SEVERITY_LABEL(e.severity)} · {e.severity}
                      </span>
                      <span className="rounded bg-ink-100 px-2 py-0.5 text-[10px] font-medium text-ink-600">
                        {ERROR_TYPE_LABEL[e.errorType] ?? e.errorType}
                        {e.httpStatus && ` · ${e.httpStatus}`}
                      </span>
                      <span className="font-mono text-[10px] text-ink-400">
                        {e.method} {e.route}
                        {e.errorCode && ` · ${e.errorCode}`}
                      </span>
                      <span className="ml-auto text-xs text-ink-600">
                        出现 <strong>{e.count}</strong> 次
                      </span>
                      {e.resolvedAt && (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">
                          已 {e.resolution}
                        </span>
                      )}
                    </div>
                    {/* 人话标题(运营看得懂) · 翻不出来就回退展示原始报错 */}
                    <div className="mt-1.5 text-sm font-medium text-ink-900">
                      {e.humanMessage ?? e.message}
                    </div>
                    {/* 运营影响一句话 */}
                    {e.hint?.impact && (
                      <div className="mt-1 flex items-start gap-1 text-xs text-ink-600">
                        <span className="shrink-0 text-ink-400">影响:</span>
                        <span>{e.hint.impact}</span>
                      </div>
                    )}
                    {/* 翻译过的才把英文原文降级展示(没翻译时上面已是原文,不重复) */}
                    {e.humanMessage && (
                      <div className="mt-1 truncate font-mono text-[10px] text-ink-400">
                        原文: {e.message}
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-3 text-[10px] text-ink-400">
                      <span>最近: {new Date(e.lastSeenAt).toLocaleString('zh-CN')}</span>
                      <span>首次: {new Date(e.firstSeenAt).toLocaleString('zh-CN')}</span>
                      <span className="text-ink-300">点击展开看处理建议 ↓</span>
                    </div>
                  </button>

                  {expanded === e.id && (
                    <div className="mt-3 space-y-3 rounded-lg bg-ink-50 p-3 text-xs">
                      {e.hint ? (
                        <div className="rounded border border-amber-200 bg-amber-50 p-3">
                          <div className="mb-2 font-semibold text-amber-800">📖 处理建议</div>
                          {e.hint.impact && (
                            <div className="mb-2">
                              <span className="font-medium text-amber-800">影响:</span>{' '}
                              <span className="text-amber-900">{e.hint.impact}</span>
                            </div>
                          )}
                          <div className="mb-2">
                            <span className="font-medium text-amber-800">大概原因:</span>{' '}
                            <span className="text-amber-900">{e.hint.reason}</span>
                          </div>
                          <div className="mb-1 font-medium text-amber-800">怎么排查:</div>
                          <ol className="ml-4 list-decimal space-y-1 text-amber-800">
                            {e.hint.checkSteps.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ol>
                        </div>
                      ) : (
                        <div className="rounded border border-ink-200 bg-white p-2 text-ink-500">
                          暂无处理建议 · 把下面的「错误栈」和 requestId 发给工程定位
                        </div>
                      )}

                      {e.stack && (
                        <details className="rounded border border-ink-200 bg-white p-2">
                          <summary className="cursor-pointer text-ink-700">错误栈(stack)</summary>
                          <pre className="mt-2 max-h-60 overflow-auto text-[10px] text-ink-700">
                            {e.stack}
                          </pre>
                        </details>
                      )}

                      <div className="flex flex-wrap gap-3 text-ink-600">
                        <span>fingerprint: <code className="font-mono">{e.fingerprint.slice(0, 12)}</code></span>
                        {e.sampleRequestId && <span>requestId: <code className="font-mono">{e.sampleRequestId}</code></span>}
                        {e.sampleUserId && <span>userId: <code className="font-mono">{e.sampleUserId.slice(0, 8)}</code></span>}
                      </div>

                      {!e.resolvedAt && (
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => resolve(e.id, 'fixed')}
                            className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                          >
                            标记已修复
                          </button>
                          <button
                            onClick={() => resolve(e.id, 'wont_fix')}
                            className="rounded bg-ink-200 px-3 py-1 text-xs text-ink-700 hover:bg-ink-300"
                          >
                            不修(wont_fix)
                          </button>
                          <button
                            onClick={() => resolve(e.id, 'duplicate')}
                            className="rounded bg-ink-200 px-3 py-1 text-xs text-ink-700 hover:bg-ink-300"
                          >
                            重复
                          </button>
                          <button
                            onClick={() => resolve(e.id, 'external')}
                            className="rounded bg-ink-200 px-3 py-1 text-xs text-ink-700 hover:bg-ink-300"
                          >
                            外部原因
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* === 登录异常表 === */}
        <section className="rounded-xl border border-ink-100 bg-white">
          <div className="border-b border-ink-100 p-3">
            <h2 className="text-sm font-semibold text-ink-900">登录异常监管</h2>
            <p className="mt-0.5 text-[11px] text-ink-500">
              异常登录自动入库 · login_user_not_found(账号枚举) / login_wrong_password(密码错) /
              login_banned_login_attempt(封号尝试) / login_no_password_set
            </p>
          </div>

          {loginRisks.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-400">近期无登录异常</div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto divide-y divide-ink-100">
              {loginRisks.map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-2.5 text-xs">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${SEVERITY_COLOR(r.severity)}`}>
                    {r.severity}
                  </span>
                  <span className="font-mono text-ink-700">{r.eventType}</span>
                  {r.payload.handle ? (
                    <span className="font-mono text-ink-500">handle={String(r.payload.handle)}</span>
                  ) : null}
                  {r.subjectUserId && (
                    <span className="font-mono text-[10px] text-ink-400">user={r.subjectUserId.slice(0, 8)}</span>
                  )}
                  <span className="ml-auto text-[10px] text-ink-400">
                    {new Date(r.createdAt).toLocaleString('zh-CN')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
