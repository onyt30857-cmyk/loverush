'use client';

import { use } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { UserDetail } from '@/components/UserDetail';

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AdminShell>
      <UserDetail userId={id} scope="customer" />
    </AdminShell>
  );
}
