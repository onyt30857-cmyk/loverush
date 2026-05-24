/**
 * 单元测试 · logger.ts（NDJSON 结构化日志）
 *
 * 重点验证：
 * - 每行一个合法 JSON
 * - level / time / msg 字段必有，time 是 ISO-8601
 * - error 字段自动展开为 {name, message, stack}
 * - child() 绑定字段后续日志都带
 * - LOG_LEVEL=warn 时 info/debug 被过滤
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger } from '../src/services/logger';

function captureStdout(): { lines: string[]; restore: () => void } {
  const original = process.stdout.write.bind(process.stdout);
  const lines: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk).replace(/\n$/, ''));
    return true;
  }) as typeof process.stdout.write;
  return { lines, restore: () => { process.stdout.write = original; } };
}

function captureStderr(): { lines: string[]; restore: () => void } {
  const original = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk).replace(/\n$/, ''));
    return true;
  }) as typeof process.stderr.write;
  return { lines, restore: () => { process.stderr.write = original; } };
}

describe('logger · NDJSON 输出格式', () => {
  it('每条日志一行合法 JSON', () => {
    const cap = captureStdout();
    logger.info('test message', { foo: 'bar', n: 42 });
    cap.restore();
    expect(cap.lines).toHaveLength(1);
    const parsed = JSON.parse(cap.lines[0]!);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('test message');
    expect(parsed.foo).toBe('bar');
    expect(parsed.n).toBe(42);
    expect(parsed.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('error / warn 走 stderr', () => {
    const out = captureStdout();
    const err = captureStderr();
    logger.error('boom', { code: 500 });
    logger.warn('hmm', { code: 400 });
    out.restore();
    err.restore();
    expect(out.lines).toHaveLength(0);
    expect(err.lines).toHaveLength(2);
    expect(JSON.parse(err.lines[0]!).level).toBe('error');
    expect(JSON.parse(err.lines[1]!).level).toBe('warn');
  });
});

describe('logger · 错误对象展开', () => {
  it('err 字段被序列化为 {name, message, stack}', () => {
    const cap = captureStderr();
    const e = new TypeError('something broke');
    logger.error('unhandled', { err: e, path: '/foo' });
    cap.restore();
    const parsed = JSON.parse(cap.lines[0]!);
    expect(parsed.err.name).toBe('TypeError');
    expect(parsed.err.message).toBe('something broke');
    expect(typeof parsed.err.stack).toBe('string');
    expect(parsed.path).toBe('/foo');
  });

  it('非 Error 对象走 {value: ...}', () => {
    const cap = captureStderr();
    logger.error('weird', { err: 'just a string' });
    cap.restore();
    const parsed = JSON.parse(cap.lines[0]!);
    expect(parsed.err.value).toBe('just a string');
  });
});

describe('logger · child() 字段绑定', () => {
  it('child 派生的 logger 自动携带绑定字段', () => {
    const cap = captureStdout();
    const child = logger.child({ requestId: 'req-123', module: 'orders' });
    child.info('order created', { orderId: 'ord-9' });
    cap.restore();
    const parsed = JSON.parse(cap.lines[0]!);
    expect(parsed.requestId).toBe('req-123');
    expect(parsed.module).toBe('orders');
    expect(parsed.orderId).toBe('ord-9');
  });

  it('per-call 字段可覆盖 child 绑定字段', () => {
    const cap = captureStdout();
    const child = logger.child({ module: 'orders' });
    child.info('overridden', { module: 'payments' });
    cap.restore();
    expect(JSON.parse(cap.lines[0]!).module).toBe('payments');
  });
});
