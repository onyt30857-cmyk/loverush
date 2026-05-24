/**
 * 邀请码路由 · M10
 *
 * POST   /invites/codes             用户自助生成（U / T / R）
 * GET    /invites/codes              我的有效码
 * GET    /invites/invitees           我邀请的人
 * GET    /invites/r-code             我的 R 码状态（仅技师）
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import {
  generateCode,
  getMyRCodeStatus,
  listMyInviteCodes,
  listMyInvitees,
  type InviteContext,
} from '../services/invites';

function ictx(): InviteContext {
  return { db: getDb() };
}

const GenerateBody = z.object({
  kind: z.enum(['T', 'U', 'R']),
  max_uses: z.number().int().min(1).max(1000).optional(),
  expires_in_days: z.number().int().min(1).max(365).optional(),
  note: z.string().max(200).optional(),
});

export const inviteRoutes = new Hono();
inviteRoutes.use('*', requireAuth);

inviteRoutes.post('/codes', zValidator('json', GenerateBody), async (c) => {
  const body = c.req.valid('json');
  const result = await generateCode(ictx(), {
    issuerUserId: c.get('userId') as string,
    kind: body.kind,
    maxUses: body.max_uses,
    expiresInDays: body.expires_in_days,
    note: body.note,
  });
  return c.json({ data: result });
});

inviteRoutes.get('/codes', async (c) => {
  const list = await listMyInviteCodes(ictx(), c.get('userId') as string);
  return c.json({ data: list });
});

inviteRoutes.get('/invitees', async (c) => {
  const list = await listMyInvitees(ictx(), c.get('userId') as string);
  return c.json({ data: list });
});

inviteRoutes.get('/r-code', async (c) => {
  const row = await getMyRCodeStatus(ictx(), c.get('userId') as string);
  return c.json({ data: row });
});
