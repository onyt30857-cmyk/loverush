/**
 * 零依赖结构化日志（pino 兼容 NDJSON 行）
 *
 * 每行一个 JSON：`{level, time, msg, ...fields}`，能被 Loki / Datadog /
 * CloudWatch / fluent-bit 直接解析。
 *
 * 用法：
 *   import { logger } from '../services/logger';
 *   logger.info('stripe payment_intent.succeeded', { paymentId, amount });
 *   logger.error('unhandled', { err, requestId, path });
 *
 * 错误对象自动展开：传 { err } 会被序列化成 { err: { name, message, stack } }。
 *
 * 环境变量：
 *   LOG_LEVEL=debug|info|warn|error|silent  默认 info
 *   LOG_PRETTY=1  开发期人类可读（仍是 JSON，但带颜色+缩进，不推荐生产打开）
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level | 'silent', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

function resolveLevel(): number {
  const raw = (typeof process !== 'undefined' ? process.env.LOG_LEVEL : undefined) ?? 'info';
  const key = raw.toLowerCase() as Level | 'silent';
  return LEVELS[key] ?? LEVELS.info;
}

const ENABLED_LEVEL = resolveLevel();
const PRETTY = typeof process !== 'undefined' && process.env.LOG_PRETTY === '1';

function serializeError(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return { value: String(e) };
}

function expandFields(fields?: Record<string, unknown>): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'err' || k === 'error') {
      out[k] = serializeError(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < ENABLED_LEVEL) return;
  const entry: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    msg,
    ...expandFields(fields),
  };
  const line = PRETTY ? JSON.stringify(entry, null, 2) : JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
  /** 派生一个带固定字段的子 logger（例如固定 requestId / module） */
  child(bound: Record<string, unknown>) {
    const merge = (fields?: Record<string, unknown>) => ({ ...bound, ...(fields ?? {}) });
    return {
      debug: (msg: string, f?: Record<string, unknown>) => emit('debug', msg, merge(f)),
      info: (msg: string, f?: Record<string, unknown>) => emit('info', msg, merge(f)),
      warn: (msg: string, f?: Record<string, unknown>) => emit('warn', msg, merge(f)),
      error: (msg: string, f?: Record<string, unknown>) => emit('error', msg, merge(f)),
    };
  },
};

export type Logger = typeof logger;

/**
 * Fire-and-forget 异步任务，失败仅 log，不阻塞调用方。
 *
 * 替代 `void promise.catch(() => {})` silent failure 反模式（Phase 34 扫描发现）。
 *
 * 用法：
 *   fireAndForget(sendWebPushFanout(ctx, row), 'webpush.fanout_failed', { id: row.id });
 */
export function fireAndForget(
  promise: Promise<unknown>,
  label: string,
  context?: Record<string, unknown>,
): void {
  void promise.catch((e: unknown) => {
    logger.error(label, {
      err: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : { value: String(e) },
      ...context,
    });
  });
}
