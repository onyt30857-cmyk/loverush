/**
 * 单元测试 · sse-hub 内存连接管理(M05 Phase 2)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerConnection,
  publishToUser,
  activeUserCount,
  activeConnectionCount,
} from '../src/services/sse-hub';

function mockWriter(uid: string, log: Array<{ event: string; data: unknown }>) {
  return {
    id: 'w-' + Math.random().toString(36).slice(2, 8),
    userId: uid,
    send: (event: string, data: unknown) => {
      log.push({ event, data });
    },
  };
}

// 由于 connections 是 module 单例 · 每个 test 后 unregister 清理
describe('Unit · sse-hub', () => {
  it('register → publish 命中', () => {
    const log: Array<{ event: string; data: unknown }> = [];
    const w = mockWriter('u1', log);
    const off = registerConnection('u1', w);
    publishToUser('u1', 'chat_message', { x: 1 });
    expect(log).toEqual([{ event: 'chat_message', data: { x: 1 } }]);
    off();
  });

  it('unregister 后 publish 不送达', () => {
    const log: Array<{ event: string; data: unknown }> = [];
    const w = mockWriter('u2', log);
    const off = registerConnection('u2', w);
    off();
    publishToUser('u2', 'x', {});
    expect(log).toEqual([]);
  });

  it('多个 writer 同 userId · publish 全部送达', () => {
    const log1: Array<{ event: string; data: unknown }> = [];
    const log2: Array<{ event: string; data: unknown }> = [];
    const off1 = registerConnection('u3', mockWriter('u3', log1));
    const off2 = registerConnection('u3', mockWriter('u3', log2));
    publishToUser('u3', 'evt', { v: 'hi' });
    expect(log1.length).toBe(1);
    expect(log2.length).toBe(1);
    off1();
    off2();
  });

  it('不同 userId 隔离', () => {
    const logA: Array<{ event: string; data: unknown }> = [];
    const logB: Array<{ event: string; data: unknown }> = [];
    const offA = registerConnection('userA', mockWriter('userA', logA));
    const offB = registerConnection('userB', mockWriter('userB', logB));
    publishToUser('userA', 'evt', { for: 'A' });
    expect(logA.length).toBe(1);
    expect(logB.length).toBe(0);
    offA();
    offB();
  });

  it('异常 writer 不影响其他 writer', () => {
    const log: Array<{ event: string; data: unknown }> = [];
    const badWriter = {
      id: 'bad',
      userId: 'u5',
      send: () => {
        throw new Error('writer dead');
      },
    };
    const goodWriter = mockWriter('u5', log);
    const off1 = registerConnection('u5', badWriter);
    const off2 = registerConnection('u5', goodWriter);
    expect(() => publishToUser('u5', 'evt', { x: 1 })).not.toThrow();
    expect(log.length).toBe(1); // 好 writer 仍收到
    off1();
    off2();
  });

  it('activeUserCount / activeConnectionCount', () => {
    const offs: Array<() => void> = [];
    offs.push(registerConnection('a', mockWriter('a', [])));
    offs.push(registerConnection('a', mockWriter('a', [])));
    offs.push(registerConnection('b', mockWriter('b', [])));
    expect(activeUserCount()).toBeGreaterThanOrEqual(2);
    expect(activeConnectionCount()).toBeGreaterThanOrEqual(3);
    offs.forEach((f) => f());
  });

  it('无 connection 时 publish 不抛', () => {
    expect(() => publishToUser('no-such-user', 'x', {})).not.toThrow();
  });
});
