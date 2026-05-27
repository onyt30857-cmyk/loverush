/**
 * M16 · 积分代理分销 路由
 *
 * 代理端   /agent/*            requireRole(['agent'])
 * 客户端   /point-purchases/*  requireAuth
 * admin    /admin/agents/*     requireRole(['admin'])
 *
 * 详见 v1/modules/M16-积分代理分销.md
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { pointsAccount } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import {
  type AgentContext,
  getAgentProfile,
  createWholesaleOrder,
  listWholesaleOrders,
  confirmWholesaleOrder,
  listPaymentMethods,
  upsertPaymentMethod,
  deletePaymentMethod,
  getMyAgentForCustomer,
  createPurchaseOrder,
  markPurchasePaid,
  confirmPurchaseAndTransfer,
  listMyPurchaseOrders,
  listAgentPurchaseOrders,
  grantAgent,
  listAgents,
  listAllWholesaleOrders,
} from '../services/agents';

function ctx(): AgentContext {
  return { db: getDb() };
}

async function balanceOf(userId: string): Promise<number> {
  const acc = await getDb().query.pointsAccount.findFirst({ where: eq(pointsAccount.userId, userId) });
  return acc?.balance ?? 0;
}

// ════════════ 代理端 ════════════

export const agentRoutes = new Hono();
agentRoutes.use('*', requireAuth, requireRole(['agent']));

agentRoutes.get('/me', async (c) => {
  const userId = c.get('userId') as string;
  const profile = await getAgentProfile(ctx(), userId);
  return c.json({ data: { profile, balance: await balanceOf(userId) } });
});

agentRoutes.get('/payment-methods', async (c) => {
  const list = await listPaymentMethods(ctx(), c.get('userId') as string);
  return c.json({ data: list });
});

const PaymentMethodBody = z.object({
  id: z.string().uuid().optional(),
  country: z.string().min(2).max(8),
  method_type: z.enum(['bank', 'alipay', 'wechat']),
  fields: z.record(z.string()),
  min_purchase_points: z.number().int().min(0).max(10_000_000).optional(),
  is_active: z.boolean().optional(),
});

agentRoutes.put('/payment-methods', zValidator('json', PaymentMethodBody), async (c) => {
  const b = c.req.valid('json');
  const row = await upsertPaymentMethod(ctx(), {
    id: b.id,
    agentUserId: c.get('userId') as string,
    country: b.country,
    methodType: b.method_type,
    fields: b.fields,
    minPurchasePoints: b.min_purchase_points,
    isActive: b.is_active,
  });
  return c.json({ data: row });
});

agentRoutes.delete('/payment-methods/:id', async (c) => {
  await deletePaymentMethod(ctx(), { agentUserId: c.get('userId') as string, id: c.req.param('id') });
  return c.json({ data: { ok: true } });
});

const WholesaleBody = z.object({ points: z.number().int().min(1).max(100_000_000) });

agentRoutes.post('/wholesale', zValidator('json', WholesaleBody), async (c) => {
  const b = c.req.valid('json');
  const row = await createWholesaleOrder(ctx(), { agentUserId: c.get('userId') as string, points: b.points });
  return c.json({ data: row });
});

agentRoutes.get('/wholesale', async (c) => {
  const list = await listWholesaleOrders(ctx(), c.get('userId') as string);
  return c.json({ data: list });
});

const PurchaseStatus = z
  .enum(['created', 'customer_paid', 'agent_confirmed', 'points_sent', 'disputed', 'cancelled', 'expired'])
  .optional();

agentRoutes.get('/purchase-orders', zValidator('query', z.object({ status: PurchaseStatus })), async (c) => {
  const q = c.req.valid('query');
  const list = await listAgentPurchaseOrders(ctx(), { agentUserId: c.get('userId') as string, status: q.status });
  return c.json({ data: list });
});

agentRoutes.post('/purchase-orders/:id/confirm', async (c) => {
  const row = await confirmPurchaseAndTransfer(ctx(), {
    agentUserId: c.get('userId') as string,
    orderId: c.req.param('id'),
  });
  return c.json({ data: row });
});

// ════════════ 客户端 ════════════

export const pointPurchaseRoutes = new Hono();
pointPurchaseRoutes.use('*', requireAuth);

// 我的（自动分配的）服务商 + 收款方式
pointPurchaseRoutes.get(
  '/agent',
  zValidator('query', z.object({ country: z.string().max(8).optional() })),
  async (c) => {
    const q = c.req.valid('query');
    const data = await getMyAgentForCustomer(ctx(), {
      customerUserId: c.get('userId') as string,
      country: q.country,
    });
    return c.json({ data });
  },
);

const PurchaseBody = z.object({
  points: z.number().int().min(1).max(10_000_000),
  payment_method_id: z.string().uuid(),
  country: z.string().max(8).optional(),
  local_amount: z.string().max(40).optional(),
  local_currency: z.string().max(8).optional(),
});

pointPurchaseRoutes.post('/', zValidator('json', PurchaseBody), async (c) => {
  const b = c.req.valid('json');
  const row = await createPurchaseOrder(ctx(), {
    customerUserId: c.get('userId') as string,
    points: b.points,
    paymentMethodId: b.payment_method_id,
    country: b.country,
    localAmount: b.local_amount,
    localCurrency: b.local_currency,
  });
  return c.json({ data: row });
});

pointPurchaseRoutes.get('/', async (c) => {
  const list = await listMyPurchaseOrders(ctx(), c.get('userId') as string);
  return c.json({ data: list });
});

const PaidBody = z.object({ proof_url: z.string().url().max(500).optional() });

pointPurchaseRoutes.post('/:id/paid', zValidator('json', PaidBody), async (c) => {
  const b = c.req.valid('json');
  const row = await markPurchasePaid(ctx(), {
    customerUserId: c.get('userId') as string,
    orderId: c.req.param('id'),
    proofUrl: b.proof_url,
  });
  return c.json({ data: row });
});

// ════════════ admin ════════════

export const adminAgentRoutes = new Hono();
adminAgentRoutes.use('*', requireAuth, requireRole(['admin']));

adminAgentRoutes.get('/', async (c) => {
  const list = await listAgents(ctx());
  return c.json({ data: list });
});

adminAgentRoutes.get(
  '/wholesale',
  zValidator('query', z.object({ status: z.enum(['pending', 'confirmed', 'rejected']).optional() })),
  async (c) => {
    const q = c.req.valid('query');
    const list = await listAllWholesaleOrders(ctx(), { status: q.status });
    return c.json({ data: list });
  },
);

const GrantBody = z.object({
  service_countries: z.array(z.string().min(2).max(8)).min(1),
  service_cities: z.array(z.string().max(40)).optional(),
});

adminAgentRoutes.post('/:userId/grant', zValidator('json', GrantBody), async (c) => {
  const b = c.req.valid('json');
  const row = await grantAgent(ctx(), {
    userId: c.req.param('userId'),
    serviceCountries: b.service_countries,
    serviceCities: b.service_cities,
    grantedByUserId: c.get('userId') as string,
  });
  return c.json({ data: row });
});

const ConfirmWholesaleBody = z.object({ usdt_txn_ref: z.string().min(1).max(200) });

adminAgentRoutes.post('/wholesale/:id/confirm', zValidator('json', ConfirmWholesaleBody), async (c) => {
  const b = c.req.valid('json');
  const row = await confirmWholesaleOrder(ctx(), {
    orderId: c.req.param('id'),
    adminUserId: c.get('userId') as string,
    usdtTxnRef: b.usdt_txn_ref,
  });
  return c.json({ data: row });
});
