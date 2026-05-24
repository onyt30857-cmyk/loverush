# API.md · LoveRush API 端点清单

> ~140 个端点 · 按业务分组 · 含角色矩阵 + 关键示例。
> 完整实现：`apps/api/src/routes/*.ts`。

## 通用约定

### Base URL

| 环境 | URL |
|------|-----|
| Production | `https://api.loverush.com` |
| Local dev | `http://localhost:8787` |

### 鉴权

```
Authorization: Bearer <jwt_access_token>
```

token 由 `/auth/register` 或 `/auth/recover` 返回。`/webhooks/*` 不走 JWT，用渠道签名。

### 响应封装

所有 JSON 响应都是 `{ data?, error?, request_id? }`：

```json
{
  "data": { ... },
  "request_id": "uuid"
}
```

错误：

```json
{
  "error": {
    "code": "E2010",
    "message": "insufficient balance",
    "details": { ... },
    "request_id": "uuid",
    "timestamp": "2026-05-21T10:00:00Z"
  }
}
```

### 错误码体系（PRD §10.10）

| 段 | 含义 |
|----|------|
| 0000-0999 | 通用 |
| 1000-1999 | 认证 / 注册 |
| 2000-2999 | 用户 / 偏好 |
| 3000-3999 | 订单 / 凭证 |
| 4000-4999 | 私聊 / 翻译 |
| 5000-5999 | AI 分身 / 助理 |
| 6000-6999 | 商业 / 积分 |
| 7000-7999 | 风控 / 仲裁 |
| 8000-8999 | 数据 / 凭证链 |
| 9000-9999 | 系统 / 网络 |

常见：`E0001` 参数错 / `E0002` 幂等冲突 / `E0003` 未找到 / `E1001` 鉴权失败 / `E2010` 余额不足 / `E3050` 订单状态非法 / `E9000` 限流 / `E9999` 系统错。

---

## 1. 认证（M01）

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| POST | `/auth/register` | ❌ | BIP-39 匿名注册，返回 24 词助记词 |
| POST | `/auth/recover` | ❌ | 助记词找回 |

### POST /auth/register

```jsonc
// Request
{
  "user_type": "customer",          // 或 therapist
  "invite_code": "ADMIN-OPS-001",
  "display_name": "张三",            // 可选
  "locale": "zh"                    // 可选
}

// Response
{
  "data": {
    "user": { "id": "...", "userType": "customer", "displayName": "张三" },
    "mnemonic": "abandon abandon ... about",  // 24 词 · 仅此一次返回
    "access_token": "eyJ...",
    "refresh_token": "eyJ...",
    "expires_at": "2026-05-21T11:00:00Z"
  }
}
```

注：客户端拿到 mnemonic 后，**立即派生 X25519 公钥并调 `POST /me/encryption-key` 上传**。详见 ARCHITECTURE.md §5.3。

---

## 2. 用户 + 角色（M01 + D-103）

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| GET | `/me` | 🔑 | 当前用户（含积分 + 角色 + 技师段） |
| GET | `/me/orders` | 🔑 | 双角色自动判断 |
| GET | `/me/orders/any` | 🔑 | 同时为 customer + therapist 时用 |
| GET | `/me/roles` | 🔑 | 我的所有有效角色 |
| POST | `/me/encryption-key` | 🔑 | 上传 X25519 公钥（覆盖旧 key 标 expired）|
| GET | `/users/:userId/encryption-key` | 🔑 | 查对方公钥（用于 e2e 加密发送） |

---

## 3. 订单（M07）· 11 状态机

| Method | Path | 鉴权 | 角色要求 |
|--------|------|------|---------|
| POST | `/orders` | 🔑 | customer · 创建 DRAFT |
| POST | `/orders/:id/submit` | 🔑 | customer · DRAFT → PENDING_CONFIRM |
| POST | `/orders/:id/confirm` | 🔑 | 该单技师 · PENDING_CONFIRM → LOCKED + 锁价 hash |
| POST | `/orders/:id/pay` | 🔑 | customer · LOCKED → PAID |
| POST | `/orders/:id/start` | 🔑 | 该单技师 · PAID → IN_SERVICE |
| POST | `/orders/:id/complete` | 🔑 | 该单技师 · IN_SERVICE → COMPLETED |
| POST | `/orders/:id/review` | 🔑 | customer · COMPLETED → REVIEWED |
| POST | `/orders/:id/cancel` | 🔑 | 任一方 · → CANCELLED |
| POST | `/orders/:id/dispute` | 🔑 | 任一方 · IN_SERVICE/COMPLETED → DISPUTED |
| GET | `/orders/:id` | 🔑 | 订单详情 |
| GET | `/orders/:id/chain` | 🔑 | 凭证链 · 所有事件 |
| GET | `/orders/:id/chain/verify` | 🔑 | 链 hash 完整性校验 |
| POST | `/admin/orders/:id/resolve` | 🛡 admin/cs | 仲裁退款/驳回 |

---

## 4. 派单（M04）

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| POST | `/orders/:orderId/dispatch` | 🔑 customer | 给 Top-K 技师广播 offer |
| GET | `/me/offers` | 🔑 therapist | 我的 pending offers |
| POST | `/me/offers/:id/accept` | 🔑 therapist | 抢占接单（乐观锁）|
| POST | `/me/offers/:id/decline` | 🔑 therapist | 拒绝 |

---

## 5. 技师信息（M02）

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| GET | `/therapists/me` | 🔑 therapist | 我的完整 profile |
| PUT | `/therapists/me` | 🔑 therapist | 增量更新 + 自动算 completeness |
| GET | `/therapists/:id` | 🔑 | 按调用方差异化字段（self/admin/paid/free） |
| POST | `/therapists/me/media/upload-init` | 🔑 therapist | R2 pre-signed PUT URL |
| POST | `/therapists/me/media/finalize` | 🔑 therapist | 上传完成回调 + 进审核队列 |
| POST | `/therapists/:id/unlock` | 🔑 customer | 付费墙解锁（social_contacts / gallery_paid） |
| GET | `/therapists/:id/unlocks` | 🔑 | 我已解锁的项 |
| POST | `/therapists/me/ai-alter/configure` | 🔑 therapist | 启用 + personality 配置 |

---

## 6. 私聊 + 翻译（M05）

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| POST | `/conversations` | 🔑 | 开会话（customerId+therapistUserId 唯一） |
| GET | `/conversations` | 🔑 | 我的会话列表 |
| GET | `/conversations/:id/messages` | 🔑 | 分页拉消息 |
| POST | `/conversations/:id/messages` | 🔑 | 发消息（`is_encrypted: true` 跳过翻译/AI 分身） |
| POST | `/conversations/:id/read` | 🔑 | 标已读 |
| POST | `/translate` | 🔑 | 独立翻译（不入消息表） |

---

## 7. AI 助理（M03）· 客户端

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| GET | `/assistant/greet` | 🔑 customer | 动态打招呼（v5 ZERO AI 标识） |
| POST | `/assistant/chat` | 🔑 customer | 连续对话 + 异步偏好抽取 |
| GET | `/assistant/recommend` | 🔑 customer | 1-3 个推荐 + LLM 重排留口 |
| POST | `/me/blocks` | 🔑 | 封锁用户 |
| GET | `/me/blocks` | 🔑 | 已封锁列表 |
| DELETE | `/me/blocks/:targetUserId` | 🔑 | 解锁 |
| POST | `/me/behavior/recompute` | 🔑 | 重算 steady/explorer/mixed mode |

---

## 8. 商业（M09）

### 支付 + 付费墙

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| POST | `/payments/recharge` | 🔑 | `{channel: stub/stripe}` · stripe 返 client_secret |
| POST | `/webhooks/stripe` | ❌ | Stripe 签名校验 + 入账（D-101） |

### 橱窗

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| GET | `/shop/items` | 🔑 | 商品池（含分页 + category 筛选） |
| GET | `/shop/by-therapist/:therapistId` | 🔑 | 技师橱窗 |
| PUT | `/shop/me/listings` | 🔑 therapist | 上架/下架/调价 |
| POST | `/shop/orders` | 🔑 customer | 下单 + 分成结算 |

### 小费 + 提现

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| POST | `/tips` | 🔑 customer | 给小费（12% 平台抽成） |
| POST | `/me/withdrawals` | 🔑 therapist | 申请提现（≥ $50） |
| GET | `/me/withdrawals` | 🔑 therapist | 我的提现记录 |
| GET | `/admin/withdrawals` | 🛡 admin/finance | 提现列表（按 status） |
| POST | `/admin/withdrawals/:id/approve` | 🛡 admin/finance | 批准 + 外部 txn ref |
| POST | `/admin/withdrawals/:id/reject` | 🛡 admin/finance | 拒绝 + 解冻 |

---

## 9. 评价（M08）

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| POST | `/reviews` | 🔑 customer | 三维评分 + 滑窗均值刷新 |
| GET | `/reviews/therapist/:therapistId` | 🔑 | 列出某技师评价（剔除 isHidden=1） |
| POST | `/reviews/:id/appeal` | 🔑 therapist | 申诉差评 |
| POST | `/admin/reviews/:id/resolve` | 🛡 admin/cs | 仲裁（uphold / hide） |

---

## 10. 工单（M12）

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| POST | `/tickets` | 🔑 | 创建工单 + 异步 LLM 分类 |
| GET | `/tickets/me` | 🔑 | 我创建的工单 |
| GET | `/tickets/:id` | 🔑 | 工单详情 + 沟通历史 |
| POST | `/tickets/:id/replies` | 🔑 | 回复（自动判断 role） |
| GET | `/admin/tickets` | 🛡 admin/cs | 工单队列 |
| POST | `/admin/tickets/:id/assign` | 🛡 admin/cs | 指派 |
| POST | `/admin/tickets/:id/resolve` | 🛡 admin/cs | 5 种裁决（refund/warn/suspend/ban/dismiss） |

---

## 11. 通知（M13）

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| GET | `/notifications` | 🔑 | 通知列表（unread_only 过滤） |
| POST | `/notifications/read` | 🔑 | 批量标已读 |
| POST | `/notifications/read-all` | 🔑 | 全部已读 |
| GET | `/notifications/preferences` | 🔑 | 推送偏好 |
| PUT | `/notifications/preferences` | 🔑 | 改偏好 / 静默时段 |
| POST | `/notifications/web-push/subscribe` | 🔑 | Web Push 订阅 |
| POST | `/notifications/web-push/unsubscribe` | 🔑 | 取消订阅 |

---

## 12. 邀请码（M10）

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| POST | `/invites/codes` | 🔑 | 生成 T/U/R 类码 |
| GET | `/invites/codes` | 🔑 | 我的有效码 |
| GET | `/invites/invitees` | 🔑 | 我邀请的人 |
| GET | `/invites/r-code` | 🔑 therapist | R 码等级 + 累计收益 |

---

## 13. 隐私模式（M15）

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| GET | `/privacy` | 🔑 | 我的隐私设置（不返 pinHash） |
| PUT | `/privacy` | 🔑 | 改设置 |
| POST | `/privacy/pin` | 🔑 | 设置/修改 PIN |
| POST | `/privacy/pin/verify` | 🔑 | 校验 PIN（带防爆破锁定） |
| DELETE | `/privacy/pin` | 🔑 | 清除 PIN |

---

## 14. 风控审核（M11 + M02）

| Method | Path | 角色 | 说明 |
|--------|------|------|------|
| GET | `/admin/audit/queue` | 🛡 admin/auditor | 审核队列 |
| POST | `/admin/audit/:id/approve` | 🛡 admin/auditor | 通过 + 副作用同步 |
| POST | `/admin/audit/:id/reject` | 🛡 admin/auditor | 拒绝 + 媒体软删 |
| GET | `/admin/risk/events` | 🛡 admin/ops | 风控事件 |
| POST | `/admin/risk/events/:id/resolve` | 🛡 admin/ops | 4 种处置 |
| POST | `/admin/risk/blacklist` | 🛡 admin/ops | IP 黑名单（hash 存储） |
| POST | `/admin/risk/price-guard/:therapistId/evaluate` | 🛡 admin/ops | 触发 30 单偏差检测 |

---

## 15. 用户管理（admin）

| Method | Path | 角色 | 说明 |
|--------|------|------|------|
| GET | `/admin/users` | 🛡 admin/cs | 列表（user_type + status + search） |
| GET | `/admin/users/:id` | 🛡 admin/cs | 详情（含积分 + 角色 + 技师档案） |
| POST | `/admin/users/:id/suspend` | 🛡 admin/cs | 暂停 + 写风控 |
| POST | `/admin/users/:id/ban` | 🛡 admin/cs | 永久封禁 |
| POST | `/admin/users/:id/restore` | 🛡 admin/cs | 解封 |
| POST | `/admin/roles` | 🛡 admin only | 赋角色（5 种） |
| DELETE | `/admin/roles` | 🛡 admin only | 撤角色 |
| GET | `/admin/roles/:role/users` | 🛡 admin only | 某角色持有者 |

---

## 16. 灰度 + 看板 + 埋点（M14 + Phase 6）

### 灰度

| Method | Path | 角色 | 说明 |
|--------|------|------|------|
| GET | `/flags` | 🔑 | 我的全部 flag 状态 |
| GET | `/flags/:key` | 🔑 | 单个 flag |
| GET | `/admin/flags` | 🛡 admin/ops | 列全部 |
| PUT | `/admin/flags/:key` | 🛡 admin/ops | upsert（含 targeting） |
| POST | `/admin/flags/:key/overrides` | 🛡 admin/ops | 为用户设 override |
| DELETE | `/admin/flags/:key/overrides/:userId` | 🛡 admin/ops | 移除 override |

### 看板

| Method | Path | 角色 | 说明 |
|--------|------|------|------|
| GET | `/dashboard/therapist/me` | 🔑 therapist | 技师 KPI |
| GET | `/dashboard/customer/me` | 🔑 customer | 客户消费 |
| GET | `/admin/dashboard` | 🛡 admin/ops | DAU/WAU/MAU + 漏斗 + GMV |

### 埋点

| Method | Path | 角色 | 说明 |
|--------|------|------|------|
| POST | `/events` | 🔑 | 通用埋点上报 |
| GET | `/admin/analytics/daily` | 🛡 admin/ops | 日聚合查询 |
| POST | `/admin/analytics/aggregate-yesterday` | 🛡 admin/ops | 手动触发聚合 |

---

## 角色矩阵（一图概览）

```
                 admin   cs    finance  auditor  ops
/admin/audit       ✓      .      .        ✓       .
/admin/risk        ✓      .      .        .       ✓
/admin/users       ✓      ✓      .        .       .
/admin/roles       ✓      .      .        .       .
/admin/orders      ✓      ✓      .        .       .
/admin/tickets     ✓      ✓      .        .       .
/admin/reviews     ✓      ✓      .        .       .
/admin/withdraw    ✓      .      ✓        .       .
/admin/flags       ✓      .      .        .       ✓
/admin/dashboard   ✓      .      .        .       ✓
/admin/analytics   ✓      .      .        .       ✓
```

第一个 admin 必须用 SQL 直接 INSERT，避免循环依赖：

```sql
INSERT INTO user_roles (user_id, role) VALUES ('<uuid>', 'admin');
```

---

## 健康检查 + 元信息

| Method | Path | 鉴权 | 说明 |
|--------|------|------|------|
| GET | `/ping` | ❌ | `{ status: "ok", timestamp }` |
| GET | `/` | ❌ | `{ name, version, docs }` |

---

## 完整源码索引

- 总入口：`apps/api/src/index.ts` 路由挂载
- 业务实现：`apps/api/src/services/*.ts`（25 个 service）
- HTTP 层：`apps/api/src/routes/*.ts`（18 个 route 文件）
- 中间件：`apps/api/src/middleware/{auth,role,errors,i18n,tracing,idempotency,rate-limit}.ts`
- 错误码：`packages/types/src/errors.ts`
