'use client';

/**
 * AI 分身 · 系统约束（重设计版）
 *
 * 结构:
 *   1. 顶部标题 + 工作流程条
 *   2. 「可调参数」区 —— 按 group 分小节，每参数一张可编辑卡（POST/DELETE API）
 *   3. 「只读约束」区 —— 长期记忆/护栏/红线/质检/版本/供应商，灰「只读」标
 *   4. 后台自动任务表 + 护栏清单
 */

import { useEffect, useRef, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

// ── 类型定义 ──────────────────────────────────────────────────────────────

interface SystemInfo {
  promptVersion: string;
  params: {
    offlineThresholdMin: number;
    historyWindow: number;
    temperature: number;
    maxTokens: number;
    maxReplyChars: number;
    maxRegenerate: number;
    simhashHammingThreshold: number;
    replyDelayMinMs: number;
    replyDelayMaxMs: number;
    deepNightMultMax: number;
  };
  llm: { tier: string; providers: string[] };
  redline: { categories: string[]; hardBlock: string[] };
  validate: { checks: string[] };
  jobs: Record<string, { enabled: boolean; intervalMin?: number; desc: string }>;
  guardrails: Array<{
    key: string;
    label: string;
    desc: string;
    kind: string;
    monitored: boolean;
    since: string;
  }>;
}

interface Tunable {
  key: string;
  label: string;
  group: string;
  default: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  isFloat: boolean;
  current: number;
  isOverridden: boolean;
}

// ── 常量 ──────────────────────────────────────────────────────────────────

const GROUP_ORDER = ['节奏触发', '记忆', '输出与稳定', '质检'];

const GROUP_META: Record<string, { label: string; desc: string }> = {
  节奏触发: { label: '节奏 · 触发', desc: '控制 AI 何时出现、以什么节奏回复' },
  记忆: { label: '记忆', desc: '上下文窗口大小，影响 AI 能看多少对话历史' },
  输出与稳定: { label: '输出 · 稳定', desc: '回复字数、token 上限、稳定性温度' },
  质检: { label: '质检', desc: '自动检测重生成的最大次数' },
};

const TUNABLE_DESC: Record<string, string> = {
  offlineThresholdMin: '技师离线超过此时长后 AI 才接管回复，0 = 立即接管',
  replyDelayMinMs: '每条消息发出前的最短随机延迟（毫秒），模拟真人思考',
  replyDelayMaxMs: '每条消息发出前的最长随机延迟（毫秒），实际延迟在 min–max 之间随机',
  historyWindow: 'AI 每次生成时读取的最近 N 条消息，超出窗口的历史不可见',
  maxReplyChars: '单条回复字数上限，超过会被截断重写',
  maxTokens: '单次 LLM 调用最大 token 数（含输出），影响成本与回复长度',
  temperature: '数值越高越发散/活泼，越低越稳定/保守（0–1）',
  maxRegenerate: '校验不通过时最多重新生成几次，超过后该条直接不发',
};

const KIND_LABEL: Record<string, string> = {
  hard_block: '直接拦截',
  rewrite: '自动改写',
  output_check: '校验重生成',
  grounding: '注入真实数据',
  prompt: '提示约束',
};

const KIND_STYLE: Record<string, string> = {
  hard_block: 'bg-red-50 text-red-700',
  rewrite: 'bg-amber-50 text-amber-700',
  output_check: 'bg-blue-50 text-blue-700',
  grounding: 'bg-violet-50 text-violet-700',
  prompt: 'bg-ink-100 text-ink-500',
};

// ── 工具组件 ──────────────────────────────────────────────────────────────

function Arrow() {
  return <span className="mx-1.5 text-ink-300">→</span>;
}

function SectionHeading({
  label,
  desc,
  badge,
}: {
  label: string;
  desc?: React.ReactNode;
  badge?: string;
}) {
  return (
    <div className="mb-4 flex items-end justify-between border-b border-ink-100 pb-2">
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-300">
          {label}
        </h2>
        {desc && <p className="mt-0.5 text-xs text-ink-500">{desc}</p>}
      </div>
      {badge && <span className="text-[10px] text-ink-300">{badge}</span>}
    </div>
  );
}

function ReadRow({
  label,
  v,
  tone,
}: {
  label: string;
  v: string;
  tone?: 'ok' | 'warn' | 'action';
}) {
  const labelColor =
    tone === 'ok'
      ? 'text-green-600'
      : tone === 'warn'
      ? 'text-amber-600'
      : tone === 'action'
      ? 'text-indigo-500'
      : 'text-ink-300';
  return (
    <div className="flex gap-2">
      <dt className={`w-14 shrink-0 font-medium ${labelColor}`}>{label}</dt>
      <dd className="text-ink-500">{v}</dd>
    </div>
  );
}

// ── 只读卡 ────────────────────────────────────────────────────────────────

function ReadonlyCard({
  title,
  value,
  what,
  why,
  normal,
  abnormal,
  howto,
}: {
  title: string;
  value: string;
  what: string;
  why: string;
  normal: string;
  abnormal: string;
  howto: string;
}) {
  return (
    <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink-700">{title}</span>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <span className="rounded-full bg-ink-100 px-2.5 py-px text-[10px] font-medium text-ink-500">
            只读 · 改需发版
          </span>
          <span className="rounded-full border border-ink-100 bg-white px-2.5 py-1 text-[11px] font-medium text-ink-700">
            {value}
          </span>
        </div>
      </div>
      <dl className="mt-2.5 space-y-1.5 text-xs leading-5">
        <ReadRow label="是什么" v={what} />
        <ReadRow label="为什么" v={why} />
        <ReadRow label="正常范围" v={normal} tone="ok" />
        <ReadRow label="异常信号" v={abnormal} tone="warn" />
        <ReadRow label="怎么处理" v={howto} tone="action" />
      </dl>
    </div>
  );
}

// ── 可编辑卡 ──────────────────────────────────────────────────────────────

type SaveState = 'idle' | 'loading' | 'ok' | 'err';

function TunableCard({
  t,
  onSaved,
}: {
  t: Tunable;
  onSaved: () => void;
}) {
  const [localValue, setLocalValue] = useState<number>(t.current);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errMsg, setErrMsg] = useState('');
  const okTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalValue(t.current);
  }, [t.current]);

  useEffect(() => {
    return () => {
      if (okTimer.current) clearTimeout(okTimer.current);
    };
  }, []);

  const isDirty = localValue !== t.current;

  async function handleSave() {
    setSaveState('loading');
    setErrMsg('');
    try {
      await api.post('/admin/ai-system/tunables', { key: t.key, value: localValue });
      setSaveState('ok');
      onSaved();
      okTimer.current = setTimeout(() => setSaveState('idle'), 2500);
    } catch (e) {
      setSaveState('err');
      setErrMsg(e instanceof ApiClientError ? e.payload.message : '保存失败');
    }
  }

  async function handleReset() {
    setSaveState('loading');
    setErrMsg('');
    try {
      await api.delete(`/admin/ai-system/tunables/${t.key}`);
      setSaveState('ok');
      onSaved();
      okTimer.current = setTimeout(() => setSaveState('idle'), 2500);
    } catch (e) {
      setSaveState('err');
      setErrMsg(e instanceof ApiClientError ? e.payload.message : '撤销失败');
    }
  }

  const displayVal = t.isFloat ? localValue.toFixed(2) : String(localValue);

  const unitHint =
    t.unit === 'ms'
      ? `${(localValue / 1000).toFixed(1)} 秒`
      : t.unit === 'min'
      ? `${localValue} 分钟`
      : t.unit
      ? `${displayVal} ${t.unit}`
      : displayVal;

  return (
    <div className="relative overflow-hidden rounded-xl border border-ink-100 bg-white shadow-sm">
      {/* 左侧粉色可调标识条 */}
      <div className="absolute inset-y-0 left-0 w-[3px] rounded-l-xl bg-primary" />

      <div className="pl-5 pr-4 pb-4 pt-3.5">
        {/* 标题行 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-ink-900">{t.label}</span>
              <span className="rounded-full border border-primary/30 bg-primary/5 px-2 py-px text-[10px] font-medium text-primary">
                可调
              </span>
              {t.isOverridden && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-px text-[10px] font-medium text-amber-700">
                  已改
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] leading-4 text-ink-300">
              {TUNABLE_DESC[t.key] ?? ''}
            </p>
          </div>
          {/* 当前值大字 */}
          <div className="shrink-0 text-right">
            <div className="text-xl font-bold leading-none text-ink-900">{displayVal}</div>
            {t.unit && (
              <div className="mt-0.5 text-[10px] text-ink-300">{unitHint}</div>
            )}
          </div>
        </div>

        {/* 控件 */}
        <div className="mt-3 space-y-2">
          {/* 滑块 */}
          <div className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-[11px] text-ink-300">
              {t.isFloat ? t.min.toFixed(1) : t.min}
            </span>
            <input
              type="range"
              min={t.min}
              max={t.max}
              step={t.step}
              value={localValue}
              onChange={(e) =>
                setLocalValue(
                  t.isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10),
                )
              }
              className="flex-1 accent-primary"
            />
            <span className="w-10 shrink-0 text-right text-[11px] text-ink-300">
              {t.isFloat ? t.max.toFixed(1) : t.max}
            </span>
          </div>

          {/* 精确输入 + 操作按钮 */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={t.min}
              max={t.max}
              step={t.step}
              value={localValue}
              onChange={(e) => {
                const v = t.isFloat
                  ? parseFloat(e.target.value)
                  : parseInt(e.target.value, 10);
                if (!isNaN(v)) setLocalValue(Math.min(t.max, Math.max(t.min, v)));
              }}
              className="input w-24 text-center font-mono text-sm"
            />
            {t.unit && (
              <span className="text-[11px] text-ink-300">{t.unit}</span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {t.isOverridden && (
                <button
                  type="button"
                  onClick={() => void handleReset()}
                  disabled={saveState === 'loading'}
                  className="btn-ghost h-8 px-3 text-xs disabled:opacity-50"
                >
                  撤销至默认
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saveState === 'loading' || !isDirty}
                className="btn-primary h-8 px-4 text-xs disabled:opacity-40"
              >
                {saveState === 'loading'
                  ? '保存中…'
                  : saveState === 'ok'
                  ? '✓ 已保存'
                  : '保存'}
              </button>
            </div>
          </div>

          {/* 底部提示行 */}
          <div className="flex items-center gap-2 text-[11px] text-ink-300">
            <span>
              默认：{t.isFloat ? t.default.toFixed(2) : t.default}
              {t.unit ? ` ${t.unit}` : ''}
            </span>
            {saveState === 'ok' && (
              <span className="text-green-600">秒级生效</span>
            )}
            {saveState === 'err' && (
              <span className="text-red-500">{errMsg}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────

export default function AiSystemPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [tunables, setTunables] = useState<Tunable[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadInfo() {
    try {
      const r = await api.get<SystemInfo>('/admin/ai-system/info');
      setInfo(r);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.payload.message : '加载 info 失败');
    }
  }

  async function loadTunables() {
    try {
      const r = await api.get<{ items: Tunable[] }>('/admin/ai-system/tunables');
      setTunables(r.items);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.payload.message : '加载可调参数失败');
    }
  }

  useEffect(() => {
    void loadInfo();
    void loadTunables();
  }, []);

  const groupedTunables = GROUP_ORDER.reduce<Record<string, Tunable[]>>((acc, g) => {
    acc[g] = tunables.filter((t) => t.group === g);
    return acc;
  }, {});

  const p = info?.params;

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* ── 页头 ── */}
        <h1 className="text-xl font-bold text-ink-900">AI 分身 · 系统约束</h1>
        <p className="mt-1 text-sm text-ink-500">
          管理 AI 分身的全部运行参数。可调参数实时生效；只读约束改动需发版。
        </p>

        {/* 工作流程条 */}
        <div className="mt-4 rounded-xl border border-ink-100 bg-ink-50 px-4 py-3 text-xs text-ink-500">
          <span className="font-medium text-ink-700">工作流程：</span>
          客户发消息
          <Arrow />
          技师离线判断
          <Arrow />
          随机延迟（不秒回 · 合并连发）
          <Arrow />
          读记忆 + 近期对话
          <Arrow />
          生成回复
          <Arrow />
          4 道自动质检
          <Arrow />
          发送 / 拦截重写
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}
        {!info && !error && tunables.length === 0 && (
          <div className="mt-6 text-sm text-ink-300">加载中…</div>
        )}

        {/* ═══════════════════════════════════
            一、可调参数区
        ═══════════════════════════════════ */}
        {tunables.length > 0 && (
          <div className="mt-7">
            <SectionHeading
              label="可调参数"
              desc="以下参数可在后台直接修改，保存后秒级生效，无需发版。"
              badge={`${tunables.filter((t) => t.isOverridden).length} 项已自定义`}
            />

            {GROUP_ORDER.map((g) => {
              const items = groupedTunables[g];
              if (!items || items.length === 0) return null;
              const meta = GROUP_META[g];
              return (
                <div key={g} className="mb-6">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[12px] font-semibold text-ink-700">
                      {meta?.label ?? g}
                    </span>
                    {meta?.desc && (
                      <span className="text-[11px] text-ink-300">— {meta.desc}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {items.map((t) => (
                      <TunableCard
                        key={t.key}
                        t={t}
                        onSaved={() => void loadTunables()}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ═══════════════════════════════════
            二、只读约束区
        ═══════════════════════════════════ */}
        {info && p && (
          <div className="mt-8">
            <SectionHeading
              label="只读约束"
              desc="以下运行边界由代码控制，修改需要发版上线。"
            />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ReadonlyCard
                title="长期记忆（关系档案）"
                value="跨会话记住每个客户"
                what="AI 跨次记住客户：来过几次、上次什么时候、技师给的昵称、技师对 ta 的印象、亲密度(L0 新客→L3 老朋友)。"
                why={'让客户觉得“她记得我”，这是复购的关键。'}
                normal="老客来，AI 能叫出昵称、提起上次。"
                abnormal={'AI 对老客像初次见面（档案丢了）；或编造没发生的事（被“假记忆”红线拦）。'}
                howto="在技师/客户详情查关系档案是否存在。"
              />
              <ReadonlyCard
                title="自动质检（不露馅防线）"
                value={`4 道关卡 · 最多重写 ${p.maxRegenerate} 次`}
                what="AI 每生成一条，发出去前先过 4 道质检：①红线(加微信/转账/未成年/违法/假记忆) ②露馅检测(客服腔/自曝 AI) ③串话检测 ④反重复。不合格自动重写或重生成；重生成还露馅就干脆不发。"
                why={'LLM 天生会偶尔"破功"，靠这层兜底守住"完全替身"，宁可不回也不暴露 AI。'}
                normal="绝大多数一次过，少量重生成。"
                abnormal="某技师重生成率/不发率突然飙高。"
                howto="去「诊断」看该技师被拦的具体原因（她的人设或对话可能有问题）。"
              />
              <ReadonlyCard
                title="当前话术版本"
                value={info.promptVersion}
                what={'AI 的"话术大脑"版本号，每条回复都记了用哪个版本生成。'}
                why={'换版本能整体改 AI 行为；记版本号便于"换版本后变好/变坏"对比。'}
                normal="全平台用同一当前版本。"
                abnormal="换版本后健康分整体下滑——该版本有问题。"
                howto="暂无一键回滚，回退需发版。"
              />
              <ReadonlyCard
                title="底层 AI 供应商"
                value={`${info.llm.providers.join(' + ')}（${info.llm.tier}）`}
                what="底层调用的大模型供应商，主用第一个，崩了自动切下一个。"
                why="双供应商容灾，一个挂了不影响服务。"
                normal="主供应商正常响应。"
                abnormal="某供应商成本/失败率突增。"
                howto="去「成本看板」看 provider 拆分。"
              />
            </div>

            {/* 红线分类 */}
            <div className="mt-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-ink-700">红线分类</span>
                  <span className="text-[11px] text-ink-300">— 触碰即拦截，不可绕过</span>
                </div>
                <span className="rounded-full bg-ink-100 px-2.5 py-px text-[10px] text-ink-500">
                  只读 · 改需发版
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {info.redline.categories.map((cat) => (
                  <div
                    key={cat}
                    className="flex items-center gap-2 rounded-lg border border-ink-100 bg-ink-50/60 px-3.5 py-2.5"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                    <span className="text-xs text-ink-700">{cat}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 4 道质检规则 */}
            {info.validate.checks.length > 0 && (
              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-ink-700">4 道质检规则</span>
                  <span className="rounded-full bg-ink-100 px-2.5 py-px text-[10px] text-ink-500">
                    只读 · 改需发版
                  </span>
                </div>
                <div className="overflow-hidden rounded-xl border border-ink-100">
                  {info.validate.checks.map((ck, i) => (
                    <div
                      key={ck}
                      className={`flex items-start gap-3 px-4 py-3 text-xs ${
                        i < info.validate.checks.length - 1 ? 'border-b border-ink-100' : ''
                      }`}
                    >
                      <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[10px] font-semibold text-ink-500">
                        {i + 1}
                      </span>
                      <span className="text-ink-700">{ck}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════
            三、后台自动任务
        ═══════════════════════════════════ */}
        {info && (
          <div className="mt-8">
            <SectionHeading
              label="后台自动任务"
              desc="主动给真实客户发消息是高风险，需明确授权才开。"
            />
            <div className="overflow-hidden rounded-xl border border-ink-100">
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(info.jobs).map(([key, j], i, arr) => (
                    <tr
                      key={key}
                      className={i < arr.length - 1 ? 'border-b border-ink-100' : ''}
                    >
                      <td className="px-4 py-3 text-ink-700">{j.desc}</td>
                      <td className="px-4 py-3 text-right">
                        {j.enabled ? (
                          <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                            运行中{j.intervalMin ? ` · 每 ${j.intervalMin} 分钟` : ''}
                          </span>
                        ) : (
                          <span className="rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-500">
                            未开启
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════
            四、内容与行为护栏
        ═══════════════════════════════════ */}
        {info && (
          <div className="mt-8">
            <SectionHeading
              label="内容 · 行为护栏"
              desc={
                <>
                  AI 分身必须遵守的全部约束。标「可查统计」的可在{' '}
                  <a href="/ai/redline" className="text-primary underline">
                    红线监控
                  </a>{' '}
                  看实际拦截次数。
                </>
              }
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {info.guardrails.map((g) => (
                <div
                  key={g.key}
                  className="rounded-xl border border-ink-100 bg-ink-50/60 p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-semibold text-ink-700">{g.label}</span>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          KIND_STYLE[g.kind] ?? 'bg-ink-100 text-ink-500'
                        }`}
                      >
                        {KIND_LABEL[g.kind] ?? g.kind}
                      </span>
                      {g.monitored && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          可查统计
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-ink-500">{g.desc}</p>
                  <p className="mt-1 text-[10px] text-ink-300">起于 {g.since}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
