/**
 * @loverush/ui · 共享 React 组件
 *
 * 基于 shadcn/ui + Tailwind CSS
 * 暖色系（玫红 + 暖橙粉 · 对齐 DESIGN-SYSTEM.md）
 *
 * Phase 1 后期 / Phase 3 详细实现
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));

// TODO: 添加 Button / Input / Modal / Toggle 等基础组件（参考 prototypes 现有样式）
export {};
