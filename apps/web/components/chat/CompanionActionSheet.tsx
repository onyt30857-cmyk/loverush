/**
 * 心动陪伴 · 亲密动作卡（M18 Phase 3 · mockup 方向 A「她的口吻 · 流内延续」）
 *
 * 设计灵魂：把"付费"做成"关系投入"，不硬、有情绪价值。
 *   - 永不出现「余额不足 / 购买 / 解锁 / 套餐 / 余额」等交易词
 *   - 心动值称「你们的心动值」/「羁绊」
 *   - 心动值不够时：不弹错误窗，就地展开一张柔卡——
 *     用"她"的口吻把话说一半 + 「为这段心动 · 添点温度」软引导
 *
 * 交互：
 *   1. 底部 sheet 列出可发起的亲密动作（情绪化命名 + 心动值价的暖措辞）
 *   2. 点动作 → POST /companion/{therapistUserId}/action { action_code }
 *   3. 成功 → onReply(她的回复, 新等级) 把她的回复插进聊天流 + 关 sheet
 *   4. 失败（心动值不足 · HTTP 400）→ 就地展开 softcard 软引导，绝不报错
 *
 * 视觉 token：玫红 primary / 暖橙 warm / 圆角 rounded-2xl / 暖粉阴影，禁蓝紫。
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Heart, Sparkles, Moon, Sunrise, Eye, Flame, Mic } from 'lucide-react';
import { apiPost } from '@/lib/api';

const LEVELS = ['陌生', '熟悉', '暧昧', '心动', '专属'] as const;

interface CompanionAction {
  code: string;
  Icon: typeof Heart;
  /** 动作名 · 情绪化 · 非功能名 */
  name: string;
  /** 一句"她会怎么做"的诱因，贴 mockup A 的口吻 */
  hint: string;
  /** 心动值价的暖措辞（不写"积分/价格"硬词） */
  priceLabel: string;
  /** 卡片暖色渐变 */
  color: string;
}

// 动作目录（对齐后端 action_code）· 命名全走情绪价值，不暴露任何功能/交易词
const ACTIONS: CompanionAction[] = [
  {
    code: 'voice_whisper',
    Icon: Mic,
    name: '凑耳边悄悄话',
    hint: '她把这句害羞的话，凑到你耳边轻轻说',
    priceLabel: '一点点心动值',
    color: 'from-primary-50 to-warm-50',
  },
  {
    code: 'flirt_mode',
    Icon: Flame,
    name: '今晚她有点上头',
    hint: '语气更黏一点、更暧昧一点，只对你',
    priceLabel: '添一点温度',
    color: 'from-warm-50 to-primary-50',
  },
  {
    code: 'peek',
    Icon: Eye,
    name: '偷看她此刻在做什么',
    hint: '她会发来一张此刻的小心情给你',
    priceLabel: '一点心动值',
    color: 'from-primary-50 to-warm-50',
  },
  {
    code: 'wake_up',
    Icon: Sunrise,
    name: '明早第一句是她',
    hint: '让她的声音叫你起床，记得你昨晚说的话',
    priceLabel: '添些温度',
    color: 'from-warm-50 to-primary-50',
  },
  {
    code: 'tonight_exclusive',
    Icon: Moon,
    name: '今晚专属夜聊',
    hint: '她只陪你、记得你说过的每件小事，用声音哄你睡',
    priceLabel: '走近一步',
    color: 'from-primary-50 to-warm-50',
  },
];

export interface CompanionActionSheetProps {
  isOpen: boolean;
  /** 技师 user_id（companion API 主键） */
  therapistUserId: string;
  /** 她的昵称 · 用于个性化文案 */
  therapistName?: string | null;
  /** 当前亲密度等级（IntimacyRibbon 拉到后传入 · 用于"差一步到 X"文案） */
  currentLevel?: number | null;
  onClose: () => void;
  /** 动作成功 · 把她的回复插进聊天流（reply 可能为 null, 新等级） */
  onReply: (reply: string | null, newLevel?: number) => void;
}

interface ActionResponse {
  action: string;
  pricePoints: number;
  intimacyExp: number;
  level: number;
  reply: string | null;
}

export function CompanionActionSheet({
  isOpen,
  therapistUserId,
  therapistName,
  currentLevel,
  onClose,
  onReply,
}: CompanionActionSheetProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // 心动值不够时就地展开的柔卡 · 记下是哪个动作触发的（话说一半引用它的 hint）
  const [soft, setSoft] = useState<CompanionAction | null>(null);
  // 成功后的一闪轻提示「羁绊 +」
  const [bond, setBond] = useState<string | null>(null);

  if (!isOpen) return null;

  const who = therapistName || '她';
  // 下一级名（"差一步到 X"软引导用）
  const lvl = typeof currentLevel === 'number' ? currentLevel : null;
  const nextLevelName = lvl !== null && lvl < LEVELS.length - 1 ? LEVELS[lvl + 1] : '心动';

  async function pick(act: CompanionAction) {
    if (busy) return;
    setBusy(act.code);
    setSoft(null);
    try {
      // 每次发起生成一个幂等 token · 同次请求(含 401 自动续期重试)复用 → 后端不重复扣心动值
      const idempotency_key =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${therapistUserId}.${act.code}.${Date.now()}.${Math.round(performance.now())}`;
      const r = await apiPost<ActionResponse>(`/companion/${therapistUserId}/action`, {
        action_code: act.code,
        idempotency_key,
      });
      // 轻提示「羁绊 +」一闪
      setBond('羁绊 +1');
      window.setTimeout(() => setBond(null), 1400);
      onReply(r.reply, r.level);
      onClose();
    } catch {
      // 心动值不足（后端 debit 抛 E2010 → HTTP 400 · ApiClientError）→ 不报错
      // 任何异常都就地展开柔卡软引导：绝不弹错误窗，守"冷暖不由余额"的情绪线
      setSoft(act);
    } finally {
      setBusy(null);
    }
  }

  function handleAddWarmth() {
    // 「为这段心动·添点温度」→ 现有充值流(/me/recharge · 心动值=积分复用 point-purchases)
    // from=companion 让充值页可显情绪化头(保"不硬")· 回来仍在本会话
    onClose();
    router.push('/me/recharge?from=companion');
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[82vh] overflow-y-auto rounded-t-3xl bg-gradient-to-b from-white via-warm-50/30 to-white shadow-2xl">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-ink-200" />

        <div className="flex items-start justify-between px-5 pb-1 pt-3">
          <div>
            <h3 className="flex items-center gap-1.5 font-serif-cn text-base font-semibold text-ink-900">
              <Heart className="h-4 w-4 fill-primary-200 text-primary-600" strokeWidth={2.2} />
              想和 {who} 更近一步
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-500">每一次靠近，都让你们的羁绊更深一点</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-100/60 active:bg-ink-200"
            aria-label="关闭"
          >
            <X className="h-4 w-4 text-ink-600" />
          </button>
        </div>

        {/* 轻提示「羁绊 +」一闪 */}
        {bond && (
          <div className="mx-5 mt-2 flex items-center justify-center gap-1 rounded-full bg-success-500/10 py-1.5 text-[12px] font-semibold text-success-500">
            <Sparkles className="h-3.5 w-3.5" /> {bond}
          </div>
        )}

        <div className="space-y-2.5 px-5 pb-3 pt-3">
          {ACTIONS.map((act) => {
            const Icon = act.Icon;
            const isBusy = busy === act.code;
            return (
              <button
                key={act.code}
                type="button"
                onClick={() => void pick(act)}
                disabled={busy !== null}
                className={`flex w-full items-center gap-3 rounded-2xl border border-warm-100 bg-gradient-to-br ${act.color} p-3 text-left transition active:scale-[0.98] disabled:opacity-50`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/80 shadow-warm-xs">
                  {isBusy ? (
                    <Sparkles className="h-5 w-5 animate-spin text-primary" />
                  ) : (
                    <Icon className="h-5 w-5 text-primary-600" strokeWidth={2.1} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-serif-cn text-[14px] font-semibold text-ink-900">
                    {act.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] leading-snug text-ink-500">
                    {act.hint}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-white/70 px-2.5 py-1 text-[10.5px] font-medium text-primary-600">
                  {act.priceLabel}
                </span>
              </button>
            );
          })}
        </div>

        {/* 心动值不够 · 就地柔卡（贴 mockup A「流内延续」质感） */}
        {soft && (
          <div className="mx-5 mb-5 mt-1 animate-fade-up rounded-2xl border border-warm-100 bg-gradient-to-br from-white to-warm-50 p-3.5 shadow-warm-md">
            {/* 柔化波形（装饰 · 模糊+半透，呼应"声音将至"的留白） */}
            <div className="mb-2 flex h-5 items-center gap-[3px] opacity-50 blur-[1.5px]" aria-hidden>
              {[8, 15, 20, 11, 18, 7, 16, 22, 10, 14, 6, 17, 9, 19, 12].map((h, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-primary"
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
            {/* 她的口吻 · 话说一半 */}
            <p className="text-[12.5px] leading-relaxed text-ink-700">
              想让 <b className="font-semibold text-primary-600">{who}{act_hint(soft)}</b>…
              再陪她走一点点，就到「{nextLevelName}」了。
            </p>
            {/* 你们的心动值 · 进度（用当前等级近似 · 不假装具体数字） */}
            <div className="my-3 flex items-center gap-2">
              <span className="whitespace-nowrap text-[10px] text-ink-500">你们的心动值</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-warm"
                  style={{
                    width: `${lvl !== null ? Math.min(90, ((lvl + 0.5) / LEVELS.length) * 100) : 22}%`,
                  }}
                />
              </div>
            </div>
            {/* 软引导 CTA · 「为这段心动·添点温度」· 充值入口暂占位 */}
            <button
              type="button"
              onClick={handleAddWarmth}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-cta text-[13px] font-semibold text-white shadow-rose-md transition active:scale-[0.98]"
            >
              <Heart className="h-4 w-4 fill-white/90" strokeWidth={0} />
              为这段心动 · 添点温度
            </button>
            <p className="mt-2 text-center text-[10px] text-ink-500">
              添温度后，这一刻只属于你俩
            </p>
          </div>
        )}

        {/* 底部温柔注脚 */}
        {!soft && (
          <div className="mx-5 mb-5 flex items-center justify-center gap-1.5 rounded-xl bg-warm-50/60 px-3 py-2 text-[10.5px] text-ink-500">
            <Heart className="h-3 w-3 fill-rose-300 text-rose-300" />
            <span>日常陪你聊天永远免费 · 这些只是想更靠近你的小心思</span>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * 把动作 hint 收成"她……"的口吻短句（话说一半引用）
 * 取动作名核心动作意象，避免重复整句 hint。
 */
function act_hint(act: CompanionAction): string {
  switch (act.code) {
    case 'voice_whisper':
      return ' 凑到你耳边说这句';
    case 'flirt_mode':
      return ' 今晚只对你上头';
    case 'peek':
      return ' 把此刻的心情发给你';
    case 'wake_up':
      return ' 明早第一句叫醒你';
    case 'tonight_exclusive':
      return ' 今晚只陪你一个';
    default:
      return ' 更靠近你一点';
  }
}
