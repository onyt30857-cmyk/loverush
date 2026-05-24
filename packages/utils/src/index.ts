/**
 * @loverush/utils · 通用工具函数
 */

import { nanoid } from 'nanoid';

export const newId = (size = 21): string => nanoid(size);

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const formatPoints = (points: number): string => {
  return points.toLocaleString('en-US');
};

export const isValidEmail = (email: string): boolean => {
  return /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(email);
};

export const isValidPhone = (phone: string): boolean => {
  // E.164 格式 · +国际区号 + 数字
  return /^\+[1-9]\d{6,14}$/.test(phone);
};
