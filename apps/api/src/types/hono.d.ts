/**
 * Hono Context 自定义变量声明
 *
 * 让 c.set('userId', '...') / c.get('userId') 类型安全。
 * 不在此声明的 key 会被 Hono v4 严格检查拒绝。
 */

import 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    sessionId: string;
    requestId: string;
    locale: string;
    actorRole: string;
  }
}
