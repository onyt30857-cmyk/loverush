'use client';

import { TherapistShell } from '@/components/AppShell';
import { WalletLedger } from '@/components/wallet/WalletLedger';

export default function TherapistWalletPage() {
  return (
    <TherapistShell title="收益钱包" showBack hideTabBar>
      <WalletLedger />
    </TherapistShell>
  );
}
