/**
 * 到店服务 · 门店信息(地址 + 找店指引 + 到店须知)组装 · 共享服务
 *
 * 用于两处:
 *   1) getOrderDetail —— 门控满足时在订单详情注入 shopInfo
 *   2) confirmAndLock 成功后 —— 私聊自动推「门店信息卡」(type='shop_info')
 *
 * 安全门控(后端强制 · 绝不靠前端隐藏):
 *   - 订单状态 ∈ {LOCKED, PAID, IN_SERVICE, COMPLETED, REVIEWED}
 *   - 技师 serviceMode ∈ {incall, both}
 *   不满足 → 不返回 shopInfo(地址绝不下发)。
 *
 * 指引媒体:把 shopGuideMedia 的 mediaId 批量查 media_assets,只保留 auditStatus==='approved' 的,
 *   取 publicUrl→url / thumbnailUrl / kind / caption。
 *
 * 铁律:全程不抛(组装失败降级为空/无 shopInfo,绝不阻断订单流程)。
 */

import { inArray } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { mediaAssets } from '@loverush/db';

/** 门控允许下发地址/指引的订单状态 */
export const SHOP_INFO_VISIBLE_STATUSES = ['LOCKED', 'PAID', 'IN_SERVICE', 'COMPLETED', 'REVIEWED'] as const;

/** 提供到店地址的服务方式 */
export const INCALL_SERVICE_MODES = ['incall', 'both'] as const;

export interface ShopGuideMediaItem {
  mediaId: string;
  kind: 'image' | 'video';
  caption?: string;
}

export interface ResolvedGuideMedia {
  url: string;
  kind: 'image' | 'video';
  thumbnailUrl?: string;
  caption?: string;
}

export interface ShopInfo {
  address: string | null;
  arrivalNote: string | null;
  guideMedia: ResolvedGuideMedia[];
}

/**
 * 纯函数 · 是否允许下发门店信息(地址/指引)。
 * 状态在白名单内 且 技师 serviceMode 为到店类 → true。
 */
export function shopInfoVisible(
  orderStatus: string | null | undefined,
  serviceMode: string | null | undefined,
): boolean {
  if (!orderStatus || !serviceMode) return false;
  return (
    (SHOP_INFO_VISIBLE_STATUSES as readonly string[]).includes(orderStatus) &&
    (INCALL_SERVICE_MODES as readonly string[]).includes(serviceMode)
  );
}

/**
 * 把 shopGuideMedia(技师档案上配置的 mediaId 列表)解析为可下发的媒体数组。
 * 只保留 media_assets.auditStatus==='approved' 的;保持 shopGuideMedia 原始顺序;无 publicUrl 的丢弃。
 * 失败/异常 → 返回 []。
 */
export async function resolveGuideMedia(
  db: Database,
  shopGuideMedia: ShopGuideMediaItem[] | null | undefined,
): Promise<ResolvedGuideMedia[]> {
  try {
    const items = Array.isArray(shopGuideMedia) ? shopGuideMedia : [];
    if (items.length === 0) return [];
    const ids = items.map((m) => m.mediaId);
    const rows = await db
      .select({
        id: mediaAssets.id,
        publicUrl: mediaAssets.publicUrl,
        thumbnailUrl: mediaAssets.thumbnailUrl,
        auditStatus: mediaAssets.auditStatus,
      })
      .from(mediaAssets)
      .where(inArray(mediaAssets.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: ResolvedGuideMedia[] = [];
    for (const item of items) {
      const row = byId.get(item.mediaId);
      if (!row || row.auditStatus !== 'approved' || !row.publicUrl) continue;
      out.push({
        url: row.publicUrl,
        kind: item.kind,
        ...(row.thumbnailUrl ? { thumbnailUrl: row.thumbnailUrl } : {}),
        ...(item.caption ? { caption: item.caption } : {}),
      });
    }
    return out;
  } catch (err) {
    console.warn('[shopInfo] resolveGuideMedia failed (降级为空):', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * 组装完整 shopInfo(地址 + 须知 + 已过审指引媒体)。调用前应先用 shopInfoVisible 判定门控。
 */
export async function buildShopInfo(
  db: Database,
  args: {
    address: string | null | undefined;
    arrivalNote: string | null | undefined;
    shopGuideMedia: ShopGuideMediaItem[] | null | undefined;
  },
): Promise<ShopInfo> {
  const guideMedia = await resolveGuideMedia(db, args.shopGuideMedia);
  return {
    address: args.address ?? null,
    arrivalNote: args.arrivalNote ?? null,
    guideMedia,
  };
}
