'use client';

import { AdminShell } from '@/components/AdminShell';
import { UserList } from '@/components/UserList';

export default function TherapistsPage() {
  return (
    <AdminShell>
      <UserList scope="therapist" />
    </AdminShell>
  );
}
