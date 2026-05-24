import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 多个 describe 块在不同状态下跑，必须串行
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // vitest 2.x forks pool 默认不继承父进程 env，显式注入避免 loadEnv 失败
    env: { ...process.env } as Record<string, string>,
  },
});
