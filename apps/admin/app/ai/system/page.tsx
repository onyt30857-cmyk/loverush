'use client';

/**
 * AI 分身 · 系统约束透明卡（M06b 模块①）
 *
 * 面向不懂 AI 的运营：把藏在代码里的所有运行边界用人话讲清，每条配
 * 【是什么/为什么这样设/正常范围/异常信号/怎么处理】，当前值从后端实时读
 * (/admin/ai-system/info)，保证"显示值=实际运行值"。
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

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
  };
  llm: { tier: string; providers: string[] };
  redline: { categories: string[]; hardBlock: string[] };
  validate: { checks: string[] };
  jobs: Record<string, { enabled: boolean; intervalMin?: number; desc: string }>;
}

interface Card {
  icon: string;
  title: string;
  value: string;
  what: string;
  why: string;
  normal: string;
  abnormal: string;
  howto: string;
}

function buildCards(info: SystemInfo): Card[] {
  const p = info.params;
  return [
    {
      icon: '⏱️',
      title: '触发条件',
      value: `技师离线 > ${p.offlineThresholdMin} 分钟`,
      what: '客户发消息后，只有当技师本人离线超过这个时间、且开了 AI 分身，AI 才替她回。',
      why: '技师在线就让她自己回，AI 只在她忙/不在时补位，不抢真人的活。',
      normal: '技师离线时段，客户消息几秒内就有回复。',
      abnormal: '技师明明离线，客户发了消息很久没回。',
      howto: '去「健康仪表盘」查该技师是否被关停(kill switch)或健康分过低。',
    },
    {
      icon: '🧠',
      title: '短期记忆（上下文窗口）',
      value: `只看最近 ${p.historyWindow} 条`,
      what: 'AI 每次只读这段对话的最近若干条消息，更早的它"看不到"。',
      why: '看太多旧消息 AI 会"飘"——延续旧语气、甚至串话(把客户的话当成自己的)。我们刻意只给近几条，并自动过滤掉历史里旧的客服腔/露馅回复，免得 AI 模仿。',
      normal: 'AI 能接住当前话题；忘了很久以前说的事是正常的(超出窗口)。',
      abnormal: 'AI 突然答非所问、客服腔、问客户无关问题——这是"串话"。',
      howto: '串话已被自动质检拦截重写；频发就去「诊断」看具体原因。',
    },
    {
      icon: '💭',
      title: '长期记忆（关系档案）',
      value: '跨会话记住每个客户',
      what: 'AI 跨次记住客户：来过几次、上次什么时候、技师给的昵称、技师对 ta 的印象、亲密度(L0 新客→L3 老朋友)。',
      why: '让客户觉得"她记得我"，这是复购的关键。',
      normal: '老客来，AI 能叫出昵称、提起上次。',
      abnormal: 'AI 对老客像初次见面(档案丢了)；或编造没发生的事(被"假记忆"红线拦)。',
      howto: '在技师/客户详情查关系档案是否存在。',
    },
    {
      icon: '✂️',
      title: '说话长度',
      value: `≤ ${p.maxReplyChars} 字 / ${p.maxTokens} token`,
      what: 'AI 回复有长度上限，超过会被拦下重写。',
      why: '太长像 AI 写小作文，真人发微信都很短。',
      normal: '1-2 句、像真人随手发的。',
      abnormal: '回复经常很长、分点列条。',
      howto: '当前阈值在代码里，需收紧要发版(暂不开放后台调)。',
    },
    {
      icon: '🎛️',
      title: '稳定性（temperature）',
      value: String(p.temperature),
      what: '控制 AI "发挥自由度"的参数(0-1)。',
      why: '调高(如 0.85)更活泼但容易胡说、串话、跑题；调低更稳但偏呆板。当前值是稳定与自然的平衡。',
      normal: '偶尔有创意但不离谱。',
      abnormal: '频繁胡说/串话(可能要再降)，或回复呆板模板化(可略升)。',
      howto: '当前硬编码，调整需发版。',
    },
    {
      icon: '🛡️',
      title: '自动质检（不露馅防线）',
      value: `4 道关卡 · 最多重写 ${p.maxRegenerate} 次`,
      what: 'AI 每生成一条，发出去前先过 4 道质检：①红线(加微信/转账/未成年/违法/假记忆) ②露馅检测(客服腔/"回错人"/自曝 AI) ③串话检测 ④反重复(跟最近说的太像)。不合格自动重写或重生成；重生成还露馅就干脆不发。',
      why: 'LLM 天生会偶尔"破功"，靠这层兜底守住"完全替身"，宁可不回也不暴露 AI。',
      normal: '绝大多数一次过，少量重生成。',
      abnormal: '某技师重生成率/不发率突然飙高。',
      howto: '去「诊断」看该技师被拦的具体原因(她的人设或对话可能有问题)。',
    },
    {
      icon: '🏷️',
      title: '当前话术版本',
      value: info.promptVersion,
      what: 'AI 的"话术大脑"版本号，每条回复都记了用哪个版本生成。',
      why: '换版本能整体改 AI 行为；记版本号便于"换版本后变好/变坏"对比。',
      normal: '全平台用同一当前版本。',
      abnormal: '换版本后健康分整体下滑——该版本有问题。',
      howto: '暂无一键回滚，回退需发版。',
    },
    {
      icon: '⚙️',
      title: '底层用的 AI',
      value: `${info.llm.providers.join(' + ')}（${info.llm.tier}）`,
      what: '底层调用的大模型供应商，主用第一个，崩了自动切下一个。',
      why: '双供应商容灾，一个挂了不影响服务。',
      normal: '主供应商正常响应。',
      abnormal: '某供应商成本/失败率突增。',
      howto: '去「成本看板」看 provider 拆分。',
    },
  ];
}

export default function AiSystemPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.get<SystemInfo>('/admin/ai-system/info');
        setInfo(r);
      } catch (e) {
        setError(e instanceof ApiClientError ? e.payload.message : '加载失败');
      }
    })();
  }, []);

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="text-xl font-bold text-gray-900">AI 分身 · 系统约束透明</h1>
        <p className="mt-1 text-sm text-gray-500">
          下面是 AI 分身的全部运行边界与限制。不用懂技术，每张卡都讲清了"是什么、为什么、正常什么样、出问题怎么办"。
        </p>

        {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
        {!info && !error && <div className="mt-6 text-sm text-gray-400">加载中…</div>}

        {info && (
          <>
            {/* 工作流图解 */}
            <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
              <span className="font-medium text-gray-700">它怎么工作：</span>
              客户发消息 → 技师离线判断 → 读记忆+近期对话 → 生成回复 → 4 道自动质检 → 发送 / 拦截重写
            </div>

            {/* 约束卡网格 */}
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              {buildCards(info).map((c) => (
                <div key={c.title} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{c.icon}</span>
                      <span className="font-semibold text-gray-900">{c.title}</span>
                    </div>
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                      {c.value}
                    </span>
                  </div>
                  <dl className="mt-3 space-y-1.5 text-xs leading-5">
                    <Row label="是什么" v={c.what} />
                    <Row label="为什么" v={c.why} />
                    <Row label="正常范围" v={c.normal} tone="ok" />
                    <Row label="异常信号" v={c.abnormal} tone="warn" />
                    <Row label="怎么处理" v={c.howto} tone="action" />
                  </dl>
                </div>
              ))}
            </div>

            {/* 后台自动任务 */}
            <h2 className="mt-7 text-base font-semibold text-gray-900">🤖 后台自动任务</h2>
            <p className="mt-1 text-xs text-gray-500">主动给真实客户发消息是高风险，需明确授权才开。</p>
            <div className="mt-3 overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <tbody>
                  {Object.entries(info.jobs).map(([key, j]) => (
                    <tr key={key} className="border-b border-gray-100 last:border-0">
                      <td className="px-4 py-2.5 text-gray-700">{j.desc}</td>
                      <td className="px-4 py-2.5 text-right">
                        {j.enabled ? (
                          <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                            运行中{j.intervalMin ? ` · 每 ${j.intervalMin} 分钟` : ''}
                          </span>
                        ) : (
                          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">未开启</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 红线类别 */}
            <h2 className="mt-7 text-base font-semibold text-gray-900">🚫 红线类别（自动拦截）</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {info.redline.categories.map((cat) => (
                <span
                  key={cat}
                  className={`rounded-full px-3 py-1 text-xs ${
                    info.redline.hardBlock.includes(cat)
                      ? 'bg-red-50 text-red-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {REDLINE_LABEL[cat] ?? cat}
                  {info.redline.hardBlock.includes(cat) ? ' · 直接拦' : ' · 改写'}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

const REDLINE_LABEL: Record<string, string> = {
  contact_off_platform: '引导加微信/私下联系',
  payment_off_platform: '引导私下转账',
  fake_memory: '编造没发生的事',
  minor: '涉及未成年',
  illegal: '违法内容',
};

function Row({ label, v, tone }: { label: string; v: string; tone?: 'ok' | 'warn' | 'action' }) {
  const labelColor =
    tone === 'ok' ? 'text-green-600' : tone === 'warn' ? 'text-amber-600' : tone === 'action' ? 'text-indigo-600' : 'text-gray-400';
  return (
    <div className="flex gap-2">
      <dt className={`w-14 shrink-0 font-medium ${labelColor}`}>{label}</dt>
      <dd className="text-gray-600">{v}</dd>
    </div>
  );
}
