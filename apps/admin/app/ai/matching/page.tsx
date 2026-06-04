'use client';

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface MatchStats {
  window: string;
  matchCalls: { total: number; llm: number; rule: number; empty: number; llmRate: number };
  personaCoverage: { withPersona: number; passed: number };
  profileCoverage: { withMasterPref: number; customers: number };
  onboarding: { completed: number; customers: number };
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card">
      <div className="text-xs text-ink-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

export default function MatchingMonitorPage() {
  const [data, setData] = useState<MatchStats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<MatchStats>('/admin/match/stats')
      .then((r) => setData((r as unknown as { data?: MatchStats }).data ?? r))
      .catch((e) => setErr(e instanceof ApiClientError ? e.payload.message : String(e)));
  }, []);

  return (
    <AdminShell>
      {err ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</div>
      ) : !data ? (
        <div className="text-sm text-ink-500">加载中…</div>
      ) : (
        <div className="space-y-5">
          <div>
            <h1 className="text-lg font-semibold">🎯 AI 智能匹配监控</h1>
            <p className="text-xs text-ink-500">
              对话式语义匹配(/match/conversational)· 近 {data.window} · 区别于"派单监控"(订单 dispatch)
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Kpi label="匹配调用(30d)" value={data.matchCalls.total} />
            <Kpi
              label="LLM 语义命中率"
              value={`${data.matchCalls.llmRate}%`}
              sub={`LLM ${data.matchCalls.llm} · 降级 ${data.matchCalls.rule} · 空 ${data.matchCalls.empty}`}
            />
            <Kpi
              label="技师 persona 覆盖"
              value={`${data.personaCoverage.withPersona}/${data.personaCoverage.passed}`}
              sub="已生成 / passed"
            />
            <Kpi
              label="客户画像覆盖"
              value={`${data.profileCoverage.withMasterPref}/${data.profileCoverage.customers}`}
              sub="有画像 / 客户"
            />
            <Kpi
              label="onboarding 完成"
              value={`${data.onboarding.completed}/${data.onboarding.customers}`}
              sub="完成破冰 / 客户"
            />
          </div>
          {data.matchCalls.total === 0 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ⚠ 近 30 天还没有匹配调用记录(M04 刚上线、埋点刚加)· 有用户使用对话匹配后这里才有数据
            </div>
          )}
        </div>
      )}
    </AdminShell>
  );
}
