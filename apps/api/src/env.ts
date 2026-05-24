/**
 * 环境变量解析与校验
 *
 * 通过 zod 校验启动时必备配置，缺失早失败而不是运行时 NPE。
 * Cloudflare Workers 时由 wrangler 注入；Bun 时由 .env 注入。
 *
 * Duration 字段（JWT_ACCESS_TTL / JWT_REFRESH_TTL）支持：
 *   "30d" "12h" "60m" "300s" 或纯秒数 "2592000"
 */

import { z } from 'zod';

const Duration = z
  .string()
  .transform((v, ctx) => {
    const m = v.match(/^(\d+)([dhms]?)$/);
    if (!m) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid duration: ${v}` });
      return z.NEVER;
    }
    const n = parseInt(m[1]!, 10);
    const unit = m[2] || 's';
    const mul = unit === 'd' ? 86400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
    return n * mul;
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),

  // 数据库
  DATABASE_URL: z.string().url(),

  // Redis（幂等 / 限流）
  REDIS_URL: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_ISSUER: z.string().default('loverush'),
  JWT_ACCESS_TTL: Duration.default('1h'),
  JWT_REFRESH_TTL: Duration.default('30d'),

  // LLM
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_GEMINI_API_KEY: z.string().optional(),

  // Web Push (VAPID · 用 npx web-push generate-vapid-keys 生成)
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:noreply@loverush.com'),

  // Stripe（缺则充值走 stub）
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // Sentry（缺则错误监控降级 noop）
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  SENTRY_RELEASE: z.string().optional(),

  // R2（缺则媒体走 stub）
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().default('loverush-media'),
  R2_PUBLIC_URL: z.string().optional(),

  // 部署
  CORS_ORIGIN: z.string().default('*'),
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'JWT_ACCESS_TTL' | 'JWT_REFRESH_TTL'> & {
  JWT_ACCESS_TTL_SECONDS: number;
  JWT_REFRESH_TTL_SECONDS: number;
};

let cached: Env | null = null;

export function loadEnv(source: Record<string, unknown> = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    console.error('[env] validation failed:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }
  const { JWT_ACCESS_TTL, JWT_REFRESH_TTL, ...rest } = parsed.data;
  cached = {
    ...rest,
    JWT_ACCESS_TTL_SECONDS: JWT_ACCESS_TTL,
    JWT_REFRESH_TTL_SECONDS: JWT_REFRESH_TTL,
  };
  return cached;
}
