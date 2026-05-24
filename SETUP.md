# SETUP · 本地开发环境

> 从 0 到能跑 `/auth/register` 接口 + H5 三页可点

## 0. 前置

- Node.js **20+**（推荐 nvm: `nvm use`）
- pnpm **9+**：`npm i -g pnpm@9`
- Bun（可选，仅 API dev hot reload）：`curl -fsSL https://bun.sh/install | bash`
- PostgreSQL **15+**（本地或 Supabase）
- psql CLI（运行 seed 脚本用）

## 1. 安装依赖

```bash
pnpm install
```

## 2. 环境变量

```bash
cp .env.example .env.local
```

至少填这几项才能跑 M01 注册：

| 字段 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://postgres:postgres@localhost:5432/loverush` |
| `JWT_SECRET` | JWT 签名密钥（32+ 字符） | `openssl rand -hex 32` |
| `JWT_ACCESS_TTL` | access token 有效期 | `1h` |
| `JWT_REFRESH_TTL` | refresh token 有效期 | `30d` |
| `NEXT_PUBLIC_API_URL` | 前端连接的 API 地址 | `http://localhost:8787` |

LLM key（`ANTHROPIC_API_KEY` 等）M01 阶段尚未用到，可后续再补。

## 3. 数据库初始化

```bash
# 生成 Drizzle 迁移 SQL（首次会扫描 schema 输出 0000_*.sql）
pnpm --filter @loverush/db generate

# 推送到 DB（开发期用 push，更快；生产用 migrate）
pnpm --filter @loverush/db push

# 写入起步邀请码
pnpm --filter @loverush/db seed
```

预置的种子邀请码：
- `ADMIN-SEED-CUSTOMER-001` · 客户专用 · 100 次
- `ADMIN-SEED-THERAPIST-001` · 技师专用 · 50 次
- `ADMIN-OPS-001` · 通用 · 10 次

## 4. 启动

```bash
pnpm dev
# API → http://localhost:8787
# Web → http://localhost:3000
# Admin → http://localhost:3001
```

## 5. 验证

### API 健康检查

```bash
curl http://localhost:8787/ping
# {"status":"ok","timestamp":"..."}
```

### 注册一个客户

```bash
curl -X POST http://localhost:8787/auth/register \
  -H "Content-Type: application/json" \
  -d '{"user_type":"customer","invite_code":"ADMIN-OPS-001","display_name":"测试客户"}'
```

应返回：
```json
{
  "data": {
    "user": { "id": "...", "userType": "customer", "displayName": "测试客户" },
    "mnemonic": "abandon abandon ... about",  // 24 词
    "access_token": "eyJhbGc...",
    "refresh_token": "eyJhbGc...",
    "expires_at": "..."
  }
}
```

### H5 注册 / 备份 / 找回

打开 http://localhost:3000 → 「开始注册」 → 选角色 + 填邀请码 + 提交 → 进入助记词备份页 → 抄写 + 勾选 → 进入首页。

退出后访问 http://localhost:3000/recover 输入助记词找回。

## 6. 数据库可视化

```bash
pnpm --filter @loverush/db studio
# 打开 Drizzle Studio：https://local.drizzle.studio
```

## 7. 已知限制

- API 暂未挂上限流 / 幂等中间件（Phase 1.6 之后注入 Redis 实例时启用）
- LLM 网关已就绪但尚未挂到任何 route（M03/M04 时启用）
- 端到端加密密钥仍是 `pending` 占位（M01 v2 由客户端生成密钥后上传）

## 8. 常见问题

**Q: `JWT_SECRET must be at least 32 chars`**
A: 用 `openssl rand -hex 32` 生成。

**Q: drizzle push 报 enum 已存在**
A: 切换数据库或手动 `DROP TYPE ... CASCADE` 后重试。

**Q: H5 注册返回 CORS 错误**
A: 检查 API 的 `.env.local` 里 `CORS_ORIGIN` 是否包含 `http://localhost:3000`。

---

下一步：Phase 2 开始模块化业务开发（M03 / M04 / M06）。
