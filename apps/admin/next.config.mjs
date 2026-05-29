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
  // 强制每次 build 唯一 ID,绕过 Railpack .next/cache reuse 导致
  // client chunks 不重新编译的问题(server 跑新代码但 client chunk 还是旧 hash)
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
  // 关 webpack 持久化 cache · Railpack mount .next/cache 让 webpack 直接复用
  // 旧 chunk 文件,即便 source 改了也不编译。强制全新 build。
  webpack: (config, { dev }) => {
    if (!dev) {
      config.cache = false;
      // 让 chunk filename 含 timestamp,完全杜绝 hash 碰撞 reuse
      config.output = {
        ...config.output,
        chunkFilename: `static/chunks/[name].${Date.now()}.[contenthash:16].js`,
      };
    }
    return config;
  },
};

export default nextConfig;
