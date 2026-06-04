import { NextResponse } from 'next/server';

/**
 * 根治"发版后用户看不到新版"(2026-06-04)
 *
 * 根因:Next 15 给静态预渲染页(x-nextjs-prerender:1)默认发
 *   `Cache-Control: s-maxage=31536000, stale-while-revalidate=300`
 * Cloudflare 遵守 s-maxage 缓存 1 年,但免费版不执行 stale-while-revalidate,
 * → 发版后 CF 长期 serve 旧 HTML(引用旧 chunk),用户看不到新功能。
 * `export const dynamic='force-dynamic'` 对 'use client' 纯客户端页不生效,挡不住。
 *
 * 解法:对「页面文档」强制不被 CDN 长缓存(no-store),覆盖 Next 的 s-maxage。
 *   - 带 hash 的 _next/static / 图片 / 字体由 matcher 排除 → 仍 immutable 长缓存(安全:hash 变=新文件)
 *   - HTML 文档每次回源(体积小·Railway 快),保证发版即时可见
 */
export function middleware() {
  const res = NextResponse.next();
  res.headers.set('Cache-Control', 'no-store, must-revalidate');
  return res;
}

export const config = {
  // 只作用页面文档:排除静态资源 / 图片 / 字体 / sw / manifest / api
  matcher: [
    '/((?!_next/static|_next/image|_next/data|api/|favicon.ico|sw.js|manifest.webmanifest|manifest.json|robots.txt|sitemap.xml|proto-images|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|woff|woff2|ttf|map)).*)',
  ],
};
