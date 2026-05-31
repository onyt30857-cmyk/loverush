/**
 * /t/schedule · 顶级排班入口
 *
 * BottomNav 中央 tab 跳这里 · 复用现有 /t/me/schedule 实现
 * 不复制代码 · 直接 redirect 到 /t/me/schedule(保持 schedule 单一真源)
 *
 * Why redirect 而非 import 复用:
 *   /t/me/schedule 是 client component · 内含大量 state + 业务逻辑
 *   直接 redirect 最简 · 避免双入口同步成本
 */
import { redirect } from 'next/navigation';

export default function TherapistSchedulePage() {
  redirect('/t/me/schedule');
}
