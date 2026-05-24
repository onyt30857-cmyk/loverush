# Migrations · 编写约定

## 1. 生成

```bash
pnpm --filter @loverush/db generate
```

drizzle-kit 输出文件命名：`0000_<random_tag>.sql`，并更新 `meta/_journal.json`。

## 2. 手写 down 配对

**每个迁移必须配对一个 down 文件**，否则上线后无法回滚。

约定：

| up 文件 | down 文件 |
|---------|----------|
| `0001_curious_silver_surfer.sql` | `0001_curious_silver_surfer.down.sql` |
| `0002_loud_grim_reaper.sql`      | `0002_loud_grim_reaper.down.sql`      |

### down.sql 必备结构

```sql
-- Rollback for 0001_curious_silver_surfer.sql
-- ⚠️ Data loss risk: this drops table `xxx` — make sure to backup first

BEGIN;

-- 按 up 的相反顺序删除（先索引 → 约束 → 列 → 表 → enum）
DROP INDEX IF EXISTS "idx_users_user_type";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_unique";
DROP TABLE IF EXISTS "sessions" CASCADE;
DROP TYPE IF EXISTS "user_type";

COMMIT;
```

### 危险操作规则

- **DROP TABLE** 必须加 `CASCADE`（避免外键阻塞）
- **DROP COLUMN** 前在注释里标 `⚠️ Data loss`
- **不可逆改动**（如 enum 删值、改主键）→ down.sql 写 `-- IRREVERSIBLE，需 backup 还原`，并打开 P0 告警

## 3. 应用 / 回滚

```bash
# 推 schema（开发期）
pnpm --filter @loverush/db push

# 生成 + 应用（生产期）
pnpm --filter @loverush/db generate
pnpm --filter @loverush/db migrate

# 回滚最近 1 个（默认）
pnpm --filter @loverush/db rollback

# 回滚最近 3 个
pnpm --filter @loverush/db rollback -- --steps 3

# 仅列出，不执行
pnpm --filter @loverush/db rollback -- --list

# 全部清空（仅限测试库）
pnpm --filter @loverush/db rollback -- --all --confirm-wipe
```

## 4. CI 自动检查

CI 应阻断 PR 如果 `*.sql` 没有配对的 `*.down.sql`：

```yaml
# .github/workflows/ci.yml 可加：
- name: Check rollback pairing
  run: |
    cd packages/db/migrations
    for f in *.sql; do
      [[ "$f" == *.down.sql ]] && continue
      base="${f%.sql}"
      if [[ ! -f "${base}.down.sql" ]]; then
        echo "✗ missing down.sql for $f"
        exit 1
      fi
    done
```

## 5. 生产回滚 SOP

详见根目录 `LAUNCH.md` §4 回滚预案：

1. **P0 全站故障** → DB schema 变更回滚的前提是有 down.sql
2. 回滚前先 `pg_dump $DATABASE_URL > backups/$(date +%Y%m%d-%H%M)-pre-rollback.sql`
3. `pnpm --filter @loverush/db rollback -- --steps N`
4. 若 down.sql 缺失或不可逆 → 用 backup 还原（数据丢失窗口 ≤ 6h，对齐 LAUNCH.md）
