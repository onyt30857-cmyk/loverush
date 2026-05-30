# Admin 后台首次登录引导

## 背景

LoveRush 已从 BIP-39 助记词体系切换到 `user_handle + password`。
老 admin 账号 `tony-admin` 没有 handle/password,**新登录页用不了**。

需要让一个新注册的 H5 客户账号 promote 为 admin。

## 步骤(3 步,< 5 分钟)

### 1. 用 H5 注册一个账号

打开 https://loverush-web-production.up.railway.app/register/customer

填:
- 账号名:`tony`(或你想要的,3-16 字符,字母数字下划线)
- 密码:`你自己定的强密码`(8-32 位,必须含字母+数字)
- 邀请码:留空

注册成功记下账号名 + 密码。

### 2. 跑 promote 脚本

```bash
cd /Users/tony/Desktop/我的项目/为爱冲锋/code
railway run --service loverush -- \
  HANDLE=tony ROLE=admin \
  bun packages/db/scripts/promote-admin.ts
```

输出应该是:

```
找到账号:tony (customer) · user_id=...
✅ 已 grant admin 角色给 tony (role_id=... at ...)
现在可以用 user_handle='tony' + 密码 登录 admin 后台
```

如果想授其他角色,把 `ROLE=admin` 改成 `ROLE=auditor`/`finance`/`cs`/`ops`。

### 3. 登 admin

打开 https://loverush-admin-production.up.railway.app/

用 `tony` + 你刚才设的密码登录。

## 同一个账号在客户端和 admin 同时登录?

可以,无冲突。

- 客户端 token 存 `localStorage.access_token` / `refresh_token`
- admin 端 token 存 `localStorage.admin_access_token` / `admin_refresh_token`

刻意隔离 key,防 admin 越权被客户端代码拿走。

## 老 tony-admin 账号怎么处理?

老 admin 账号 `tony-admin`(user_id `93052d3c-...`)的 admin 角色保留,不影响新流程。

如果想清理,跑:

```bash
railway run --service loverush -- bun -e '
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { ssl: "require" });
await sql`UPDATE user_roles SET revoked_at = now(), revoke_reason = '\''legacy mnemonic admin · superseded'\''  WHERE user_id = '\''93052d3c-11a4-40ab-bd2d-d765e7cbb824'\'' AND revoked_at IS NULL`;
await sql.end();
console.log("done");
'
```

但**先确认新 admin 能登成功**再清老的,避免锁死后台。

## 给团队其他人开 admin?

让对方注册 H5 账号 → 你跑同样脚本传他的 user_handle 即可。

```bash
HANDLE=alice ROLE=cs bun packages/db/scripts/promote-admin.ts
```
