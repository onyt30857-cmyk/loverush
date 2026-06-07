'use client';

import { AppShell } from '@/components/AppShell';
import { WalletLedger } from '@/components/wallet/WalletLedger';

export default function WalletPage() {
  return (
    <AppShell title="钱包" showBack hideTabBar>
      <WalletLedger />
    </AppShell>
  );
}
