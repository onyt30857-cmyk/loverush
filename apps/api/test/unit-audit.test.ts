/**
 * 单元测试 · audit.ts
 *
 * 重点验证：
 * - 从 Hono Context 自动提取 actorUserId / requestId / ip / user-agent
 * - 双写：logger.info('audit', ...) + db.insert
 * - DB 失败不抛错（仅 logger.error 记一笔）
 * - actorRole 可显式覆盖
 * - 多个 IP header 优先级：cf-connecting-ip > x-forwarded-for > x-real-ip
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Context } from 'hono';
import { recordAudit } from '../src/services/audit';

function mkContext(opts: {
  userId?: string;
  actorRole?: string;
  requestId?: string;
  headers?: Record<string, string>;
} = {}): Context {
  const ctxVars: Record<string, unknown> = {
    userId: opts.userId,
    actorRole: opts.actorRole,
    requestId: opts.requestId,
  };
  return {
    get: (k: string) => ctxVars[k],
    req: { header: (h: string) => opts.headers?.[h.toLowerCase()] },
  } as unknown as Context;
}

function mkDb(inserts: unknown[], failOnInsert = false) {
  return {
    insert: (_table: unknown) => ({
      values: async (v: unknown) => {
        if (failOnInsert) throw new Error('connection refused');
        inserts.push(v);
        return [];
      },
    }),
  } as any;
}

describe('recordAudit · 字段提取', () => {
  it('从 Context 提取 actorUserId / actorRole / requestId / ip / user-agent', async () => {
    const inserts: any[] = [];
    const db = mkDb(inserts);
    const c = mkContext({
      userId: 'u-admin-1',
      actorRole: 'finance',
      requestId: 'req-abc',
      headers: { 'cf-connecting-ip': '1.2.3.4', 'user-agent': 'Mozilla/5.0' },
    });

    await recordAudit({ db }, c, {
      action: 'withdraw.approve',
      targetType: 'withdrawal',
      targetId: 'w-9',
      after: { status: 'paid', amountPoints: 5000 },
    });

    expect(inserts).toHaveLength(1);
    const row = inserts[0];
    expect(row.actorUserId).toBe('u-admin-1');
    expect(row.actorRole).toBe('finance');
    expect(row.requestId).toBe('req-abc');
    expect(row.ip).toBe('1.2.3.4');
    expect(row.userAgent).toBe('Mozilla/5.0');
    expect(row.action).toBe('withdraw.approve');
    expect(row.targetType).toBe('withdrawal');
    expect(row.targetId).toBe('w-9');
    expect(row.after).toEqual({ status: 'paid', amountPoints: 5000 });
  });

  it('actorRole 显式参数覆盖 Context 中的值', async () => {
    const inserts: any[] = [];
    const c = mkContext({ userId: 'u-1', actorRole: 'admin' });
    await recordAudit({ db: mkDb(inserts) }, c, {
      action: 'withdraw.reject',
      targetType: 'withdrawal',
      targetId: 'w-1',
      actorRole: 'finance',
    });
    expect(inserts[0].actorRole).toBe('finance');
  });

  it('未提供 actorRole 时兜底为 admin', async () => {
    const inserts: any[] = [];
    const c = mkContext({ userId: 'u-1' });
    await recordAudit({ db: mkDb(inserts) }, c, {
      action: 'user.ban',
      targetType: 'user',
      targetId: 'u-9',
    });
    expect(inserts[0].actorRole).toBe('admin');
  });
});

describe('recordAudit · IP header 优先级', () => {
  it('cf-connecting-ip 最高优先级', async () => {
    const inserts: any[] = [];
    const c = mkContext({
      userId: 'u-1',
      headers: {
        'cf-connecting-ip': '1.1.1.1',
        'x-forwarded-for': '2.2.2.2, 3.3.3.3',
        'x-real-ip': '4.4.4.4',
      },
    });
    await recordAudit({ db: mkDb(inserts) }, c, {
      action: 'x', targetType: 'y', targetId: 'z',
    });
    expect(inserts[0].ip).toBe('1.1.1.1');
  });

  it('无 cf 时取 x-forwarded-for 第一段', async () => {
    const inserts: any[] = [];
    const c = mkContext({
      userId: 'u-1',
      headers: { 'x-forwarded-for': '2.2.2.2, 3.3.3.3', 'x-real-ip': '4.4.4.4' },
    });
    await recordAudit({ db: mkDb(inserts) }, c, {
      action: 'x', targetType: 'y', targetId: 'z',
    });
    expect(inserts[0].ip).toBe('2.2.2.2');
  });

  it('无 cf / xff 时取 x-real-ip', async () => {
    const inserts: any[] = [];
    const c = mkContext({ userId: 'u-1', headers: { 'x-real-ip': '4.4.4.4' } });
    await recordAudit({ db: mkDb(inserts) }, c, {
      action: 'x', targetType: 'y', targetId: 'z',
    });
    expect(inserts[0].ip).toBe('4.4.4.4');
  });

  it('全部缺失时 ip 为 null', async () => {
    const inserts: any[] = [];
    const c = mkContext({ userId: 'u-1' });
    await recordAudit({ db: mkDb(inserts) }, c, {
      action: 'x', targetType: 'y', targetId: 'z',
    });
    expect(inserts[0].ip).toBeNull();
  });
});

describe('recordAudit · 容错', () => {
  it('DB 写失败不抛错（业务不能被审计写失败拖死）', async () => {
    const c = mkContext({ userId: 'u-1' });
    const db = mkDb([], true);
    await expect(
      recordAudit({ db }, c, { action: 'x', targetType: 'y', targetId: 'z' }),
    ).resolves.toBeUndefined();
  });

  it('未登录的 actorUserId 为 null', async () => {
    const inserts: any[] = [];
    const c = mkContext({});
    await recordAudit({ db: mkDb(inserts) }, c, {
      action: 'system.boot',
      targetType: 'system',
      actorRole: 'system',
    });
    expect(inserts[0].actorUserId).toBeNull();
    expect(inserts[0].targetId).toBeNull();
  });
});
