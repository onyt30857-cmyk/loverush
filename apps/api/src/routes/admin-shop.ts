/**
 * Admin · 橱窗带货管理 · M09a
 *
 * GET    /admin/shop/items              列全部商品（admin 不过滤国家）
 * POST   /admin/shop/items             新建商品
 * PATCH  /admin/shop/items/:id         更新商品
 * GET    /admin/shop/orders            列橱窗订单（支持 ?status= 筛选）
 * POST   /admin/shop/orders/:id/ship   发货（body: { tracking_number? }）
 * POST   /admin/shop/orders/:id/deliver 送达结算
 * POST   /admin/shop/orders/:id/refund  退款回滚
 *
 * 仅 admin 角色
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { shopOrders } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import {
  listShopItems,
  createShopItem,
  updateShopItem,
  markShipped,
  settleShopOrder,
  refundShopOrder,
  type ShopContext,
} from '../services/shop';

function sctx(): ShopContext {
  return { db: getDb() };
}

export const adminShopRoutes = new Hono();
adminShopRoutes.use('*', requireAuth, requireRole(['admin']));

// ──────────────── 商品管理 ────────────────

const AdminItemListQuery = z.object({
  category: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** 列全部商品（admin 不过滤国家，含下架） */
adminShopRoutes.get('/items', zValidator('query', AdminItemListQuery), async (c) => {
  const q = c.req.valid('query');
  // admin 查全量：不传 isActive 过滤，直接 listShopItems 无 countryCode
  const list = await listShopItems(sctx(), { category: q.category, limit: q.limit, offset: q.offset });
  return c.json({ data: list });
});

const CreateItemBody = z.object({
  sku: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(40),
  price_points: z.number().int().min(1),
  cost_points: z.number().int().min(0).optional(),
  commission_bps_default: z.number().int().min(0).max(10000).optional(),
  stock_qty: z.number().int().min(0).optional(),
  country_codes: z.array(z.string().max(4)).optional(),
  cover_url: z.string().url().optional(),
  media_urls: z.array(z.string().url()).optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

adminShopRoutes.post('/items', zValidator('json', CreateItemBody), async (c) => {
  const body = c.req.valid('json');
  const item = await createShopItem(sctx(), {
    sku: body.sku,
    title: body.title,
    category: body.category,
    pricePoints: body.price_points,
    costPoints: body.cost_points,
    commissionBpsDefault: body.commission_bps_default,
    stockQty: body.stock_qty,
    countryCodes: body.country_codes,
    coverUrl: body.cover_url,
    mediaUrls: body.media_urls,
    isActive: body.is_active,
  });
  return c.json({ data: item });
});

const PatchItemBody = z.object({
  title: z.string().min(1).max(200).optional(),
  category: z.string().min(1).max(40).optional(),
  price_points: z.number().int().min(1).optional(),
  cost_points: z.number().int().min(0).optional(),
  commission_bps_default: z.number().int().min(0).max(10000).optional(),
  stock_qty: z.number().int().min(0).optional(),
  country_codes: z.array(z.string().max(4)).optional(),
  cover_url: z.string().url().optional(),
  media_urls: z.array(z.string().url()).optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

adminShopRoutes.patch('/items/:id', zValidator('json', PatchItemBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const patch: Parameters<typeof updateShopItem>[2] = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.category !== undefined) patch.category = body.category;
  if (body.price_points !== undefined) patch.pricePoints = body.price_points;
  if (body.cost_points !== undefined) patch.costPoints = body.cost_points;
  if (body.commission_bps_default !== undefined) patch.commissionBpsDefault = body.commission_bps_default;
  if (body.stock_qty !== undefined) patch.stockQty = body.stock_qty;
  if (body.country_codes !== undefined) patch.countryCodes = body.country_codes;
  if (body.cover_url !== undefined) patch.coverUrl = body.cover_url;
  if (body.media_urls !== undefined) patch.mediaUrls = body.media_urls;
  if (body.is_active !== undefined) patch.isActive = body.is_active;
  const item = await updateShopItem(sctx(), id, patch);
  return c.json({ data: item });
});

// ──────────────── 订单履约 ────────────────

const AdminOrderQuery = z.object({
  status: z
    .enum(['pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

adminShopRoutes.get('/orders', zValidator('query', AdminOrderQuery), async (c) => {
  const q = c.req.valid('query');
  const list = await getDb().query.shopOrders.findMany({
    where: q.status ? eq(shopOrders.status, q.status) : undefined,
    orderBy: [desc(shopOrders.createdAt)],
    limit: q.limit ?? 50,
    offset: q.offset ?? 0,
  });
  return c.json({ data: list });
});

const ShipBody = z.object({
  tracking_number: z.string().max(200).optional(),
});

adminShopRoutes.post('/orders/:id/ship', zValidator('json', ShipBody), async (c) => {
  const body = c.req.valid('json');
  await markShipped(sctx(), { orderId: c.req.param('id'), trackingNumber: body.tracking_number });
  return c.json({ data: { ok: true } });
});

adminShopRoutes.post('/orders/:id/deliver', async (c) => {
  await settleShopOrder(sctx(), { orderId: c.req.param('id') });
  return c.json({ data: { ok: true } });
});

adminShopRoutes.post('/orders/:id/refund', async (c) => {
  await refundShopOrder(sctx(), { orderId: c.req.param('id') });
  return c.json({ data: { ok: true } });
});
