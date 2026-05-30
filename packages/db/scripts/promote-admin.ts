/**
 * Bootstrap admin · 把任一 H5 注册的 user_handle 账号 promote 为 admin
 *
 * 流程:
 *   1. 你在 H5 客户端 (/register/customer) 注册一个账号,记下 user_handle 和密码
 *   2. 跑本脚本:HANDLE=<your_handle> ROLE=admin bun packages/db/scripts/promote-admin.ts
 *   3. 用同一个 handle + password 登 admin (https://loverush-admin-production.up.railway.app/)
 *
 * 也可用于授予其他角色:auditor / finance / cs / ops
 *
 * 不破坏现有数据:
 *   - 老 mnemonic 时代的 'tony-admin' admin 角色保留 (不动)
 *   - 同 (user, role) 已存在且未 revoke 时跳过 (unique idx 防重)
 */

import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('NO_DATABASE_URL'); process.exit(1); }

const HANDLE = process.env.HANDLE;
const ROLE = (process.env.ROLE ?? 'admin').trim();
const VALID_ROLES = ['admin', 'auditor', 'finance', 'cs', 'ops'];

if (!HANDLE) {
  console.error('需要 HANDLE 环境变量,如:HANDLE=tony bun this.ts');
  process.exit(2);
}
if (!VALID_ROLES.includes(ROLE)) {
  console.error(`ROLE 必须是 ${VALID_ROLES.join(' / ')},收到 ${ROLE}`);
  process.exit(2);
}

const sql = postgres(url, { max: 1, ssl: 'require' as never });

try {
  // 1. 按 user_handle 找 user
  const users = await sql`
    SELECT id, user_type, display_name, metadata->>'user_handle' AS handle
    FROM users
    WHERE metadata->>'user_handle' = ${HANDLE}
    LIMIT 2
  `;
  if (users.length === 0) {
    console.error(`找不到 user_handle='${HANDLE}' 的账号 · 先去 H5 注册一个`);
    process.exit(3);
  }
  if (users.length > 1) {
    console.error(`异常:user_handle='${HANDLE}' 有 ${users.length} 条记录,人工核对`);
    process.exit(4);
  }
  const u = users[0]!;
  console.log(`找到账号:${u.handle} (${u.user_type}) · user_id=${u.id}`);

  // 2. 检查是否已有该 role(未 revoke)· 防重
  const existing = await sql`
    SELECT id, granted_at FROM user_roles
    WHERE user_id = ${u.id} AND role = ${ROLE} AND revoked_at IS NULL
    LIMIT 1
  `;
  if (existing.length > 0) {
    console.log(`✓ 已有 ${ROLE} 角色(grant 于 ${existing[0]!.granted_at})· 无需重复`);
    process.exit(0);
  }

  // 3. INSERT user_roles
  const inserted = await sql`
    INSERT INTO user_roles (user_id, role, granted_by_user_id)
    VALUES (${u.id}, ${ROLE}, NULL)
    RETURNING id, granted_at
  `;
  const row = inserted[0]!;
  console.log(`✅ 已 grant ${ROLE} 角色给 ${u.handle} (role_id=${row.id} at ${row.granted_at})`);
  console.log(`现在可以用 user_handle='${HANDLE}' + 密码 登录 admin 后台`);
} finally {
  await sql.end();
}
