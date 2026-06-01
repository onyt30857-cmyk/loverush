/**
 * 二级页 prefetch helper
 *
 * 在 list/card Link 上挂 onPointerEnter + onTouchStart 触发 SWR 后台拉,
 * 用户真点击进二级页时 SWR cache 已就绪 · useSWR 0ms 命中 · 无白屏等待。
 *
 * 真因 (2026-06-01 系统性诊断):
 *   /therapist/[id] page.tsx 用 useParams() → Next.js 15 自动 dynamic 渲染
 *   → origin no-store · CF 强制 BYPASS → 每次点击跨境 SSR 0.67s
 *   → hydrate 后才 useSWR fetch /therapists/:id 跨境 0.55s
 *   → 用户感知 1.2-1.5s 白屏
 * 修:
 *   悬停/触摸瞬间 (tap 早于 click ~50ms) 触发 SWR 后台 fetch
 *   tap → swr fetcher (并行) · 0.55s 完成
 *   tap → router.push → RSC payload load · 0.3s 完成 + hydrate ~0.2s
 *   两条路径并行 → 用户 click 到看到数据时间 = max(0.5s, 0.5s) = 0.5s
 *   (比串行 0.5+0.5=1.0s 减半)
 */
import { mutate as swrMutate } from 'swr';

/** 预拉技师详情 · 给瀑布流/搜索/收藏卡 onPointerEnter/onTouchStart 用 */
export const prefetchTherapist = (id: string | undefined | null): void => {
  if (!id) return;
  void swrMutate(`/therapists/${id}`);
};

/** 给 JSX 直接 spread 用的 prefetch props · 一行接入 */
export const prefetchTherapistProps = (id: string | undefined | null) => ({
  onPointerEnter: () => prefetchTherapist(id),
  onTouchStart: () => prefetchTherapist(id),
});
