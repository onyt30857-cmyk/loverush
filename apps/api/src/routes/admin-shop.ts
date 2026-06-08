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
 * 通用图片上传(商品封面/详情多图，无需绑 itemId)
 * POST   /admin/shop/media/upload-init  申请 R2 预签名 PUT URL
 * POST   /admin/shop/media/finalize     通知后端上传完成，返回 publicUrl
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
import {
  issueUploadUrl,
  finalizeMedia,
  type MediaContext,
} from '../services/media';

function sctx(): ShopContext {
  return { db: getDb() };
}

function mctx(): MediaContext {
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

// ──────────────── 通用图片上传(商品封面 / 详情多图) ────────────────
// 设计：新建商品时还没有 itemId，所以上传端点不绑 itemId。
// 前端传完得到 publicUrl，填进表单 cover_url/media_urls，随建/改商品一起提交。

/** gallery 白名单：图片 jpeg/png/webp，上限 20MB */
const GALLERY_MIME_WHITELIST = ['image/jpeg', 'image/png', 'image/webp'];

const UploadInitBody = z.object({
  mime_type: z.string().min(1).max(100),
  size_bytes: z.number().int().min(1),
  ext: z.string().min(1).max(10),
});

adminShopRoutes.post('/media/upload-init', zValidator('json', UploadInitBody), async (c) => {
  const body = c.req.valid('json');
  // 校验 gallery 白名单（image/jpeg, image/png, image/webp）
  const baseMime = (body.mime_type || '').split(';')[0]!.trim().toLowerCase();
  if (!GALLERY_MIME_WHITELIST.includes(baseMime)) {
    return c.json(
      { error: { code: 'E0001', message: `不支持的图片格式 ${body.mime_type}，请上传 jpeg/png/webp` } },
      400,
    );
  }
  const result = await issueUploadUrl(mctx(), {
    ownerUserId: c.get('userId'),
    purpose: 'gallery',
    mimeType: baseMime,
    sizeBytes: body.size_bytes,
    ext: body.ext,
  });
  return c.json({ data: { mediaId: result.mediaId, uploadUrl: result.uploadUrl } });
});

const FinalizeBody = z.object({
  media_id: z.string().min(1),
  width_px: z.number().int().min(1).optional(),
  height_px: z.number().int().min(1).optional(),
  actual_size_bytes: z.number().int().min(1).optional(),
});

adminShopRoutes.post('/media/finalize', zValidator('json', FinalizeBody), async (c) => {
  const body = c.req.valid('json');
  const asset = await finalizeMedia(mctx(), {
    mediaId: body.media_id,
    ownerUserId: c.get('userId'),
    widthPx: body.width_px,
    heightPx: body.height_px,
    actualSizeBytes: body.actual_size_bytes,
  });
  // finalizeMedia 返回 MediaAsset，publicUrl 字段已在 issueUploadUrl 时写入
  const publicUrl = asset.publicUrl ?? '';
  return c.json({ data: { publicUrl } });
});
