import type { Metadata, Viewport } from 'next';
import { Inter, Cormorant_Garamond, Playfair_Display } from 'next/font/google';
import { AuthProvider } from '@/lib/auth';
import { AppSWRConfig } from '@/lib/swr';
import { DialogProvider } from '@/components/UIDialog';
import SwRegistrar from '@/components/SwRegistrar';
import SentryInit from '@/components/SentryInit';
import './globals.css';

/**
 * next/font 自托管字体(性能修复):
 *   - 自动 preload + 零 CLS + 不依赖 fonts.googleapis.com
 *   - 只取 latin 子集 + 实际用到的 weight,大幅缩 KB
 *   - 中文走系统字体(PingFang SC / 微软雅黑 / Noto Sans CJK 浏览器自带)
 */
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-sans',
});

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500'],
  style: ['italic'],
  display: 'swap',
  variable: '--font-cormorant',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['500', '700'],
  display: 'swap',
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'LoveRush · 为爱冲锋',
  description: '真人 · 真美 · 真私密',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 390,
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#FF5577',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh" className={`${inter.variable} ${cormorant.variable} ${playfair.variable}`}>
      <body>
        <AppSWRConfig>
          <AuthProvider>
            <DialogProvider>{children}</DialogProvider>
          </AuthProvider>
        </AppSWRConfig>
        <SwRegistrar />
        <SentryInit />
      </body>
    </html>
  );
}
