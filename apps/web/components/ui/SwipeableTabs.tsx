'use client';

/**
 * 通用「可左右滑动切换」标签组件。
 *
 * 设计依据 plan: 纯原生 CSS scroll-snap 横向容器(复用 HeroPicksCarousel 已验证模式),
 * 天生跟手 + 松手吸附,不引入任何手势库;点击 tab 与横滑双向同步。
 *
 * 高度策略: snap 容器不设固定高、不内部纵向滚动,每个 panel 自然撑开,
 * 整页纵向滚动仍由外层 .mobile-container(globals.css) 负责。代价是 flex 行盒
 * 把所有 panel 撑到最高 panel 高度,短列表 tab 下方留白 —— 用 items-start +
 * min-h-[55vh] + 空态居中缓解。这是 feed 联动 tab 的常规取舍。
 *
 * tab 栏是 snap 容器的兄弟节点(在容器外、不随横滑),各页原 sticky 定位通过
 * tabBarClassName 透传。
 */

import { Children, useEffect, useRef, type ReactNode } from 'react';

export interface SwipeTab {
  key: string;
  label: ReactNode;
  /** pill variant 右侧数字角标 */
  badge?: ReactNode;
}

export function SwipeableTabs({
  tabs,
  value,
  onChange,
  variant = 'underline',
  className,
  tabBarClassName,
  children,
}: {
  tabs: SwipeTab[];
  value: string;
  onChange: (key: string) => void;
  variant?: 'underline' | 'pill';
  className?: string;
  /** 透传 tab 栏外层壳:sticky 定位 / 背景 / 边距 */
  tabBarClassName?: string;
  /** 与 tabs 等长的 N 个 panel */
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 闸门:区分"用户手动横滑"(回写 value) vs "点击 tab 触发的程序滚动"(不回写,断开循环)
  const isProgrammatic = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const panels = Children.toArray(children);
  const index = Math.max(
    0,
    tabs.findIndex((t) => t.key === value),
  );

  // 续命/复位闸门:scrollend 不可用时的兜底
  function armSettle() {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      isProgrammatic.current = false;
    }, 350);
  }

  // 受控同步:外部 value 变(点击 tab)→ 平滑滚到对应 panel
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = index * el.clientWidth;
    // 已在位(用户自己滑出来的)→ 不重复程序滚一次
    if (Math.abs(el.scrollLeft - target) < 2) return;
    isProgrammatic.current = true;
    el.scrollTo({ left: target, behavior: 'smooth' });
    armSettle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // scrollend 优先复位闸门(iOS 16.4+),降级靠 armSettle 的 timer
  useEffect(() => {
    const el = ref.current;
    if (!el || !('onscrollend' in el)) return;
    const onEnd = () => {
      isProgrammatic.current = false;
    };
    el.addEventListener('scrollend', onEnd);
    return () => el.removeEventListener('scrollend', onEnd);
  }, []);

  // 卸载清理 timer
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    if (isProgrammatic.current) {
      // 程序滚动中:只续命闸门、不回写,避免循环/抖动
      armSettle();
      return;
    }
    const w = el.clientWidth || 1;
    const i = Math.round(el.scrollLeft / w);
    const key = tabs[Math.min(tabs.length - 1, Math.max(0, i))]?.key;
    // 仅当 key 变化才 onChange,避免每帧 setState
    if (key && key !== value) onChange(key);
  }

  // 单 tab / 无 tab 退化:不启用 snap
  if (tabs.length <= 1) {
    return (
      <div className={className}>
        {tabs.length === 1 && (
          <div className={tabBarClassName}>
            <TabBar tabs={tabs} value={value} onChange={onChange} variant={variant} />
          </div>
        )}
        {panels}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className={tabBarClassName}>
        <TabBar tabs={tabs} value={value} onChange={onChange} variant={variant} />
      </div>
      <div
        ref={ref}
        onScroll={onScroll}
        className="no-scrollbar flex snap-x snap-mandatory items-start overflow-x-auto overscroll-x-contain"
      >
        {panels.map((p, i) => (
          <div key={tabs[i]?.key ?? i} className="w-full shrink-0 snap-center">
            {p}
          </div>
        ))}
      </div>
    </div>
  );
}

function TabBar({
  tabs,
  value,
  onChange,
  variant,
}: {
  tabs: SwipeTab[];
  value: string;
  onChange: (key: string) => void;
  variant: 'underline' | 'pill';
}) {
  if (variant === 'pill') {
    return (
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {tabs.map((t) => {
          const active = t.key === value;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition active:scale-95 ${
                active
                  ? 'bg-gradient-cta text-white shadow-warm-sm'
                  : 'bg-white text-ink-600 shadow-warm-xs'
              }`}
            >
              <span>{t.label}</span>
              {t.badge != null && (
                <span className="num font-display text-[10px] opacity-85">{t.badge}</span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // underline:均分 + 下划线指示条(瞬切 + transition,与现状一致)
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`relative py-3 text-[13px] font-medium transition ${
              active ? 'text-primary' : 'text-ink-500'
            }`}
          >
            {t.label}
            {active && (
              <span className="absolute inset-x-1/4 bottom-0 h-0.5 rounded-full bg-gradient-cta" />
            )}
          </button>
        );
      })}
    </div>
  );
}
