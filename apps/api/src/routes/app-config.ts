/**
 * C 端只读 · 小程序运营配置
 * GET /app-config  → 返回前端用的 home/nav 配置(不含 bot.*,bot 配置仅服务端读)
 * 公开(无需鉴权),内容为运营文案非敏感;前端读取带硬编码 fallback。
 */
import { Hono } from 'hono';
import { getAppConfigMany } from '../services/app-config';

export const appConfigRoutes = new Hono();

appConfigRoutes.get('/', async (c) => {
  const data = await getAppConfigMany(['home.promise', 'home.brandFooter', 'nav.customer', 'nav.therapist']);
  return c.json({ data });
});
