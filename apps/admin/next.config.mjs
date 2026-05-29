/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@loverush/types', '@loverush/ui'],
  // 完全绕开 Railpack mount 的 .next cache · 输出到全新目录
  // build 和 start 都读这个一致的 distDir
  distDir: '.next-prod',
  // next build 不跑 ESLint(走独立 pnpm lint 命令)
  // 跟 apps/web 一致 · 避免 lint warning 阻塞 Railway 构建
  // typecheck 仍硬门槛(tsc --noEmit)
  eslint: {
    ignoreDuringBuilds: true,
  },
  // 强制每次 build 唯一 ID,绕过 Railpack .next/cache reuse 导致
  // client chunks 不重新编译的问题(server 跑新代码但 client chunk 还是旧 hash)
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
  // 关 webpack 持久化 cache(distDir 已绕 mount,留这作双保险)
  webpack: (config, { dev }) => {
    if (!dev) {
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
