/**
 * 亲密度锚 · 聊天页顶部细条（M18 心动陪伴 · mockup 方向 C）
 *
 * 把"关系深浅"做成可见的情绪锚：5 级标签 + 当前级高亮 + 进度填充 + 💗。
 * 设计语言来自 2026-06-04 心动陪伴 mockup「C 亲密度推进」：
 *   - 白底细条贴 ChatHeader 下方，底部一条暖粉分割线
 *   - lvls 行：陌生/熟悉/暧昧/心动/专属，当前级玫红加粗，并带 ▸ 指向下一级
 *   - iprog：灰轨 + 玫红→暖橙渐变填充，填充末端浮一颗 💗
 *
 * 数据：GET /companion/{therapistUserId}/intimacy → { exp, level }
 *   level 0陌生 1熟悉 2暧昧 3心动 4专属
 * 失败静默隐藏（绝不报错 · 守"冷暖不由余额"的情绪线）。
 */
'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

const LEVELS = ['陌生', '熟悉', '暧昧', '心动', '专属'] as const;
// 亲密度等级阈值（exp 下界）· 与后端 INTIMACY_LEVEL_THRESHOLDS 对齐
// 0 陌生 1 熟悉 2 暧昧 3 心动 4 专属
const LEVEL_THRESHOLDS = [0, 50, 150, 350, 700] as const;

/** exp → 当前级内 0..1 进度（满级恒满） */
function progressWithinLevel(exp: number, level: number): number {
  const lo = LEVEL_THRESHOLDS[level] ?? 0;
  const hi = LEVEL_THRESHOLDS[level + 1];
  if (hi === undefined) return 1; // 专属满级
  const span = hi - lo;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (exp - lo) / span));
}

export interface IntimacyRibbonProps {
  therapistUserId: string;
  /** 父组件可订阅当前 level（用于动作卡文案"差一步到 X"等） */
  onLevel?: (level: number) => void;
  /** 父组件可订阅技师是否已复刻声音(决定是否展示 voice_whisper 动作) */
  onVoiceReady?: (ready: boolean) => void;
}

interface IntimacyState {
  exp: number;
  level: number;
  /** 技师是否传了语音样本(可发"她的声音")· 后端 GET /intimacy 附带 */
  voiceCloneReady?: boolean;
}

export function IntimacyRibbon({ therapistUserId, onLevel, onVoiceReady }: IntimacyRibbonProps) {
  const [data, setData] = useState<IntimacyState | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await apiGet<IntimacyState>(`/companion/${therapistUserId}/intimacy`);
        if (alive) {
          setData(r);
          onLevel?.(r.level);
          onVoiceReady?.(r.voiceCloneReady ?? false);
        }
      } catch {
        // 静默隐藏 · 不打扰沉浸
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [therapistUserId]);

  if (!data) return null;

  const level = Math.max(0, Math.min(LEVELS.length - 1, data.level));
  // 填充 = 已走完的级数 + 当前级内真实进度（用后端真实 exp 阈值算 · 不假装数据）
  // 心形停在填充末端，自然指向"下一级"
  const within = progressWithinLevel(data.exp, level);
  const fillPct =
    level >= LEVELS.length - 1 ? 100 : ((level + within) / LEVELS.length) * 100;

  return (
    <div className="border-b border-primary-100/70 bg-white px-4 pb-2 pt-2">
      <div className="mb-1.5 flex items-center justify-between text-[9px] text-ink-500">
        {LEVELS.map((label, i) => {
          const on = i === level;
          const next = LEVELS[i + 1];
          return (
            <span
              key={label}
              className={on ? 'font-bold text-primary-600' : ''}
            >
              {on && next ? `${label} ▸ ${next}` : label}
            </span>
          );
        })}
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-warm transition-[width] duration-700 ease-out"
          style={{ width: `${fillPct}%` }}
        />
        <span
          className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] leading-none"
          style={{ left: `${fillPct}%` }}
          aria-hidden
        >
          💗
        </span>
      </div>
    </div>
  );
}
