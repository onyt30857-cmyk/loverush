/**
 * 技师评分统一展示工具 · 唯一标度真相源
 *
 * 后端技师侧评分(scoreService/scoreAppearance/scoreBody/rating/ratingBayes)标度为 0-1000;
 * 全端统一展示为 0-10(一位小数)+ 5 星映射。杜绝各页 /10 /100 /300 /1000 各算各的。
 *
 * 冷启动:ratingCount<1 的技师不显 0 分/假星,显"暂无评价"。
 */

/** 0-1000 → "8.6"(0-10 一位小数) */
export function fmtScore1000(v: number | null | undefined): string {
  const n = typeof v === 'number' && v > 0 ? v : 0;
  return (n / 100).toFixed(1);
}

/** 0-1000 → 0-5 星(浮点,供星条宽度) */
export function toStars1000(v: number | null | undefined): number {
  const n = typeof v === 'number' && v > 0 ? v : 0;
  return Math.max(0, Math.min(5, n / 200));
}

/** 是否冷启动(无真实评价)· 该显"暂无评价"而非分数 */
export function isColdStart(ratingCount: number | null | undefined): boolean {
  return !(typeof ratingCount === 'number' && ratingCount > 0);
}

/** 冷启动文案 */
export const COLD_START_LABEL = '暂无评价';
