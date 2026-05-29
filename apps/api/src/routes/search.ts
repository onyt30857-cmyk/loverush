/**
 * 搜索路由 · Phase 2 NLP
 *
 * POST   /search/parse      自然语言解析为结构化条件 + AI 总结
 *                           前端结果页用 parsed.conditions 直接查 /therapists
 *                           失败 / 简单查询 → 退化为关键词 search
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { parseSearchNlp } from '../services/search-nlp';
import { getGateway } from '../services/assistant/index';

const ParseBody = z.object({
  q: z.string().min(1).max(200),
});

export const searchRoutes = new Hono();

searchRoutes.use('*', requireAuth);

searchRoutes.post('/parse', zValidator('json', ParseBody), async (c) => {
  const body = c.req.valid('json');
  const parsed = await parseSearchNlp(getGateway(), body.q);
  return c.json({ data: parsed });
});
