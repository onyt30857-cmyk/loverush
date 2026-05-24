# OpenAPI 3.0 spec · LoveRush

`loverush-api.openapi.json` 是 LoveRush API 的契约文件，符合 OpenAPI 3.0.3。

## 当前覆盖

| 数量 | 内容 |
|---|---|
| **17 个 path** | 8 模块代表性端点（system / auth / me / orders / dispatch / chat / commerce / admin / webhooks） |
| **8 个 component schemas** | Order / OrderStatus / Withdrawal / RegisterBody / CreateOrderBody / AuditLogEntry / ApiOk / ApiError |
| **4 个共享响应** | BadRequest / Unauthorized / Forbidden / RateLimited |

完整 145+ 端点见 `API.md`；OpenAPI spec 按需补完，每加一个端点同步更新本文件。

## 三种用法

### 1. 浏览器查看（推荐 · 零依赖）

```bash
cd infra/openapi
python3 -m http.server 8000
# 然后打开 http://localhost:8000
```

或挂到 nginx：

```nginx
location /docs/api/ {
    alias /opt/loverush/infra/openapi/;
    try_files $uri $uri/ /docs/api/index.html;
}
```

Swagger UI 从 CDN 拉 `swagger-ui-dist@5.17.14`，**生产建议本地化** 避免依赖外部 CDN。

### 2. 导入 Postman / Insomnia

- Postman: File → Import → 选 `loverush-api.openapi.json`
- Insomnia: Application → Preferences → Data → Import Data → From File
- Stoplight Studio: File → Open Project → 选目录

### 3. 自动生成客户端 SDK

```bash
# TypeScript types only（推荐 · 轻量）
npx openapi-typescript@7 infra/openapi/loverush-api.openapi.json \
  -o apps/web/lib/api-types.gen.ts

# 完整 SDK（fetch / axios / etc）
npx openapi-typescript-codegen \
  --input infra/openapi/loverush-api.openapi.json \
  --output apps/web/lib/sdk

# 其他语言（Swift / Kotlin / Python / Go）
npx @openapitools/openapi-generator-cli generate \
  -i infra/openapi/loverush-api.openapi.json \
  -g typescript-fetch \
  -o sdk/ts
```

## 校验

```bash
# 1. JSON 合法性
python3 -c "import json; json.load(open('loverush-api.openapi.json'))"

# 2. OpenAPI 规范合法性（需 npm 包）
npx @redocly/cli@1 lint loverush-api.openapi.json

# 3. spec ↔ 实际 API 契约一致（dredd · 需运行中的 API）
npx dredd loverush-api.openapi.json http://localhost:8787
```

## 未覆盖端点（按需添加）

按模块分组的优先级（参考 `API.md`）：

| 优先级 | 模块 | 未覆盖端点示例 |
|---|---|---|
| P1 | M02 媒体审核 | `POST /me/media/profile` · `GET /admin/audit/queue` |
| P1 | M11 风控 | `POST /admin/risk/events/:id/resolve` |
| P2 | M06 关系画像 | `GET /me/relationships` |
| P2 | M14 邀请码 | `POST /invites/redeem` |
| P3 | M10 通知 | `POST /notifications/web-push/subscribe` |
| P3 | M15 隐私 | `POST /privacy/data-request` |

补完原则：**所有暴露给客户端 SDK 的端点必须有 spec**；纯 admin 内部端点可推迟。

## 版本控制

- `info.version` 与 `CHANGELOG.md` 主版本同步（当前 `0.24.0`）
- spec 变更视为 API 契约变更，PR 必须 review
- 破坏性变更（删字段 / 改类型）需在 CHANGELOG 标 BREAKING
