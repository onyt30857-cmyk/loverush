'use client';

/**
 * AI 红线监控 · 合规底盘
 *
 * 5 类红线(contact_off_platform / payment_off_platform / fake_memory / minor / illegal)
 * 4 种处置(block 完全拦截 / rewrite 改写后发 / warn 警告 / pass 放行)
 *
 * 关键洞察:同一技师反复触发同 flag = 屡犯,需要风控介入
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface FlagStat {
  flag: string;
  d1: number;
  d7: number;
  d30: number;
  blocked: number;
  rewritten: number;
  warned: number;
  passed: number;
}

interface TopTherapist {
  therapist_user_id: string;
  display_name: string | null;
  total: number;
  blocked: number;
  flags_hit: string[];
}

interface Overview {
  range_days: number;
  by_flag: FlagStat[];
  top_repeat_therapists: TopTherapist[];
  generated_at: string;
}

interface LogRow {
  id: string;
  therapist_user_id: string;
  therapist_name: string | null;
  stage: string;
  flag: string;
  action: string;
  candidate_text: string | null;
  context_text: string | null;
  rewritten_text: string | null;
  confidence: number;
  created_at: string;
}

const FLAG_META: Record<string, { label: string; severity: 'critical' | 'high' | 'medium' }> = {
  contact_off_platform: { label: '脱平台联系方式', severity: 'critical' },
  payment_off_platform: { label: '脱平台支付', severity: 'critical' },
  fake_memory: { label: '虚假记忆', severity: 'high' },
  minor: { label: '未成年内容', severity: 'critical' },
  illegal: { label: '违法内容', severity: 'critical' },
};

const ACTION_META: Record<string, { label: string; cls: string }> = {
  block: { label: '拦截', cls: 'bg-rose-100 text-rose-700' },
  rewrite: { label: '改写', cls: 'bg-amber-100 text-amber-700' },
  warn: { label: '警告', cls: 'bg-yellow-100 text-yellow-700' },
  pass: { label: '放行', cls: 'bg-ink-100 text-ink-600' },
};

export default function AiRedlinePage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [filterFlag, setFilterFlag] = useState<string>('');
  const [filterAction, setFilterAction] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Overview>('/admin/ai/redline/overview', { range_days: 7 })
      .then(setOverview)
      .catch((err) => {
        if (err instanceof ApiClientError) setError(err.payload.message);
      });
  }, []);

  useEffect(() => {
    api
      .get<LogRow[]>('/admin/ai/redline/logs', {
        flag: filterFlag || undefined,
        action: filterAction || undefined,
        limit: 100,
      })
      .then(setLogs)
      .catch((err) => {
        if (err instanceof ApiClientError) setError(err.payload.message);
      });
  }, [filterFlag, filterAction]);

  return (
    <AdminShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">AI 红线监控</h1>
        <p className="mt-1 text-xs text-ink-500">
          AI 分身 5 类红线检测日志 · 合规底盘
        </p>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {/* 红线触发统计 */}
      {overview && (
        <>
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold text-ink-700">各类红线触发(近 30 天)</h2>
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th className="text-right">24h</th>
                    <th className="text-right">7d</th>
                    <th className="text-right">30d</th>
                    <th className="text-right">拦截</th>
                    <th className="text-right">改写</th>
                    <th className="text-right">警告</th>
                    <th className="text-right">放行</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.by_flag.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-ink-500">
                        🎉 近 30 天无红线触发
                      </td>
                    </tr>
                  )}
                  {overview.by_flag.map((f) => {
                    const meta = FLAG_META[f.flag] ?? { label: f.flag, severity: 'medium' as const };
                    return (
                      <tr key={f.flag}>
                        <td>
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${
                                meta.severity === 'critical'
                                  ? 'bg-rose-500'
                                  : meta.severity === 'high'
                                    ? 'bg-amber-500'
                                    : 'bg-yellow-500'
                              }`}
                            />
                            <span className="font-medium">{meta.label}</span>
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-ink-400">{f.flag}</div>
                        </td>
                        <td className="text-right font-mono">{f.d1.toLocaleString()}</td>
                        <td className="text-right font-mono">{f.d7.toLocaleString()}</td>
                        <td className="text-right font-mono font-semibold">{f.d30.toLocaleString()}</td>
                        <td className="text-right font-mono text-xs text-rose-600">{f.blocked}</td>
                        <td className="text-right font-mono text-xs text-amber-600">{f.rewritten}</td>
                        <td className="text-right font-mono text-xs text-yellow-600">{f.warned}</td>
                        <td className="text-right font-mono text-xs text-ink-500">{f.passed}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* 屡犯技师 Top 10 */}
          {overview.top_repeat_therapists.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-3 text-sm font-semibold text-ink-700">
                🚨 屡犯技师 Top 10(本期 {overview.range_days} 天 · 触发 ≥2 次)
              </h2>
              <div className="card overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>技师</th>
                      <th className="text-right">触发数</th>
                      <th className="text-right">被拦截</th>
                      <th>命中红线</th>
                      <th className="text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.top_repeat_therapists.map((t) => (
                      <tr key={t.therapist_user_id}>
                        <td>
                          <Link
                            href={`/users/therapists/${t.therapist_user_id}`}
                            className="text-rose-600 hover:underline"
                          >
                            {t.display_name ?? t.therapist_user_id.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="text-right font-mono font-semibold">{t.total}</td>
                        <td className="text-right font-mono text-rose-600">{t.blocked}</td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {t.flags_hit.map((f) => (
                              <span key={f} className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700">
                                {FLAG_META[f]?.label ?? f}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="text-right">
                          <Link
                            href={`/risk?subject_user_id=${t.therapist_user_id}`}
                            className="btn-danger inline-flex h-7 items-center px-3 text-xs"
                          >
                            转风控
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {/* 触发日志详情 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-700">触发日志详情</h2>
          <div className="flex gap-2">
            <select
              className="input h-8 w-40 text-xs"
              value={filterFlag}
              onChange={(e) => setFilterFlag(e.target.value)}
            >
              <option value="">全部红线类型</option>
              {Object.entries(FLAG_META).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
            </select>
            <select
              className="input h-8 w-32 text-xs"
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
            >
              <option value="">全部处置</option>
              {Object.entries(ACTION_META).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-3">
          {logs.length === 0 && (
            <div className="card py-8 text-center text-sm text-ink-500">无触发日志</div>
          )}
          {logs.map((l) => (
            <div key={l.id} className="card">
              <div className="mb-2 flex items-center gap-2 text-sm">
                <span className={`rounded px-2 py-0.5 text-xs ${ACTION_META[l.action]?.cls ?? ''}`}>
                  {ACTION_META[l.action]?.label ?? l.action}
                </span>
                <span className="font-medium">{FLAG_META[l.flag]?.label ?? l.flag}</span>
                <span className="text-xs text-ink-400">
                  阶段 {l.stage} · 置信 {l.confidence}%
                </span>
                <span className="ml-auto text-xs text-ink-400">{new Date(l.created_at).toLocaleString('zh-CN')}</span>
              </div>

              <div className="mb-2 text-xs text-ink-500">
                技师:
                <Link href={`/users/therapists/${l.therapist_user_id}`} className="ml-1 text-rose-600 hover:underline">
                  {l.therapist_name ?? l.therapist_user_id.slice(0, 8)}
                </Link>
              </div>

              {l.candidate_text && (
                <div className="mb-2">
                  <div className="mb-1 text-[10px] uppercase text-ink-400">候选文本(原始)</div>
                  <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">{l.candidate_text}</div>
                </div>
              )}

              {l.rewritten_text && (
                <div className="mb-2">
                  <div className="mb-1 text-[10px] uppercase text-ink-400">改写后(实际发送)</div>
                  <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">{l.rewritten_text}</div>
                </div>
              )}

              {l.context_text && (
                <details className="text-xs text-ink-500">
                  <summary className="cursor-pointer">上下文</summary>
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-ink-50 p-2">{l.context_text}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}
