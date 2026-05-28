'use client';

import { AdminShell } from '@/components/AdminShell';
import { UserList } from '@/components/UserList';

export default function CustomersPage() {
  return (
    <AdminShell>
      <UserList scope="customer" />
    </AdminShell>
  );
}
