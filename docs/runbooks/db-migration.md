# DB Migration Runbook

> 数据库 schema 变更 SOP · 配合 `LAUNCH.md §1 / §4` 使用
> 适用：所有 `packages/db/migrations/` 下的 schema 变更
> 责任人：发起 PR 的工程师 + 灰度发布值班

---

## 0. 速查表

| 场景 | 命令 | 备注 |
|---|---|---|
| 开发期推 schema | `pnpm --filter @loverush/db push` | 强制 reset 用 `push -- --force` |
| 生成迁移文件 | `pnpm --filter @loverush/db generate` | drizzle-kit 产 `0XXX_<tag>.sql` |
| 生产应用迁移 | `pnpm --filter @loverush/db migrate` | 走顺序应用 + journal |
| 回滚最近 1 个 | `pnpm --filter @loverush/db rollback` | 必须有配对 `.down.sql` |
| 仅列出，不执行 | `pnpm --filter @loverush/db rollback -- --list` | 安全确认用 |
| 全部清空（仅测试库） | `pnpm --filter @loverush/db rollback -- --all --confirm-wipe` | 生产禁用 |

底层文件命名 + 范例见 `packages/db/migrations/README.md`。本文档聚焦**流程**与**生产 SOP**。

---

## 1. 标准变更流程（开发 → 生产）

### 1.1 开发期（本地 docker dev stack）

```bash
# 1) 改 packages/db/src/schema/*.ts
$EDITOR packages/db/src/schema/users.ts

# 2) 推到本地 dev DB（不生成迁移文件，仅快速验证）
pnpm --filter @loverush/db push

# 3) 起 API 跑一遍 E2E，验证 schema 变更没破坏既有路径
pnpm --filter @loverush/api exec vitest run test/e2e.test.ts
```

### 1.2 准备 PR

```bash
# 1) 生成正式迁移文件
pnpm --filter @loverush/db generate

# 2) 检查产物
ls packages/db/migrations/
#   0004_<random_tag>.sql        ← drizzle 自动产
#   0004_<random_tag>.down.sql   ← 你必须手写

# 3) 手写 down 配对（必须！CI 会强阻断）
cp packages/db/migrations/0004_*.sql packages/db/migrations/0004_*.down.sql
$EDITOR packages/db/migrations/0004_*.down.sql
# ↑ 按 up 的逆序：先 DROP INDEX → CONSTRAINT → COLUMN → TABLE → TYPE

# 4) 本地演练 up + down + 重 up（保证可回滚）
pnpm --filter @loverush/db push
pnpm --filter @loverush/db rollback
pnpm --filter @loverush/db push

# 5) 提 PR，CI 会跑：
#    - drizzle 一致性（schema vs 迁移文件）
#    - up/down 配对检查
#    - E2E 测试在最新 schema 上跑通
```

### 1.3 生产应用（D-Day 或常规发版）

```bash
# 1) 备份生产 DB（强制 · 不可省略）
pg_dump "$DATABASE_URL" > backups/$(date +%Y%m%d-%H%M)-pre-migration.sql
ls -lh backups/  # 检查大小合理

# 2) 上传备份到 R2（防本地丢失）
aws s3 cp backups/$(date +%Y%m%d-%H%M)-pre-migration.sql \
  s3://loverush-db-backups/migrations/ \
  --endpoint-url https://$R2_ACCOUNT.r2.cloudflarestorage.com

# 3) 应用迁移
pnpm --filter @loverush/db migrate
# 输出每一条迁移 + journal 更新

# 4) 验证表数（应该 +N，N = 本次新增表数）
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'"

# 5) 烟测：起 API 调一个用了新字段的接口
curl $API/ping
curl -H "Authorization: Bearer $ADMIN_TOKEN" $API/admin/dashboard
```

---

## 2. 配对 `.down.sql` 规则（强制）

每个 `.sql` 必须有同名 `.down.sql`，否则 CI 拒绝合并。

### 2.1 模板

```sql
-- Rollback for 0004_<tag>.sql
-- ⚠️ Data loss risk: 列出会丢哪些数据，迁移前必须 backup

BEGIN;

-- 按 up 的逆序删除
DROP INDEX IF EXISTS "idx_users_user_type";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_unique";
ALTER TABLE "users" DROP COLUMN IF EXISTS "new_field";
DROP TABLE IF EXISTS "sessions" CASCADE;
DROP TYPE IF EXISTS "user_type";

COMMIT;
```

### 2.2 危险操作硬规则

| 操作 | down 文件必须包含 |
|---|---|
| `DROP TABLE` | `CASCADE`（避免外键阻塞）|
| `DROP COLUMN` 含数据 | `-- ⚠️ Data loss: 列名 = ...` 注释 |
| 删 enum 值 | `-- IRREVERSIBLE，需 backup 还原` + 通知 oncall |
| 改主键 | 同上 |
| 改外键级联策略 | 重启 API 后验证 cascade 行为 |

### 2.3 例外：append-only 表

`admin_audit_log`（Phase 25 加的 PostgreSQL 触发器 `admin_audit_log_block_modify()`）拒绝 UPDATE / DELETE / TRUNCATE。

回滚此表的迁移有两条路：

1. **优雅路径**：down.sql 里先 DROP 触发器 → 再 DROP TABLE → 提交后立即在新一次部署 up.sql 重建触发器
2. **紧急路径**：用 super user（postgres）直连 DB 跑 `DROP TABLE admin_audit_log CASCADE;` —— 此操作会留在 PostgreSQL 主日志，事后必须事件归档

参考：`packages/db/migrations/0003_admin_audit_append_only.down.sql`

---

## 3. 生产回滚 SOP（P0 故障应急）

按 `LAUNCH.md §4` 分级。**所有回滚先 backup，否则禁止开始**。

### 3.1 单步回滚

```bash
# 1) 备份当前状态（即使数据已经"脏"也要存）
pg_dump "$DATABASE_URL" > backups/$(date +%Y%m%d-%H%M)-pre-rollback-dirty.sql

# 2) 列出最近迁移
pnpm --filter @loverush/db rollback -- --list

# 3) 回滚最近 1 个
pnpm --filter @loverush/db rollback

# 4) 烟测核心 API
curl $API/ping
curl -H "Authorization: Bearer $ADMIN_TOKEN" $API/admin/dashboard
```

### 3.2 多步回滚

```bash
# 例：回滚最近 3 个迁移
pnpm --filter @loverush/db rollback -- --steps 3
```

⚠️ 风险：down.sql 不保证多步组合后状态等价于"从未应用过这些迁移"。多步回滚后必须跑完整 E2E + 表数 / 关键约束逐项核验。

### 3.3 down.sql 不可用 / 不可逆 → backup 还原

```bash
# 1) 停 API（避免新写入污染还原后状态）
systemctl stop loverush-api  # 或 wrangler delete worker

# 2) DROP & 还原
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DATABASE_URL" < backups/<chosen-backup>.sql

# 3) 验证表数
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'"

# 4) 启 API
systemctl start loverush-api

# 5) 通知用户：数据丢失窗口 = backup 时间 → 现在
```

**数据丢失窗口必须公告**（按 `LAUNCH.md §6` 凭证轮换备份周期 = 6h 内）。

---

## 4. 演练（建议每月跑一次）

在本地 docker dev stack 上：

```bash
# 起 dev stack
docker compose -f infra/docker/docker-compose.dev.yml up -d
sleep 3

# 完整 up + down + 重 up（模拟最坏情况）
pnpm --filter @loverush/db push
TABLE_UP=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
echo "up 后表数: $TABLE_UP"

pnpm --filter @loverush/db rollback -- --all --confirm-wipe
TABLE_DOWN=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
echo "down 后表数: $TABLE_DOWN"   # 应该 = 0

pnpm --filter @loverush/db push
TABLE_REUP=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
echo "重 up 后表数: $TABLE_REUP"   # 应该 = $TABLE_UP

# 清理
docker compose -f infra/docker/docker-compose.dev.yml down -v
```

**通过标准**：三个表数都对齐，无任何 SQL 错误。

---

## 5. 配对表

| 文档 | 职责 |
|---|---|
| 本文档 | **流程 + 生产 SOP** |
| `packages/db/migrations/README.md` | down.sql 编写细则 |
| `LAUNCH.md §1` | DB ready check（上线日跑一次）|
| `LAUNCH.md §4` | 全站故障下的 DB 回滚（P0 应急）|
| `infra/prometheus/rules.yml` | DB 相关告警（连接池 / 慢查询）|

---

**最后更新**：2026-05-22（Phase 30 · 上线 SOP 自动化收尾）
