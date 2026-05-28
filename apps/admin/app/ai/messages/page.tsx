'use client';

/**
 * AI 代发审计 · 看 AI 替技师说了什么
 *
 * 关键能力:
 *   - 全量 AI 代发原文(JOIN messages.content_original)
 *   - SimHash 重复度 flag:同技师同 hash >= 3 次 = "复读机"
 *   - 按 scenario / 技师 / 有无红线 筛选
 *   - 单条详情:输入/输出 tokens / cost / prompt_version
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface AiMsg {
  id: string;
  therapist_user_id: string;
  therapist_name: string | null;
  scenario: string;
  provider: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd_micros: number | null;
  simhash: number | null;
  redline_flags: string[] | null;
  prompt_version: string;
  created_at: string;
  message_content: string | null;
  conversation_id: string | null;
  sender_user_id: string | null;
  simhash_repeat_count: number;
}

const SCENARIO_LABEL: Record<string, string> = {
  greeting: '问候',
  price_inquiry: '价格咨询',
  book_intent: '预订意向',
  smalltalk: '闲聊',
  sensitive_redirect: '敏感引导',
  follow_up: '回访',
  apology: '致歉',
};

export default function AiMessagesPage() {
  const [list, setList] = useState<AiMsg[]>([]);
  const [filterScenario, setFilterScenario] = useState('');
  const [filterRedline, setFilterRedline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AiMsg[]>('/admin/ai/messages', {
        scenario: filterScenario || undefined,
        has_redline: filterRedline ? true : undefined,
        limit: 100,
      })
      .then(setList)
      .catch((err) => {
        if (err instanceof ApiClientError) setError(err.payload.message);
      });
  }, [filterScenario, filterRedline]);

  return (
    <AdminShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">AI 代发审计</h1>
        <p className="mt-1 text-xs text-ink-500">
          全量 AI 分身代发记录 + 原文 + SimHash 重复度
        </p>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {/* 筛选区 */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select
            className="input w-44"
            value={filterScenario}
            onChange={(e) => setFilterScenario(e.target.value)}
          >
            <option value="">全部场景</option>
            {Object.entries(SCENARIO_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={filterRedline}
              onChange={(e) => setFilterRedline(e.target.checked)}
            />
            <span>仅看触发红线</span>
          </label>
          <div className="ml-auto text-xs text-ink-500">共 {list.length} 条</div>
        </div>
      </div>

      {/* 列表 */}
      <div className="space-y-3">
        {list.length === 0 && (
          <div className="card py-8 text-center text-sm text-ink-500">无 AI 代发记录</div>
        )}
        {list.map((m) => {
          const cost = (m.cost_usd_micros ?? 0) / 1_000_000;
          const isRepeat = m.simhash_repeat_count >= 3;
          const hasRedline = (m.redline_flags?.length ?? 0) > 0;
          return (
            <div key={m.id} className="card">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                  {SCENARIO_LABEL[m.scenario] ?? m.scenario}
                </span>
                <span className="font-mono text-xs text-ink-500">
                  {m.provider}/{m.model}
                </span>
                {hasRedline && (
                  <span className="rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-700">
                    ⚠ 触发红线: {m.redline_flags?.join(', ')}
                  </span>
                )}
                {isRepeat && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                    🔁 复读机 ({m.simhash_repeat_count}x 重复)
                  </span>
                )}
                <span className="ml-auto text-xs text-ink-400">
                  {new Date(m.created_at).toLocaleString('zh-CN')}
                </span>
              </div>

              {/* 原文 */}
              {m.message_content && (
                <div className="mb-2 rounded-lg bg-ink-50 px-3 py-2 text-sm">{m.message_content}</div>
              )}

              {/* 元信息 */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-ink-500">
                <span>
                  技师:
                  <Link
                    href={`/users/therapists/${m.therapist_user_id}`}
                    className="ml-1 text-rose-600 hover:underline"
                  >
                    {m.therapist_name ?? m.therapist_user_id.slice(0, 8)}
                  </Link>
                </span>
                <span>
                  tokens{' '}
                  <span className="font-mono">
                    {m.input_tokens ?? 0}↓ / {m.output_tokens ?? 0}↑
                  </span>
                </span>
                <span>
                  cost <span className="font-mono">${cost.toFixed(5)}</span>
                </span>
                <span>
                  prompt <span className="font-mono">{m.prompt_version}</span>
                </span>
                {m.simhash !== null && (
                  <span>
                    simhash <span className="font-mono text-[10px]">{String(m.simhash).slice(0, 12)}…</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </AdminShell>
  );
}
