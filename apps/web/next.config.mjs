/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@loverush/ui', '@loverush/i18n', '@loverush/utils', '@loverush/types'],
  // next build 不跑 ESLint(走独立 pnpm lint 命令)
  // 理由:历史代码有数十个 lint warning,不阻塞 Railway 部署
  // typecheck 仍是硬门槛(tsc --noEmit · 4/4 必须 pass)
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.loverush.com',
      },
      {
        protocol: 'https',
        hostname: '**.r2.cloudflarestorage.com',
      },
    ],
  },
};

export default nextConfig;
