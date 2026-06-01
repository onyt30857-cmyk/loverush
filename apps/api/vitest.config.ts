import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 启动 vitest 时自动 load apps/api/.env(避免 pnpm test 时 shell 没 source 导致 loadEnv 失败)
function loadDotEnv(): Record<string, string> {
  const envPath = resolve(__dirname, '.env');
  if (!existsSync(envPath)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

export default defineConfig({
  test: {
    // 多个 describe 块在不同状态下跑，必须串行
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // vitest 2.x forks pool 默认不继承父进程 env · 双源注入(.env 兜底 + 父进程覆盖)
    env: { ...loadDotEnv(), ...process.env } as Record<string, string>,
  },
});
