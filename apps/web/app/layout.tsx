import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth';
import SwRegistrar from '@/components/SwRegistrar';
import SentryInit from '@/components/SentryInit';
import { AssistantFab } from '@/components/AssistantFab';
import './globals.css';

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
    <html lang="zh">
      <body>
        <AuthProvider>
          {children}
          <AssistantFab />
        </AuthProvider>
        <SwRegistrar />
        <SentryInit />
      </body>
    </html>
  );
}
