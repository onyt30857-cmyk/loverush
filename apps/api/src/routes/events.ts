/**
 * SSE 实时事件端点 · M05 Phase 2
 *
 * GET /events/stream?token=JWT
 *   text/event-stream · 单向推 chat_message / unread_change / notification_new
 *   心跳 25s(Railway 60s 超时前)
 *   鉴权:JWT query param(EventSource 不支持 header)
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { verifyAccessToken } from '../middleware/auth';
import { registerConnection, activeUserCount, activeConnectionCount } from '../services/sse-hub';

export const eventsRoutes = new Hono();

eventsRoutes.get('/stream', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.text('missing token', 401);

  let userId: string;
  try {
    userId = await verifyAccessToken(token);
  } catch {
    return c.text('invalid token', 401);
  }

  // 关键:streamSSE 必须直接 return · 不要 await
  return streamSSE(c, async (stream) => {
    const writer = {
      id: crypto.randomUUID(),
      userId,
      send: (event: string, data: unknown) => {
        void stream.writeSSE({
          event,
          data: JSON.stringify(data),
        });
      },
    };

    const unregister = registerConnection(userId, writer);
    let closed = false;

    // 立即发 hello
    writer.send('hello', { userId, at: new Date().toISOString() });

    // 心跳 25s · comment 行 EventSource 忽略
    const heartbeat = setInterval(() => {
      if (closed) return;
      void stream.writeSSE({ event: 'ping', data: String(Date.now()) }).catch(() => {});
    }, 25_000);

    stream.onAbort(() => {
      closed = true;
      clearInterval(heartbeat);
      unregister();
    });

    // 阻塞 keep-alive · streamSSE handler 返回即关闭流
    await new Promise<void>((resolve) => {
      const tick = setInterval(() => {
        if (closed) {
          clearInterval(tick);
          resolve();
        }
      }, 1000);
    });
  });
});

// 给 admin 看在线数(简单 · 不挂权限 · 内网/运维用)
eventsRoutes.get('/stats', (c) => {
  return c.json({
    data: {
      activeUsers: activeUserCount(),
      activeConnections: activeConnectionCount(),
    },
  });
});
