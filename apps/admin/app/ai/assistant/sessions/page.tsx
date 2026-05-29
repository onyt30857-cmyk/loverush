'use client';

/**
 * AI 助理会话回放 · M03 Admin A1
 *
 * 用途:客服 / AI 工程师 / 运营查问题第一现场。
 *      输入客户 ID / 看延迟尾部 / 看 filter 重 sample / 看 cost top → 一键看完整 turn 详情。
 *
 * 数据源:GET /admin/assistant/sessions(列表)+ /turns/:id(单 turn 详情)
 *
 * UX:
 *   - 上方筛选条:客户 ID / scenario / 最小 filter attempts / 时间范围 / 排序
 *   - 中间表格:每行一 turn,关键 metadata 一目了然
 *   - 点行 → 右侧滑面板展开完整 system prompt / raw output / final content / memory snippet
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface TurnRow {
  id: string;
  userId: string;
  sessionId: string | null;
  turnIdx: number;
  scenario: string;
  jokeLevel: number;
  locale: string;
  llmProvider: string | null;
  llmModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsdMicros: number | null;
  filterAttempts: number;
  latencyMs: number;
  createdAt: string;
  userInputPreview: string | null;
  finalContentPreview: string | null;
}

interface TurnDetail extends TurnRow {
  userInput: string | null;
  userInputRaw: string | null;
  memorySnippet: string | null;
  systemPrompt: string | null;
  llmRawOutput: string | null;
  finalContent: string | null;
  seriousMode: number;
  filterFinalSoftScore: number | null;
  filterFinalHardHits: string[] | null;
  user: { id: string; displayName: string | null; userType: string; locale: string } | null;
}

const SCENARIO_LABEL: Record<string, string> = {
  casual: '闲聊',
  selection: '选购',
  after_service: '服务后',
  complaint: '投诉',
  emergency: '严肃',
};

const SCENARIO_TONE: Record<string, string> = {
  casual: 'bg-ink-100 text-ink-700',
  selection: 'bg-emerald-100 text-emerald-700',
  after_service: 'bg-amber-100 text-amber-700',
  complaint: 'bg-rose-100 text-rose-700',
  emergency: 'bg-red-100 text-red-700',
};

function formatCost(micros: number | null): string {
  if (micros == null) return '—';
  const usd = micros / 1_000_000;
  if (usd < 0.01) return `$${(micros / 1000).toFixed(2)}m`;
  return `$${usd.toFixed(4)}`;
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}

export default function AdminAssistantSessionsPage() {
  const [list, setList] = useState<TurnRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 筛选
  const [userIdFilter, setUserIdFilter] = useState('');
  const [scenarioFilter, setScenarioFilter] = useState('');
  const [minAttempts, setMinAttempts] = useState<number | ''>('');
  const [sort, setSort] = useState<'ts' | 'cost' | 'latency' | 'attempts'>('ts');

  // 详情侧滑
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TurnDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .get<TurnRow[]>('/admin/assistant/sessions', {
        user_id: userIdFilter.trim() || undefined,
        scenario: scenarioFilter || undefined,
        min_filter_attempts: minAttempts || undefined,
        sort,
        limit: 100,
      })
      .then((data) => {
        setList(data);
        setError(null);
      })
      .catch((err) => {
        if (err instanceof ApiClientError) setError(err.payload.message);
        else setError('网络错误');
      })
      .finally(() => setLoading(false));
  }, [userIdFilter, scenarioFilter, minAttempts, sort]);

  // 拉详情
  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    api
      .get<TurnDetail>(`/admin/assistant/sessions/turns/${detailId}`)
      .then(setDetail)
      .catch((err) => {
        if (err instanceof ApiClientError) setError(err.payload.message);
      })
      .finally(() => setDetailLoading(false));
  }, [detailId]);

  return (
    <AdminShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">AI 助理会话回放</h1>
        <p className="mt-1 text-xs text-ink-500">
          M03 客户助理对话日志 · 客服查问题第一现场 · 显示 user input、注入 memory/voice、LLM raw、filter 重 sample、最终内容
        </p>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {/* 筛选条 */}
      <section className="card mb-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs text-ink-500">客户 UID</label>
            <input
              type="text"
              className="input w-full font-mono text-xs"
              placeholder="按客户 UUID 精确筛"
              value={userIdFilter}
              onChange={(e) => setUserIdFilter(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-500">场景</label>
            <select
              className="input w-full"
              value={scenarioFilter}
              onChange={(e) => setScenarioFilter(e.target.value)}
            >
              <option value="">全部</option>
              <option value="casual">闲聊</option>
              <option value="selection">选购</option>
              <option value="after_service">服务后</option>
              <option value="complaint">投诉</option>
              <option value="emergency">严肃</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-500">最小重 sample 次数</label>
            <select
              className="input w-full"
              value={minAttempts}
              onChange={(e) => setMinAttempts(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">全部</option>
              <option value="2">≥ 2 次</option>
              <option value="3">≥ 3 次(Bad case)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink-500">排序</label>
            <select className="input w-full" value={sort} onChange={(e) => setSort(e.target.value as never)}>
              <option value="ts">时间倒序</option>
              <option value="cost">花费高 → 低</option>
              <option value="latency">慢 → 快</option>
              <option value="attempts">重 sample 多 → 少</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="btn-ghost w-full"
              onClick={() => {
                setUserIdFilter('');
                setScenarioFilter('');
                setMinAttempts('');
                setSort('ts');
              }}
            >
              清空筛选
            </button>
          </div>
        </div>
      </section>

      {/* 主表格 */}
      <section className="card overflow-x-auto">
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-ink-500">加载中…</div>
        ) : list.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-ink-500">没有匹配的对话</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>客户 / Turn</th>
                <th>场景</th>
                <th>locale</th>
                <th>模型</th>
                <th className="text-right">Tokens</th>
                <th className="text-right">花费</th>
                <th className="text-right">延迟</th>
                <th className="text-right">重 sample</th>
                <th>预览</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const tone = SCENARIO_TONE[r.scenario] ?? 'bg-ink-100 text-ink-700';
                const isBad = r.filterAttempts >= 3;
                return (
                  <tr
                    key={r.id}
                    className={`cursor-pointer hover:bg-ink-50 ${detailId === r.id ? 'bg-rose-50' : ''}`}
                    onClick={() => setDetailId(r.id)}
                  >
                    <td className="text-xs text-ink-600 whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })}
                    </td>
                    <td>
                      <div className="font-mono text-xs">{shortId(r.userId)}</div>
                      <div className="text-[10px] text-ink-400">turn #{r.turnIdx}</div>
                    </td>
                    <td>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>
                        {SCENARIO_LABEL[r.scenario] ?? r.scenario}
                      </span>
                      <span className="ml-1 text-[10px] text-ink-400">😄 {r.jokeLevel}</span>
                    </td>
                    <td className="text-xs">{r.locale}</td>
                    <td className="text-xs">
                      <div className="text-ink-700">{r.llmProvider ?? '—'}</div>
                      <div className="text-[10px] text-ink-400">{r.llmModel ?? '—'}</div>
                    </td>
                    <td className="text-right text-xs">
                      {r.inputTokens != null && r.outputTokens != null
                        ? `${r.inputTokens} → ${r.outputTokens}`
                        : '—'}
                    </td>
                    <td className="text-right text-xs">{formatCost(r.costUsdMicros)}</td>
                    <td className="text-right text-xs">{formatLatency(r.latencyMs)}</td>
                    <td className="text-right">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          isBad
                            ? 'bg-rose-100 text-rose-700'
                            : r.filterAttempts === 2
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-ink-100 text-ink-600'
                        }`}
                      >
                        {r.filterAttempts}
                      </span>
                    </td>
                    <td className="max-w-[280px]">
                      <div className="truncate text-xs text-ink-800">{r.userInputPreview ?? '—'}</div>
                      <div className="truncate text-[10px] text-ink-400">→ {r.finalContentPreview ?? '—'}</div>
                    </td>
                    <td>
                      <button type="button" className="text-xs text-rose-600 hover:underline">
                        详情
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* 详情侧滑 */}
      {detailId && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailId(null);
          }}
        >
          <div className="absolute inset-0 bg-black/30" />
          <aside className="relative ml-auto h-full w-full max-w-[680px] overflow-y-auto bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Turn 详情</h2>
              <button
                type="button"
                onClick={() => setDetailId(null)}
                className="rounded-full px-3 py-1 text-sm text-ink-500 hover:bg-ink-100"
              >
                关闭
              </button>
            </div>

            {detailLoading || !detail ? (
              <div className="text-center text-sm text-ink-500">加载中…</div>
            ) : (
              <div className="space-y-5 text-sm">
                {/* Metadata 卡片 */}
                <section className="rounded-xl border border-ink-100 bg-ink-50 p-3">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-ink-500">客户:</span>
                      <span className="ml-1 font-mono">{detail.userId}</span>
                    </div>
                    <div>
                      <span className="text-ink-500">Session:</span>
                      <span className="ml-1 font-mono">{detail.sessionId ?? '—'}</span>
                    </div>
                    <div>
                      <span className="text-ink-500">Turn #</span>
                      <span className="ml-1 font-mono">{detail.turnIdx}</span>
                    </div>
                    <div>
                      <span className="text-ink-500">时间:</span>
                      <span className="ml-1">{new Date(detail.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                    </div>
                    <div>
                      <span className="text-ink-500">场景:</span>
                      <span className="ml-1">
                        {SCENARIO_LABEL[detail.scenario] ?? detail.scenario} · 玩笑度 {detail.jokeLevel} ·{' '}
                        {detail.seriousMode ? '严肃模式' : '常规'}
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-500">locale:</span>
                      <span className="ml-1">{detail.locale}</span>
                    </div>
                    <div>
                      <span className="text-ink-500">模型:</span>
                      <span className="ml-1">
                        {detail.llmProvider ?? '—'} / {detail.llmModel ?? '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-500">Tokens:</span>
                      <span className="ml-1">
                        {detail.inputTokens ?? '—'} → {detail.outputTokens ?? '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-500">花费:</span>
                      <span className="ml-1">{formatCost(detail.costUsdMicros)}</span>
                    </div>
                    <div>
                      <span className="text-ink-500">延迟:</span>
                      <span className="ml-1">{formatLatency(detail.latencyMs)}</span>
                    </div>
                    <div>
                      <span className="text-ink-500">重 sample:</span>
                      <span className="ml-1">
                        {detail.filterAttempts} 次 ·{' '}
                        {detail.filterFinalHardHits?.length
                          ? `命中 ${detail.filterFinalHardHits.join(' / ')}`
                          : 'clean'}
                      </span>
                    </div>
                  </div>
                </section>

                {/* User input */}
                <section>
                  <div className="mb-1 text-xs font-semibold text-ink-500">用户输入(脱敏后)</div>
                  <pre className="whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-xs text-ink-800 ring-1 ring-ink-100">
                    {detail.userInput ?? '— 无权限或为空 —'}
                  </pre>
                  {detail.userInputRaw && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] text-ink-400">
                        原始输入(含敏感词)
                      </summary>
                      <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
                        {detail.userInputRaw}
                      </pre>
                    </details>
                  )}
                </section>

                {/* Memory 注入 */}
                <section>
                  <div className="mb-1 text-xs font-semibold text-ink-500">注入的 Memory 摘要</div>
                  <pre className="whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-xs text-ink-800 ring-1 ring-ink-100">
                    {detail.memorySnippet ?? '— 空 —'}
                  </pre>
                </section>

                {/* System prompt */}
                <section>
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-ink-500">
                      System Prompt(点击展开)· {detail.systemPrompt?.length ?? 0} 字符
                    </summary>
                    <pre className="mt-1 max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-ink-50 p-3 text-[11px] text-ink-700 ring-1 ring-ink-100">
                      {detail.systemPrompt ?? '— 无权限 —'}
                    </pre>
                  </details>
                </section>

                {/* LLM raw */}
                <section>
                  <div className="mb-1 text-xs font-semibold text-ink-500">
                    LLM Raw Output{' '}
                    {detail.filterAttempts > 1 && (
                      <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                        经过 {detail.filterAttempts} 次重 sample
                      </span>
                    )}
                  </div>
                  <pre className="whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-xs text-ink-800 ring-1 ring-ink-100">
                    {detail.llmRawOutput ?? '— 空 —'}
                  </pre>
                </section>

                {/* Final content */}
                <section>
                  <div className="mb-1 text-xs font-semibold text-rose-700">最终给客户的内容</div>
                  <pre className="whitespace-pre-wrap break-words rounded-lg bg-rose-50 p-3 text-xs text-ink-800 ring-1 ring-rose-200">
                    {detail.finalContent ?? '— 无权限 —'}
                  </pre>
                </section>
              </div>
            )}
          </aside>
        </div>
      )}
    </AdminShell>
  );
}
