# Admin 用户 bootstrap runbook

> **Use when:** 首次上线生产、或现有 admin 全失效需要重置时
> **Last updated:** 2026-05-25（v0.35.0 上线后整理）

LoveRush admin 用户体系：`user_type` 只有 `customer / therapist`，**admin 是 customer/therapist 用户 + `user_roles.role='admin'`**。Roles 表支持：`admin / auditor / finance / cs / ops`。

## 鉴权 + 路径

- 登录走 **BIP-39 助记词**（24 词），不是密码 / OAuth
- JWT 不带 role，每次请求查 `user_roles`（实时生效）
- `/admin/*` 端点：`requireAuth + requireRole(['admin'])` 组合中间件
- Bootstrap 第一个 admin 必须**直接 SQL 绕过** `/admin/roles` 端点（没人能 grant 第一个 admin）

## 完整流程（生产）

### 1. 准备 invite_code

```sql
SELECT code, kind, target_user_type, max_uses, used_count
FROM invite_codes WHERE disabled_at IS NULL;
```

预 seed 的 codes（kind `A`=admin · `O`=open / ops）:
- `ADMIN-SEED-CUSTOMER-001` — customer 专用 · 100 次
- `ADMIN-SEED-THERAPIST-001` — therapist 专用 · 50 次
- `ADMIN-OPS-001` — 通用 · 10 次（**推荐给 admin 用**）

如果 code 用完或被禁，先 seed：

```sql
INSERT INTO invite_codes (code, kind, max_uses, issuer_note)
VALUES ('YOUR-OPS-CODE-2026', 'O', 5, 'admin 应急 bootstrap');
```

### 2. 注册 admin user

**用 `scripts/register-admin-secure.sh` —— mnemonic 写本地文件，stdout 只露 user_id（安全）**：

```bash
bash scripts/register-admin-secure.sh "你的-admin-名字"
```

脚本会：
- 调 `POST /auth/register`（user_type=customer · invite=ADMIN-OPS-001）
- 把 mnemonic / access_token / refresh_token 写到 `$HOME/loverush-admin-<时间戳>.secrets`（mode 600）
- stdout 只输出 `user_id` + 操作提示

**接下来：**
```bash
open ~/loverush-admin-<时间戳>.secrets     # 用编辑器打开
# 复制 mnemonic + tokens 到 1Password "LoveRush admin secrets" 条目
rm ~/loverush-admin-<时间戳>.secrets        # 删除本地文件
```

> ⚠️ **mnemonic 是唯一恢复手段**。`/auth/recover` 用它重新生成 JWT。丢了只能重新 bootstrap。

### 3. Grant admin role

#### 3a. Bootstrap（第一个 admin，没人能 grant 它）

直接 SQL：

```sql
INSERT INTO user_roles (user_id, role, granted_by_user_id, granted_at)
VALUES ('<NEW_USER_ID>', 'admin', '<NEW_USER_ID>', NOW());
-- granted_by 用自己（bootstrap edge case · 没有 audit 记录）
```

#### 3b. 后续 admin（已经有第一个 admin 时）

走标准 endpoint（**有 audit log**）：

```bash
ACCESS_TOKEN="<现有 admin 的 access_token>"
curl -X POST https://loverush-production.up.railway.app/admin/roles \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<NEW_USER_ID>","role":"admin"}'
```

### 4. 验证

```bash
ACCESS_TOKEN="<新 admin 的 access_token>"
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  https://loverush-production.up.railway.app/admin/dashboard?range_days=1
# 应返 200 + 完整 dashboard JSON
```

### 5. （推荐）Rotate bootstrap admin

如果第一个 admin 的 mnemonic 在哪个不安全的地方暴露过（对话历史、聊天截图等），创建第二个 secure admin 后**自杀式 revoke** 第一个：

```bash
# 用 第一个 admin 自己的 access_token revoke 自己的 admin role
curl -X DELETE https://loverush-production.up.railway.app/admin/roles \
  -H "Authorization: Bearer $BOOTSTRAP_ADMIN_ACCESS" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<BOOTSTRAP_USER_ID>","role":"admin","reason":"mnemonic exposed · self-revoke after secure admin created"}'
```

验证：旧 admin 调 `/admin/dashboard` 应返 **403**。

## Seed 业务 demo 数据（可选）

完整步骤见 `scripts/lightweight-canary.sh` 紧挨着的 `scripts/seed-demo-business.sql`（如果不存在，参考 v0.35.0 git history `4043648..HEAD` 里的 SQL 改写）。

最小 seed set（≈ 15 行）：
- 1 test customer（走 `/auth/register`）
- 3 therapist users（直接 SQL · 无 mnemonic · demo-only 不登录）
- 3 therapists profiles（bio / city / price / skills / online=true / verified=passed）
- 2 customer points_account 充 100k（therapist 用户 INSERT 时 trigger 自动建空 account）
- 3 orders 覆盖状态机三个阶段（REVIEWED / IN_SERVICE / DRAFT）
- （可选）2 conversations + N messages
- （可选）3 dispatch_offers 给 DRAFT 订单

## 常见问题

### `/admin/*` 返 403 即使我刚 grant 了 role

JWT 不带 role，但**每次请求查 `user_roles` 表**。检查：
```sql
SELECT * FROM user_roles WHERE user_id='<YOUR_USER_ID>' AND role='admin' AND revoked_at IS NULL;
```
如果 `revoked_at` 非空 → 角色已被吊销，需要重新 grant。

### Access token 过期

Access TTL 1h · Refresh TTL 30d。用 refresh 续：
```bash
curl -X POST https://loverush-production.up.railway.app/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"<YOUR_REFRESH>"}'
```

### Mnemonic 丢失

只能重新走整个 bootstrap 流程，创建新 admin + revoke 旧 admin。**没有"找回密码"**。

## Audit log

所有 `/admin/roles` POST/DELETE 自动写 `admin_audit_log`（append-only）。bootstrap edge case 的 SQL grant 不写 audit —— 这是已知的、可接受的 trade-off。
