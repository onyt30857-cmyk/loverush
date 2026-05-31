import type { ReactNode } from 'react';

type Variant = 'compact' | 'default' | 'padded' | 'immersive';

/**
 * PageContainer · 客户端 H5 二级页统一容器
 *
 * 4 档语义（用 Tailwind spacing scale，对齐 tailwind.config.ts）：
 * - compact   : px-4 py-4  → 聊天 / 紧凑列表（16px）
 * - default   : px-5 py-5  → 标准内容区（20px）· 最常用
 * - padded    : px-6 py-6  → 空气感大留白（24px）
 * - immersive : px-0 py-0  → 沉浸式 hero（子组件自控 padding）
 *
 * 设计动因：消除二级页横向 padding 在 px-3/px-4/px-5 之间随机跳跃的锯齿；
 * 同步全站节奏与 globals.css 的卡片 margin 规范（左右对称 16px）。
 */
export function PageContainer({
  children,
  variant = 'default',
  className = '',
}: {
  children: ReactNode;
  variant?: Variant;
  className?: string;
}) {
  const map = {
    compact: 'px-4 py-4',
    default: 'px-5 py-5',
    padded: 'px-6 py-6',
    immersive: 'px-0 py-0',
  } as const;
  return <div className={`${map[variant]} ${className}`}>{children}</div>;
}
