/**
 * 私聊时间相对显示 · 微信风格
 *
 *  < 1 min   → "刚刚"
 *  < 60 min  → "X 分钟前"
 *  < 24 h    → "HH:mm"(微信:今天用绝对时间)
 *  < 7 d     → "X 天前" / "周一/二/.."
 *  ≥ 7 d    → 日期
 */
export function relativeTime(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const day = Math.floor(h / 24);
  if (day < 7) return `${day} 天前`;
  return d.toLocaleDateString();
}
