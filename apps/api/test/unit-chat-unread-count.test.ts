/**
 * 单元测试 · getUnreadCount 纯逻辑(M05 Phase 1)
 *
 * 测算未读规则:
 *  - sentAt > lastReadAt → 计入
 *  - 自己发的 → 不计
 *  - 对方发的 + sentAt < lastReadAt → 不计
 *  - lastReadAt 不存在(从未读)→ 全部对方消息计入
 */

import { describe, it, expect } from 'vitest';

interface MsgFixture {
  conversationId: string;
  senderUserId: string;
  sentAt: Date;
}

/** 纯函数版 · 模拟 SQL where(sentAt > lastReadAt + sender != self) */
function unreadCount(args: {
  messages: MsgFixture[];
  conversationId: string;
  userId: string;
  lastReadAt: Date | null;
}): number {
  const cutoff = args.lastReadAt ?? new Date(0);
  return args.messages.filter(
    (m) =>
      m.conversationId === args.conversationId &&
      m.senderUserId !== args.userId &&
      m.sentAt > cutoff,
  ).length;
}

const conv = 'conv-1';
const me = 'me';
const peer = 'peer';

function m(sender: string, sentAt: Date): MsgFixture {
  return { conversationId: conv, senderUserId: sender, sentAt };
}

describe('Unit · getUnreadCount 逻辑', () => {
  it('无 lastReadAt · 对方 3 条 + 自己 2 条 → 未读 3', () => {
    const n = unreadCount({
      messages: [
        m(peer, new Date('2026-05-30T10:00:00Z')),
        m(peer, new Date('2026-05-30T10:01:00Z')),
        m(me, new Date('2026-05-30T10:02:00Z')),
        m(peer, new Date('2026-05-30T10:03:00Z')),
        m(me, new Date('2026-05-30T10:04:00Z')),
      ],
      conversationId: conv,
      userId: me,
      lastReadAt: null,
    });
    expect(n).toBe(3);
  });

  it('lastReadAt 在中间 · 仅之后对方消息计入', () => {
    const cutoff = new Date('2026-05-30T10:02:30Z');
    const n = unreadCount({
      messages: [
        m(peer, new Date('2026-05-30T10:00:00Z')), // 之前 · 不计
        m(peer, new Date('2026-05-30T10:01:00Z')), // 之前 · 不计
        m(peer, new Date('2026-05-30T10:03:00Z')), // 之后 · 计
        m(peer, new Date('2026-05-30T10:04:00Z')), // 之后 · 计
      ],
      conversationId: conv,
      userId: me,
      lastReadAt: cutoff,
    });
    expect(n).toBe(2);
  });

  it('全是自己发的 · 未读=0', () => {
    const n = unreadCount({
      messages: [
        m(me, new Date('2026-05-30T10:00:00Z')),
        m(me, new Date('2026-05-30T10:01:00Z')),
      ],
      conversationId: conv,
      userId: me,
      lastReadAt: null,
    });
    expect(n).toBe(0);
  });

  it('lastReadAt 在最新一条之后 · 未读=0', () => {
    const cutoff = new Date('2026-05-30T11:00:00Z');
    const n = unreadCount({
      messages: [
        m(peer, new Date('2026-05-30T10:00:00Z')),
        m(peer, new Date('2026-05-30T10:30:00Z')),
      ],
      conversationId: conv,
      userId: me,
      lastReadAt: cutoff,
    });
    expect(n).toBe(0);
  });

  it('跨会话消息不计入(conversationId 过滤)', () => {
    const n = unreadCount({
      messages: [
        { conversationId: conv, senderUserId: peer, sentAt: new Date() },
        { conversationId: 'other-conv', senderUserId: peer, sentAt: new Date() },
      ],
      conversationId: conv,
      userId: me,
      lastReadAt: null,
    });
    expect(n).toBe(1);
  });
});
