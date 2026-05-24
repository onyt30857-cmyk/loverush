#!/usr/bin/env tsx
/**
 * 数据库迁移回滚 CLI · Phase 10.3
 *
 * Drizzle 不原生支持 down migration，我们约定：每个 `migrations/<N>_xxx.sql`
 * 必须配对一个 `migrations/<N>_xxx.down.sql`，本脚本负责按需逆序执行。
 *
 * 用法：
 *   # 回滚最近 1 个迁移
 *   pnpm --filter @loverush/db rollback
 *
 *   # 回滚最近 N 个
 *   pnpm --filter @loverush/db rollback -- --steps 3
 *
 *   # 列出可回滚的迁移（不执行）
 *   pnpm --filter @loverush/db rollback -- --list
 *
 *   # 完全清空（生产慎用 · 需要 --confirm-wipe）
 *   pnpm --filter @loverush/db rollback -- --all --confirm-wipe
 *
 * 工作原理：
 *   1. 读 __drizzle_migrations 表，按 created_at DESC 取最近 N 个
 *   2. 对每个找到 migrations/<hash 对应文件>.down.sql
 *   3. 在事务里 execute down sql + DELETE FROM __drizzle_migrations
 *   4. 任一失败 → 整批回滚
 *
 * down.sql 编写约定：
 *   - 与 up.sql 严格逆序
 *   - DROP TABLE 前需 CASCADE 避免外键阻塞
 *   - 列删除前先 DROP CONSTRAINT
 *   - 注释说明数据丢失风险（如 DROP COLUMN）
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

interface MigrationRow {
  id: number;
  hash: string;
  created_at: string;
}

async function main() {
  const args = process.argv.slice(2);
  const steps = parseInt(args[args.indexOf('--steps') + 1] ?? '1', 10) || 1;
  const list = args.includes('--list');
  const all = args.includes('--all');
  const confirmWipe = args.includes('--confirm-wipe');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  if (all && !confirmWipe) {
    console.error('--all requires --confirm-wipe to prevent accidents in production');
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    // 读已应用的迁移（drizzle 默认 schema = drizzle）
    const applied = await sql<MigrationRow[]>`
      SELECT id, hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC
    `.catch(async () => {
      // 兼容 schema=public 的情况
      return sql<MigrationRow[]>`
        SELECT id, hash, created_at
        FROM __drizzle_migrations
        ORDER BY created_at DESC
      `;
    });

    if (applied.length === 0) {
      console.log('No applied migrations.');
      return;
    }

    const targets = all ? applied : applied.slice(0, steps);

    if (list) {
      console.log(`Latest ${targets.length} migrations (rollback in this order):`);
      for (const m of targets) console.log(`  - ${m.hash}  ${m.created_at}`);
      return;
    }

    console.log(`Will rollback ${targets.length} migration(s):`);
    for (const m of targets) {
      const down = findDownSqlFor(m.hash);
      if (!down) {
        console.error(`✗ no down.sql found for hash ${m.hash}`);
        process.exit(1);
      }
      console.log(`  ${down.relPath}  →  ${m.hash}`);
    }

    // 真执行
    await sql.begin(async (tx) => {
      for (const m of targets) {
        const down = findDownSqlFor(m.hash)!;
        const stmt = readFileSync(down.absPath, 'utf-8');
        await tx.unsafe(stmt);
        try {
          await tx`DELETE FROM drizzle.__drizzle_migrations WHERE hash = ${m.hash}`;
        } catch {
          await tx`DELETE FROM __drizzle_migrations WHERE hash = ${m.hash}`;
        }
        console.log(`✓ rolled back: ${m.hash}`);
      }
    });

    console.log(`Done. ${targets.length} migration(s) rolled back.`);
  } finally {
    await sql.end();
  }
}

/**
 * Drizzle hash 通常是 `journal.json` 里的 idx + tag，我们简化匹配规则：
 * - 找 migrations/<tag>.down.sql，其中 tag = hash 的 idx_后缀部分
 * - 若找不到，按"最新 .down.sql"匹配
 */
function findDownSqlFor(hash: string): { absPath: string; relPath: string } | null {
  if (!existsSync(MIGRATIONS_DIR)) return null;
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.down.sql'));
  if (files.length === 0) return null;
  // 优先按 hash 匹配
  const hashKey = hash.replace(/^.*?_/, '');
  const exact = files.find((f) => f.includes(hashKey));
  const file = exact ?? files.sort().reverse()[0];
  if (!file) return null;
  return { absPath: join(MIGRATIONS_DIR, file), relPath: `migrations/${file}` };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
