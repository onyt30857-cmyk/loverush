/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@loverush/ui', '@loverush/i18n', '@loverush/utils', '@loverush/types'],
  eslint: { ignoreDuringBuilds: true },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: '**.loverush.com' },
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: 'i.pravatar.cc' },
    ],
  },
  // 性能修复 · 给 /public/* 静态资源加 immutable 缓存
  //   /proto-images/*.{png,webp} 不变内容,缓存 1 年
  //   Next.js 自动给 /_next/static/* 加 immutable(无需手动)
  async headers() {
    return [
      {
        source: '/proto-images/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

export default nextConfig;
