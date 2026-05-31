/**
 * SSE 客户端 hook · M05 Phase 2
 *
 * 全局单条 EventSource(每个 user 一条 · 不分 conversation)
 * 多组件订阅 · 一个 source · 内部 fan-out 给所有 handler
 *
 * 浏览器自动重连(exponential backoff)· 应用层不写
 * token 过期时 source 会持续 error · 由刷 token 触发 useAuth.refresh 后重连
 */
'use client';

import { useEffect, useRef } from 'react';
import { getAccessToken } from './api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

export type ServerEventName = 'chat_message' | 'unread_change' | 'notification_new' | 'typing' | 'hello' | 'ping';
export type ServerEventHandler = (event: ServerEventName, data: unknown) => void;

let globalSource: EventSource | null = null;
let connectedToken: string | null = null;
const handlers = new Set<ServerEventHandler>();

const ALL_EVENTS: ServerEventName[] = ['chat_message', 'unread_change', 'notification_new', 'typing', 'hello', 'ping'];

function ensureConnected() {
  const token = getAccessToken();
  if (!token) return;

  // 已连接同一 token · 不重建
  if (globalSource && connectedToken === token && globalSource.readyState !== EventSource.CLOSED) {
    return;
  }

  // token 换了或没连过 · 重建
  if (globalSource) {
    globalSource.close();
    globalSource = null;
  }

  globalSource = new EventSource(`${API_BASE}/events/stream?token=${encodeURIComponent(token)}`);
  connectedToken = token;

  for (const evt of ALL_EVENTS) {
    globalSource.addEventListener(evt, (e) => {
      let data: unknown = null;
      try {
        data = JSON.parse((e as MessageEvent).data);
      } catch {
        data = (e as MessageEvent).data;
      }
      for (const h of handlers) {
        try {
          h(evt, data);
        } catch {
          // handler 错不影响其他
        }
      }
    });
  }
}

/** 订阅所有 server 事件 · 返 unsubscribe */
export function useServerEvents(handler: ServerEventHandler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrapper: ServerEventHandler = (e, d) => handlerRef.current(e, d);
    handlers.add(wrapper);
    ensureConnected();
    return () => {
      handlers.delete(wrapper);
      // 无人订阅 · 关 source 省资源
      if (handlers.size === 0 && globalSource) {
        globalSource.close();
        globalSource = null;
        connectedToken = null;
      }
    };
  }, []);
}
