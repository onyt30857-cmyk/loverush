/**
 * M16 P1 · 积分回收 路由
 *
 * 持有人 /redeem/*         requireAuth（客户/技师卖回积分）
 * 代理   /agent/redeem/*   requireRole(['agent'])
 * admin  /admin/redeem/*   requireRole(['admin'])
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { PointRedeemOrder } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import {
  type RedeemContext,
  getRedeemableAgent,
  initiateRedeem,
  listHolderRedeems,
  holderConfirmRedeem,
  cancelRedeem,
  openRedeemDispute,
  listAgentRedeems,
  agentAcceptRedeem,
  agentMarkPaid,
  listAdminRedeems,
  adminResolveRedeem,
} from '../services/redeem';

function ctx(): RedeemContext {
  return { db: getDb() };
}

// ════════════ 持有人端 ════════════
export const redeemRoutes = new Hono();
redeemRoutes.use('*', requireAuth);

// 可回收代理信息（绑定/国家匹配 + 回收率 + 余额）
redeemRoutes.get('/agent', async (c) => {
  const info = await getRedeemableAgent(ctx(), c.get('userId'));
  return c.json({ data: info });
});

const InitiateBody = z.object({
  points: z.number().int().min(1).max(100_000_000),
  payout_method_type: z.enum(['bank', 'usdt_trc20', 'promptpay', 'alipay', 'wechat', 'other']),
  payout_method_fields: z.record(z.string()),
});
redeemRoutes.post('/', zValidator('json', InitiateBody), async (c) => {
  const b = c.req.valid('json');
  const order = await initiateRedeem(ctx(), {
    holderUserId: c.get('userId'),
    points: b.points,
    payoutMethodType: b.payout_method_type,
    payoutMethodFields: b.payout_method_fields,
  });
  return c.json({ data: order });
});

redeemRoutes.get('/', async (c) => {
  const list = await listHolderRedeems(ctx(), c.get('userId'));
  return c.json({ data: list });
});

redeemRoutes.post('/:id/confirm', async (c) => {
  await holderConfirmRedeem(ctx(), { holderUserId: c.get('userId'), redeemId: c.req.param('id') });
  return c.json({ data: { ok: true } });
});

redeemRoutes.post('/:id/cancel', async (c) => {
  await cancelRedeem(ctx(), { actorUserId: c.get('userId'), redeemId: c.req.param('id') });
  return c.json({ data: { ok: true } });
});

redeemRoutes.post('/:id/dispute', async (c) => {
  await openRedeemDispute(ctx(), { userId: c.get('userId'), redeemId: c.req.param('id') });
  return c.json({ data: { ok: true } });
});

// ════════════ 代理端 ════════════
export const agentRedeemRoutes = new Hono();
agentRedeemRoutes.use('*', requireAuth, requireRole(['agent']));

agentRedeemRoutes.get('/', async (c) => {
  const list = await listAgentRedeems(ctx(), c.get('userId'));
  return c.json({ data: list });
});

agentRedeemRoutes.post('/:id/accept', async (c) => {
  await agentAcceptRedeem(ctx(), { agentUserId: c.get('userId'), redeemId: c.req.param('id') });
  return c.json({ data: { ok: true } });
});

const PaidBody = z.object({ proof_url: z.string().url().optional() });
agentRedeemRoutes.post('/:id/paid', zValidator('json', PaidBody), async (c) => {
  const b = c.req.valid('json');
  await agentMarkPaid(ctx(), {
    agentUserId: c.get('userId'),
    redeemId: c.req.param('id'),
    proofUrl: b.proof_url,
  });
  return c.json({ data: { ok: true } });
});

// ════════════ admin ════════════
export const adminRedeemRoutes = new Hono();
adminRedeemRoutes.use('*', requireAuth, requireRole(['admin']));

adminRedeemRoutes.get('/', async (c) => {
  const status = c.req.query('status') as PointRedeemOrder['status'] | undefined;
  const list = await listAdminRedeems(ctx(), { status });
  return c.json({ data: list });
});

const ResolveBody = z.object({ resolution: z.enum(['release_to_agent', 'refund_holder']) });
adminRedeemRoutes.post('/:id/resolve', zValidator('json', ResolveBody), async (c) => {
  const b = c.req.valid('json');
  await adminResolveRedeem(ctx(), { redeemId: c.req.param('id'), resolution: b.resolution });
  return c.json({ data: { ok: true } });
});
