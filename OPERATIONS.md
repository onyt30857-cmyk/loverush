# OPERATIONS.md · 日常运维 SOP

> D-Day 后的运维操作手册。给值班 / 客服 / 财务 / 运营用。
> 上线前流程见 `DEPLOY.md` · 上线日策略见 `LAUNCH.md` · 应急回滚见 `LAUNCH.md §4`。

---

## 0. 谁该读哪部分

| 角色 | 必读章节 |
|------|---------|
| 值班工程师 | §1 健康检查 + §2 监控指标 + §6 故障排查 + §10 应急联系 |
| 客服 (cs) | §3 工单 + §4 用户管理 + §5 风控事件 |
| 财务 (finance) | §7 提现 + §8 对账 |
| 运营 (ops) | §2 监控 + §9 灰度 + §11 看板 |
| 审核员 (auditor) | §3 审核队列 |

---

## 1. 健康检查

每天早上和值班交接时跑一遍。

```bash
# API 存活
curl -sf https://api.loverush.com/ping
# {"status":"ok","timestamp":"..."}

# 数据库连通
psql $DATABASE_URL -c "SELECT version(); SELECT count(*) FROM users;"

# Redis 连通
redis-cli -u $REDIS_URL ping
# PONG

# Cloudflare Pages 状态
curl -sI https://loverush.com | head -1
# HTTP/2 200

# Stripe webhook 端点（应返 400 missing signature，证明 endpoint 存活）
curl -X POST https://api.loverush.com/webhooks/stripe -d '{}' -I | head -1
# HTTP/2 400  ← 这是对的
```

---

## 2. 监控指标 · 每日运营查询

### 业务大盘（admin/ops）

```bash
# admin 调用（用 admin user 的 JWT）
ADMIN_TOKEN="<jwt>"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://api.loverush.com/admin/dashboard?range_days=1" | jq

# 关心 4 项：
# - activity.dau         · 越大越好（基线 100+）
# - gmv.gmv_points       · 累计 GMV
# - refund_dispute.refunded / completed   · 健康 < 3% · 告警 > 8%
# - refund_dispute.disputed / completed   · 健康 < 2% · 告警 > 5%
```

### 关键 SQL 模板

```sql
-- DAU 趋势（过去 7 天）
SELECT
  DATE(occurred_at) AS day,
  COUNT(DISTINCT actor_user_id) AS dau
FROM analytics_events
WHERE occurred_at >= NOW() - INTERVAL '7 days'
GROUP BY day
ORDER BY day;

-- 订单漏斗（过去 24h）
SELECT status, COUNT(*) FROM orders
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY status
ORDER BY count DESC;

-- 退款率（过去 7 天）
SELECT
  COUNT(*) FILTER (WHERE status IN ('COMPLETED','REVIEWED'))::float
  / NULLIF(COUNT(*), 0) AS completion_rate,
  COUNT(*) FILTER (WHERE status = 'REFUNDED')::float
  / NULLIF(COUNT(*) FILTER (WHERE status IN ('COMPLETED','REVIEWED','REFUNDED')), 0) AS refund_rate
FROM orders
WHERE created_at >= NOW() - INTERVAL '7 days';

-- 收入构成（过去 30 天 USD）
SELECT
  SUM(amount_cents) FILTER (WHERE method IS NOT NULL) / 100.0 AS withdrawal_usd
FROM withdrawals
WHERE status = 'paid'
  AND paid_at >= NOW() - INTERVAL '30 days';

-- 最活跃的 10 个技师（过去 7 天）
SELECT
  u.display_name,
  t.id,
  COUNT(o.id) AS completed_orders,
  SUM(o.price_points) AS total_points
FROM orders o
JOIN therapists t ON t.id = o.therapist_id
JOIN users u ON u.id = t.user_id
WHERE o.status IN ('COMPLETED','REVIEWED')
  AND o.completed_at >= NOW() - INTERVAL '7 days'
GROUP BY u.display_name, t.id
ORDER BY total_points DESC
LIMIT 10;
```

---

## 3. 审核队列（auditor / admin）

### 日常清单

```bash
# 看待审数量
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.loverush.com/admin/audit/queue?status=pending&limit=200" | jq 'length'

# 处理一条
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "https://api.loverush.com/admin/audit/<audit_id>/approve"

# 拒绝
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"图片不清晰","category":"低质量"}' \
  "https://api.loverush.com/admin/audit/<audit_id>/reject"
```

### SLA

- **liveness（真人核验）**：4h
- **profile（首次提交）**：24h
- **media（普通照片）**：48h
- **超时未审** → admin 后台首页会标红

### 拒绝原因模板（粘到 admin UI 里）

- 涉黄：「内容含有露点或性暗示，请调整后重新提交」
- 模糊不清：「照片清晰度不足，请上传分辨率 ≥ 720p 的清晰图」
- 真实性存疑：「与其他公开照片高度雷同，请提供本人持证照片以核验」
- liveness 失败：「光线不足或转头幅度不够，请在亮处重录」

---

## 4. 用户管理（cs / admin）

### 处理客诉常用

```bash
# 1. 按昵称搜
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.loverush.com/admin/users?search=张三&limit=20"

# 2. 看用户详情（含积分/角色/技师档案）
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.loverush.com/admin/users/<uuid>"

# 3. 暂停
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"恶意刷单 3 次以上"}' \
  "https://api.loverush.com/admin/users/<uuid>/suspend"

# 4. 永久封禁（不可逆）
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"实施 IP 黑名单关联欺诈"}' \
  "https://api.loverush.com/admin/users/<uuid>/ban"

# 5. 解封
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "https://api.loverush.com/admin/users/<uuid>/restore"
```

### 处罚阶梯（建议）

| 行为 | 第一次 | 第二次 | 第三次 |
|------|--------|--------|--------|
| 联系方式诱导 | 警告 | 暂停 3 天 | 暂停 14 天 |
| 价格异常 | 警告 | 进入冷却 | 暂停 |
| 真实性存疑 | 强制重审 | 暂停 7 天 | 封禁 |
| 涉违法关键词 | 直接封禁 | — | — |

---

## 5. 风控事件（cs / ops）

### 每日处理

```bash
# 拉未处置事件（按 severity 降序）
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.loverush.com/admin/risk/events?unresolved_only=true&limit=200"

# 处置一条
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resolution":"warn"}' \
  "https://api.loverush.com/admin/risk/events/<event_id>/resolve"

# resolution 可选：dismiss / warn / suspend / ban
```

### 事件类型 → 处置建议

| event_type | 严重度 | 建议处置 |
|------------|--------|---------|
| `price_deviation_high` | 70 | warn（首次）→ suspend（累计 3 次） |
| `device_multi_account` | 60 | 调查后 warn 或 suspend |
| `ip_blacklist_hit` | 80 | suspend 直至证据消除 |
| `abnormal_behavior` | 50 | 视具体场景 |
| `repeat_dispute` | 75 | 双方都调查 + suspend 主诉方 |

### IP 黑名单

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ip":"1.2.3.4","reason":"已知欺诈代理","severity":80,"expires_at":"2026-08-21T00:00:00Z"}' \
  "https://api.loverush.com/admin/risk/blacklist"
```

---

## 6. 故障排查（值班工程师）

### 6.1 API 5xx 突增

```bash
# 1. 看 Sentry 最新 issues
# 2. SSH 上 Vultr 看日志
sudo journalctl -u loverush-api -f --since "10 minutes ago" | grep -i error

# 3. 看 nginx access 日志
sudo tail -f /var/log/nginx/access.log | grep " 5[0-9][0-9] "

# 4. 看数据库连接数（可能耗尽）
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity WHERE state='active';"

# 5. 看 LLM API 速率限制
# Sentry 里搜 error_code=RATE_LIMIT
```

### 6.2 Stripe webhook 收不到 / 重复

```bash
# Stripe Dashboard → Webhooks → 看 attempts

# 服务端是否有日志
sudo journalctl -u loverush-api | grep "/webhooks/stripe"

# 看 idempotency 表里 stripe_<event.id> 是否已写入（防重投正常）
psql $DATABASE_URL -c \
  "SELECT * FROM points_transaction WHERE idempotency_key LIKE 'stripe_%' ORDER BY created_at DESC LIMIT 10;"
```

### 6.3 R2 上传失败 403

```bash
# 1. 看 R2 token 权限（Object Read & Write）
# 2. 看 CORS 规则（H5 直传必须 PUT 在 AllowedMethods）
# 3. 看 bucket public access 是否开启自定义域

# 测试签名 URL（用 curl PUT 一个小文件）
curl -X PUT -H "Content-Type: image/jpeg" \
  --data-binary @test.jpg \
  "https://signed-url-from-api"
```

### 6.4 私聊消息延迟

```bash
# H5 是 5s 轮询，正常延迟 < 5s
# 如果用户报告 > 30s：

# 1. 看消息表写入是否成功
psql $DATABASE_URL -c \
  "SELECT id, conversation_id, sent_at FROM messages
   WHERE conversation_id='<id>' ORDER BY sent_at DESC LIMIT 5;"

# 2. 看翻译表是否阻塞（应该是异步的）
psql $DATABASE_URL -c \
  "SELECT count(*) FROM messages WHERE content_language IS NULL AND is_encrypted = 0;"

# 3. 看 AI 分身钩子是否触发循环
psql $DATABASE_URL -c \
  "SELECT therapist_user_id, count(*) FROM ai_alter_messages
   WHERE created_at > NOW() - INTERVAL '1 hour'
   GROUP BY therapist_user_id ORDER BY count DESC LIMIT 5;"
```

### 6.5 数据库慢查询

```sql
-- 看当前正在跑的慢查询
SELECT pid, age(clock_timestamp(), query_start), usename, query
FROM pg_stat_activity
WHERE state = 'active' AND query_start < now() - interval '5 seconds'
ORDER BY query_start;

-- 看缺失的索引候选（pg_stat_user_tables · 大量 seq_scan）
SELECT schemaname, relname, seq_scan, idx_scan
FROM pg_stat_user_tables
WHERE seq_scan > 1000
ORDER BY seq_scan DESC
LIMIT 20;
```

---

## 7. 提现批准（finance）

### 工作流

```bash
# 1. 拉待审提现
curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.loverush.com/admin/withdrawals?status=pending"

# 2. 用 Wise / Stripe Connect / USDT 钱包真打款
# （这是手动外部操作）

# 3. 批准：写入外部 txn ref
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"external_txn_ref":"WISE_TXN_xxx"}' \
  "https://api.loverush.com/admin/withdrawals/<id>/approve"

# 4. 拒绝（解冻技师 earnings.available_cents）
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"账户信息不匹配，请重新提交"}' \
  "https://api.loverush.com/admin/withdrawals/<id>/reject"
```

### 风控点

- 同一收款账号短期多技师提现 → 怀疑代提现
- 单笔 > $1000 → 二审
- 注册不满 7 天首次提现 → 强制延迟 48h

---

## 8. 对账（finance · 每周一）

```sql
-- 上周收入总额 vs 提现总额（口径必须一致）
SELECT
  COALESCE(SUM(amount_cents) FILTER (WHERE method IS NOT NULL), 0) / 100.0 AS total_paid_out,
  (SELECT SUM(tip_earnings_cents + shop_commission_cents + invite_rewards_cents) / 100.0
     FROM therapist_earnings) AS total_earned_to_date
FROM withdrawals
WHERE paid_at >= DATE_TRUNC('week', NOW()) - INTERVAL '7 days'
  AND paid_at < DATE_TRUNC('week', NOW());

-- 积分流水累计平衡（必须 in - out = balance）
SELECT
  SUM(CASE WHEN direction = 'IN' THEN amount ELSE 0 END) AS total_in,
  SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END) AS total_out
FROM points_transaction
WHERE user_id = '<user>';

SELECT balance, total_in, total_out FROM points_account WHERE user_id = '<user>';
-- 上下两个应该完全一致 · 不一致就是丢账
```

---

## 9. 灰度发布（ops）

```bash
# 看所有 flag
curl -sS -H "Authorization: Bearer $TOKEN" "https://api.loverush.com/admin/flags"

# 上调灰度（500 → 2500 = 5% → 25%）
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rollout_bps":2500}' \
  "https://api.loverush.com/admin/flags/<flag_key>"

# 紧急关闭
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}' \
  "https://api.loverush.com/admin/flags/<flag_key>"

# 内测用户加 override
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"user_id":"<uuid>","enabled":true,"reason":"内测"}' \
  "https://api.loverush.com/admin/flags/<flag_key>/overrides"
```

---

## 10. 应急联系（按事件升级）

| 严重度 | 阈值 | 联系方式 |
|--------|------|---------|
| P0 全站故障 | API 5xx > 50% / DB 不可达 / 资金错账 | 立刻电话值班 + 拉群 |
| P1 单功能挂 | 某 flag 后果不达预期 / 单 endpoint 5xx 集中 | Slack 告警 + 15min 响应 |
| P2 数据异常 | 积分对不上 / 评分跳变 / 边缘 case 错 | Slack 告警 + 4h 响应 |
| P3 体验问题 | 翻译质量差 / AI 推荐不准 / UI 错乱 | 工单 + 工作时间响应 |

---

## 11. 看板（ops）

每周一发周报：

```sql
-- 周指标
WITH last_week AS (
  SELECT * FROM analytics_events WHERE occurred_at >= NOW() - INTERVAL '7 days'
)
SELECT
  (SELECT COUNT(DISTINCT actor_user_id) FROM last_week) AS wau,
  (SELECT COUNT(*) FROM orders WHERE created_at >= NOW() - INTERVAL '7 days') AS orders,
  (SELECT COUNT(*) FROM orders WHERE status IN ('COMPLETED','REVIEWED') AND completed_at >= NOW() - INTERVAL '7 days') AS completed,
  (SELECT SUM(price_points) FROM orders WHERE status IN ('PAID','IN_SERVICE','COMPLETED','REVIEWED') AND paid_at >= NOW() - INTERVAL '7 days') AS gmv_points,
  (SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '7 days') AS new_users,
  (SELECT COUNT(*) FROM tickets WHERE opened_at >= NOW() - INTERVAL '7 days') AS new_tickets;
```

---

## 12. 常用查询书签

| 想看 | SQL |
|------|------|
| 在线技师列表 | `SELECT u.display_name, t.service_city FROM therapists t JOIN users u ON u.id = t.user_id WHERE t.online_status = 'online' ORDER BY t.last_online_at DESC;` |
| 卡在 PENDING_CONFIRM 超 5min 的订单 | `SELECT id, order_no, created_at FROM orders WHERE status='PENDING_CONFIRM' AND created_at < NOW() - INTERVAL '5 minutes';` |
| 余额异常（balance < 0 不应发生） | `SELECT user_id, balance FROM points_account WHERE balance < 0;` |
| Web Push 失败累计 ≥ 3 的订阅 | `SELECT user_id, endpoint, failure_count FROM web_push_subscriptions WHERE failure_count >= 3;` |
| 长期未活跃用户（30 天没登录） | `SELECT count(*) FROM users WHERE last_active_at < NOW() - INTERVAL '30 days';` |

---

## 13. 备份与恢复

```bash
# 每日全库备份（cron）
pg_dump $DATABASE_URL > backups/$(date +%Y%m%d)-full.sql

# 仅 schema
pg_dump --schema-only $DATABASE_URL > schema.sql

# 只导关键表（出事时快速取证）
pg_dump $DATABASE_URL \
  -t orders -t order_chain -t points_transaction \
  -t reviews -t risk_events \
  > backups/critical-$(date +%Y%m%d%H%M).sql

# 从备份还原（最后一招）
psql $DATABASE_URL < backups/20260520-full.sql
```

### 13.1 推荐：定时备份 + R2 异地存储

生产环境推荐使用 `scripts/backup-cron.sh`：

- 每日 03:00 UTC（曼谷 10:00）自动 `pg_dump | gzip` → 上传 Cloudflare R2
- 周日的备份自动升级为周备份（独立目录）
- 日备份保留 7 天，周备份保留 8 周
- dump 体积 < 1KB 视为异常，触发 webhook 告警

部署：

```bash
# 1. 环境变量
sudo install -m 600 -o loverush -g loverush /dev/null /etc/loverush/backup.env
sudo vi /etc/loverush/backup.env   # 填 PG_DUMP_URL / R2_* / ALERT_WEBHOOK

# 2. cron
echo '0 3 * * *  loverush  /opt/loverush/scripts/backup-cron.sh >> /var/log/loverush/backup.log 2>&1' \
  | sudo tee /etc/cron.d/loverush-backup

# 3. 手工跑一次验证
sudo -u loverush /opt/loverush/scripts/backup-cron.sh
```

恢复演练（建议每月一次，在 staging 库）：

```bash
aws s3 cp s3://loverush-backups/daily/loverush-<TS>.sql.gz . \
  --endpoint-url $R2_ENDPOINT
gunzip loverush-<TS>.sql.gz
psql $STAGING_DATABASE_URL < loverush-<TS>.sql
```

### 13.2 Grafana 仪表盘

`infra/grafana/loverush-dashboard.json` 对接 `/metrics`：

- Prometheus 抓 `/metrics`（scrape_interval: 30s 即可）
- Grafana → Dashboards → Import → 上传 JSON → 选 Prometheus 数据源
- 15 个 panel：DAU/GMV/派单中/待审/工单/风控/提现 + 时序 + 结构快照
- 阈值与 LAUNCH.md §3 告警线对齐（工单 > 50 红、风控 > 30 红、提现 > 20 红）

### 13.3 i18n 一致性

CI 必跑 `bun scripts/check-i18n.ts`，检查 zh/en/th/vi/ms/id 六语种 key 对齐。
退出码非 0（缺 key / 空译 / 占位符不匹配）阻塞合并。

### 13.4 结构化日志 · NDJSON

API 进程输出的每一行都是 pino 兼容的 NDJSON：

```json
{"level":"info","time":"2026-05-21T03:12:45.123Z","msg":"http_access","request_id":"01J...","method":"POST","path":"/orders","status":201,"duration_ms":42,"user_id":"u-9"}
```

| 字段 | 含义 |
|---|---|
| `level` | `debug` / `info` / `warn` / `error` |
| `time` | ISO-8601 UTC |
| `msg` | 事件类型；常见：`http_access`、`unhandled exception`、`stripe webhook handler failed`、`web_push_stub` |
| `request_id` | hono/request-id 自动生成，可贯穿请求链路 |
| `err` | 异常对象自动展开为 `{name, message, stack}` |

环境变量：

- `LOG_LEVEL=info`（默认）· 生产建议 `info`，调试可 `debug`，告警泛滥时调 `warn`
- `LOG_PRETTY=1` · 开发期带缩进，**生产严禁开启**

**warn / error 走 stderr，info / debug 走 stdout** —— 配合 systemd / docker 默认日志分流；Loki 抓 `journalctl` 或 docker stdout 即可解析。

查询常用样例（jq）：

```bash
# 当前活跃用户的 5xx 错误
journalctl -u loverush-api -o cat | jq -c 'select(.level=="error")'

# 按 request_id 追踪一次请求
journalctl -u loverush-api -o cat | jq -c "select(.request_id==\"01J7XXX\")"

# Stripe webhook 失败
journalctl -u loverush-api -o cat | jq -c 'select(.msg|startswith("stripe"))'
```

---

## 14. 后台操作审计（admin · 合规与追责）

所有敏感 admin 操作自动写入 `admin_audit_log` 表（append-only）并发结构化日志。

**当前覆盖的 action：**

| action | 触发位置 | 入库字段 |
|---|---|---|
| `user.suspend` / `user.ban` / `user.restore` | admin 操作用户 | before/after 含 `status`、`bannedAt` |
| `role.grant` / `role.revoke` | admin 改角色 | after.role / before.role |
| `withdraw.approve` / `withdraw.reject` | finance 审批提现 | after 含 status / amountPoints / externalTxnRef |

每条记录留：actor_user_id / actor_role / action / target_type / target_id / before / after / reason / request_id / ip / user_agent / created_at

### 14.1 查询 API（仅 admin）

```bash
# 最近 50 条
curl -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/audit-log"

# 按 actor 查
curl ".../admin/audit-log?actor_user_id=u-9&limit=100"

# 按动作类型查
curl ".../admin/audit-log?action=withdraw.approve&since=2026-05-14T00:00:00Z"

# 锁定某个对象的全部操作（追责必查）
curl ".../admin/audit-log?target_type=user&target_id=u-victim"
```

### 14.2 SQL 直查（值班 / 取证）

```sql
-- 某个用户的全部被操作历史
SELECT created_at, actor_role, action, reason, before, after
FROM admin_audit_log
WHERE target_type='user' AND target_id='<user-id>'
ORDER BY created_at DESC;

-- 24h 内的所有提现批准
SELECT created_at, actor_user_id, target_id, after->>'amountPoints' AS amount, after->>'externalTxnRef' AS ref
FROM admin_audit_log
WHERE action='withdraw.approve' AND created_at > now() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- 某个 admin 的操作画像（疑似账号被盗时）
SELECT action, count(*), max(created_at) AS last_at
FROM admin_audit_log
WHERE actor_user_id='<admin-id>' AND created_at > now() - INTERVAL '7 days'
GROUP BY action ORDER BY count(*) DESC;
```

### 14.3 安全保障（三层防御）

1. **应用层**：服务只调 `recordAudit()` 走 INSERT，不暴露 UPDATE / DELETE 端点
2. **DB 权限**：建议 `GRANT INSERT, SELECT ON admin_audit_log TO loverush_app;`（不给 U/D）
3. **DB 触发器**：`migrations/0003_admin_audit_append_only.sql` 安装后，即使权限配错，UPDATE / DELETE / TRUNCATE 都会被 PostgreSQL 直接 RAISE EXCEPTION

```sql
-- 验证触发器生效（应当报错）
UPDATE admin_audit_log SET reason='tampered' WHERE id='<any>';
-- ERROR:  admin_audit_log is append-only (UPDATE forbidden); use a new INSERT to correct mistakes

DELETE FROM admin_audit_log WHERE id='<any>';
-- ERROR:  admin_audit_log is append-only (DELETE forbidden); ...

TRUNCATE admin_audit_log;
-- ERROR:  admin_audit_log is append-only (TRUNCATE forbidden)
```

- 审计 DB 写失败 → 业务不阻塞但 `logger.error('audit insert failed', ...)` 留痕，可用日志聚合反查丢失
- 不要把审计表暴露给 cs / ops，只 admin 可查（路由已加 `requireRole(['admin'])`）
- **例外**：超级用户（postgres）仍可绕过触发器做手动维护——这是为运维留的逃生口

### 14.4 CSV 导出（合规审计师）

```bash
# 全量过去 30 天（默认 limit=5000 行，最大 50000）
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API/admin/audit-log.csv?since=2026-04-22T00:00:00Z" \
  -o audit-202604.csv

# 锁定某个用户 + 时间窗
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$API/admin/audit-log.csv?target_type=user&target_id=u-victim&limit=50000" \
  -o user-u-victim-trail.csv
```

- 响应 header `X-Audit-Row-Count` 标明行数
- 字段：`created_at, actor_user_id, actor_role, action, target_type, target_id, reason, request_id, ip, user_agent, before, after`
- jsonb 列（before / after）会被序列化为内嵌 JSON 字符串（RFC 4180 安全转义）
- 仅 `admin` 角色可访问，路由独立挂在 `/admin/audit-log.csv`

### 14.5 月度归档（cron · 主表不删）

`scripts/audit-archive.sh` 每月 1 号 04:00 UTC：

```
admin_audit_log  ─ psql COPY ─→  audit-YYYY-MM.csv.gz  ─ aws s3 cp ─→  R2 audit-archive/YYYY-MM/
```

- **主表不 DELETE**（DB 触发器禁止 DELETE，append-only 是合规底线）
- 上月零审计 → 告警（admin 没操作 = 异常）
- 部署：`/etc/cron.d/loverush-audit-archive`
- 恢复演练（季度）：
  ```bash
  aws s3 cp s3://loverush-backups/audit-archive/2026-04/audit-2026-04.csv.gz . \
    --endpoint-url $R2_ENDPOINT
  zcat audit-2026-04.csv.gz | head -3   # 确认表头 + 第一行
  ```

### 14.6 当前覆盖矩阵（13 个 action）

| 模块 | actorRole | actions |
|---|---|---|
| 用户管理 | admin | `user.suspend` / `user.ban` / `user.restore` |
| 角色管理 | admin | `role.grant` / `role.revoke` |
| 财务 | finance | `withdraw.approve` / `withdraw.reject` |
| Feature Flag | ops | `flag.upsert` / `flag.override.set` / `flag.override.remove` |
| 工单 | cs | `ticket.assign` / `ticket.resolve` |
| 订单仲裁 | cs | `order.resolve_dispute` |

---

## 15. 审计告警（Phase 28 · ops / oncall）

### 15.1 暴露的指标（`/metrics`）

| metric | type | 含义 | 阈值 |
|---|---|---|---|
| `loverush_audit_events_24h{actor_role,action}` | gauge | 24h 内审计事件计数（多维） | 切片分析用 |
| `loverush_audit_high_freq_actors_24h` | gauge | 24h 内操作 ≥ 30 次的 admin 数 | **> 0 → P0** |
| `loverush_audit_targets_multi_actor_24h` | gauge | 24h 内被 ≥ 2 admin 操作的目标数 | > 5 → P1 |
| `loverush_audit_insert_failed_total` | counter | 进程级累计：审计写库失败 | **> 0 → P0**（合规底线） |

### 15.2 Prometheus 告警规则

`infra/prometheus/rules.yml` · 部署到 `/etc/prometheus/rules/loverush.yml`，prometheus.yml 加：

```yaml
rule_files:
  - /etc/prometheus/rules/*.yml
```

3 个 group · 9 alert：`loverush_business` (4) / `loverush_audit_anomaly` (4) / `loverush_system` (1)。

`infra/prometheus/rules.test.yml` 是 promtool unit-test 文件 · 13 个断言覆盖 6 个 alert 的"该触发就触发，不该就不触发"。本地跑：

```bash
# 直接 docker 跑（与 CI 一致）
docker run --rm -v "$PWD/infra/prometheus:/work" -w /work \
  prom/prometheus:v2.54.1 \
  promtool check rules rules.yml

docker run --rm -v "$PWD/infra/prometheus:/work" -w /work \
  prom/prometheus:v2.54.1 \
  promtool test rules rules.test.yml
```

CI 强阻断（任一 case 失败 → PR 拒绝合并）。

#### 关键告警（按 severity）

| alert | severity | for | 触发条件 |
|---|---|---|---|
| `AuditInsertFailureSpike` | **critical** | 1m | `increase(loverush_audit_insert_failed_total[10m]) > 0` |
| `AuditHighFrequencyAdmin` | **critical** | 15m | `loverush_audit_high_freq_actors_24h > 0` |
| `AuditTargetMultiActor` | warning | 30m | `loverush_audit_targets_multi_actor_24h > 5` |
| `WithdrawApproveSpike` | warning | 1h | `sum(...{action="withdraw.approve"}) > 30` |
| `RiskBacklogCritical` | **critical** | 5m | `loverush_risk_unresolved > 30` |
| `TicketsBacklogHigh` | warning | 10m | `loverush_tickets_open > 50` |
| `MetricsEndpointDown` | **critical** | 5m | `up{job="loverush-api"} == 0` |

### 15.3 响应剧本

#### A. `AuditInsertFailureSpike` 触发

审计写库失败 = 留痕缺失 = 责任不可追溯，立即排查：

```sql
-- 1. DB 是否正常 INSERT？
INSERT INTO admin_audit_log(actor_role, action, target_type)
VALUES ('system', 'probe.test', 'system');
-- 应当成功

-- 2. 检查触发器/权限有没有被误改
\dft+ admin_audit_log_block_modify
\dp admin_audit_log

-- 3. 看应用日志（结构化）
journalctl -u loverush-api -o cat | jq -c 'select(.msg=="audit insert failed")' | tail -50
```

如确认 DB 健康 → 检查应用进程是否丢连接。

#### B. `AuditHighFrequencyAdmin` 触发

立刻定位异常 admin：

```sql
SELECT actor_user_id, COUNT(*), array_agg(DISTINCT action) AS actions, MIN(created_at), MAX(created_at)
FROM admin_audit_log
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND actor_user_id IS NOT NULL
GROUP BY actor_user_id
HAVING COUNT(*) >= 30
ORDER BY COUNT(*) DESC;
```

如确认账号被盗 / 离职员工未撤权：

```bash
# 1. 强制 revoke 所有 admin 角色
curl -X DELETE -H "Authorization: Bearer $SUPER_TOKEN" \
  "$API/admin/roles" \
  -d '{"user_id":"<actor>","role":"admin","reason":"freq anomaly auto-revoke"}'

# 2. 强制 logout 所有 session
psql $DATABASE_URL -c "UPDATE sessions SET revoked_at=NOW() WHERE user_id='<actor>' AND revoked_at IS NULL;"

# 3. 留 audit
psql $DATABASE_URL -c "
  INSERT INTO admin_audit_log(actor_role, action, target_type, target_id, reason)
  VALUES ('system', 'incident.auto_revoke', 'user', '<actor>', 'AuditHighFrequencyAdmin alert');"
```

---

## 文档导航

- 部署：`DEPLOY.md`
- 上线策略：`LAUNCH.md`
- 架构 + 关键决策：`ARCHITECTURE.md`
- API 端点清单：`API.md`
- 安全报告：`SECURITY.md`
- 故障 → 应急回滚：`LAUNCH.md §4`
