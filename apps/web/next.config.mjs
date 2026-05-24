/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@loverush/ui', '@loverush/i18n', '@loverush/utils', '@loverush/types'],
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
