/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@loverush/types', '@loverush/ui'],
  // next build 不跑 ESLint(走独立 pnpm lint 命令)
  // 跟 apps/web 一致 · 避免 lint warning 阻塞 Railway 构建
  // typecheck 仍硬门槛(tsc --noEmit)
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
