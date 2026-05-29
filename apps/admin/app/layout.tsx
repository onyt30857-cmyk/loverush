import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LoveRush · Admin · v0.1.1',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
