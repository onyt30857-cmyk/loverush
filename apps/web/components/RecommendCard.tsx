/**
 * AI 助理推荐卡 · M03 F03-D1 · 1→3 精准匹配
 *
 * 在对话流中以"卡片消息"形式插入,横向滑动浏览 1-3 张:
 *  - 头像 + 名字
 *  - 安心评级 A/B/C/D 徽章(右上角 · 与原 score-pill 并存)
 *  - 推荐理由 50 字(AI 生成 · 由后端 match_factors 拼接)
 *  - 价格(积分)
 *  - 城市
 *  - 立即预约按钮 → /therapist/:id
 *  - 推荐理由配图(F03-D-aux):卡右上角小图标 · click 展开"基于哪些偏好"
 *
 * 设计:对齐现有 `RecCard` 视觉,但作为 AI 推荐场景做了横向更宽 + 安心评级嵌入
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Info, MapPin, Sparkles } from 'lucide-react';
import { SafetyBadge, type SafetyMetrics } from './SafetyRating';

export interface RecommendItem {
  therapistId: string;
  displayName: string;
  avatarUrl?: string | null;
  serviceCity?: string | null;
  scoreService: number;          // 0-50 后端字段 · 显 *0.1
  pricePoints?: number | null;
  /** AI 50 字推荐理由 */
  reason?: string | null;
  /** 安心评级 (F03-D2) */
  safety?: SafetyMetrics | null;
  /** 推荐配图基础（哪些偏好匹配） */
  matchFactors?: string[] | null;
  /** 是否符合"现在就要"(F03-D8) */
  availableNow?: boolean;
}

interface RecommendCardProps {
  item: RecommendItem;
  /** 卡片宽度模式: full=对话流单卡 · slim=横滑多卡 */
  variant?: 'full' | 'slim';
}

export function RecommendCard({ item, variant = 'slim' }: RecommendCardProps) {
  const [whyOpen, setWhyOpen] = useState(false);
  const width = variant === 'full' ? 'w-full' : 'w-[230px] flex-shrink-0';

  return (
    <article
      className={`${width} overflow-hidden rounded-2xl border border-warm-100 bg-white shadow-warm-md transition`}
    >
      {/* 头像区 */}
      <div className="relative h-[170px] overflow-hidden bg-warm-50">
        {item.avatarUrl ? (
          <img
            src={item.avatarUrl}
            alt={item.displayName}
            className="h-full w-full object-cover"
            style={{ objectPosition: 'center 25%' }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-5xl">🙂</div>
        )}

        {/* 安心评级 - 左上 */}
        {item.safety && (
          <div className="absolute left-2 top-2">
            <SafetyBadge grade={item.safety.grade} />
          </div>
        )}

        {/* 现在可约 - 右上 */}
        {item.availableNow && (
          <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-gradient-warm-rose px-2 py-0.5 text-[10px] font-bold text-white shadow-rose-md">
            <span className="online-dot" /> 现在可约
          </div>
        )}

        {/* 评分 - 右下 */}
        <div className="score-pill absolute bottom-2 right-2">
          ★ {(item.scoreService / 10).toFixed(1)}
        </div>
      </div>

      <div className="px-3 pb-3 pt-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-serif-cn text-[14px] font-semibold text-ink-800">{item.displayName}</h3>
            {item.serviceCity && (
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-500">
                <MapPin className="h-3 w-3" /> {item.serviceCity}
              </div>
            )}
          </div>
          {/* 推荐理由配图 - 点开展开 */}
          {(item.matchFactors?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setWhyOpen((o) => !o)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warm-50 text-warm-600 transition active:scale-95"
              aria-label="为什么推荐这位"
              aria-expanded={whyOpen}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* 推荐理由 - AI 生成 */}
        {item.reason && (
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-ink-700">
            <Sparkles className="mr-1 inline h-3 w-3 text-warm-500" />
            {item.reason}
          </p>
        )}

        {/* 为什么推荐展开 */}
        {whyOpen && item.matchFactors && item.matchFactors.length > 0 && (
          <div className="mt-2 rounded-xl bg-warm-50 px-2.5 py-2 text-[11px] leading-5 text-ink-700 animate-fade-up">
            <div className="label-cormorant mb-1">WHY HER</div>
            <ul className="space-y-0.5">
              {item.matchFactors.slice(0, 4).map((f, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="text-warm-500">·</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-2">
          {item.pricePoints != null ? (
            <div className="text-display text-[15px] font-bold text-primary num">{item.pricePoints}</div>
          ) : (
            <div className="text-[11px] text-ink-400">价格面议</div>
          )}
          <Link
            href={`/therapist/${item.therapistId}`}
            className="rounded-full bg-gradient-cta px-3 py-1.5 text-[11px] font-medium text-white shadow-rose-md active:scale-95"
          >
            立即预约
          </Link>
        </div>
      </div>
    </article>
  );
}

/** 1→3 横滑推荐组 */
export function RecommendList({ items }: { items: RecommendItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="-mx-1 animate-fade-up">
      <div className="label-cormorant mb-2 px-1">RECOMMENDED FOR YOU · {items.length} 位</div>
      <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-1 pb-2">
        {items.map((it) => (
          <RecommendCard key={it.therapistId} item={it} />
        ))}
      </div>
    </div>
  );
}
