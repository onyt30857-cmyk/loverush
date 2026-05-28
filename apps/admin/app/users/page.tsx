import { redirect } from 'next/navigation';

// 旧的统一用户列表已拆分为 /users/customers 与 /users/therapists,
// 兼容旧链接 → 默认跳客户列表
export default function UsersRedirectPage() {
  redirect('/users/customers');
}
