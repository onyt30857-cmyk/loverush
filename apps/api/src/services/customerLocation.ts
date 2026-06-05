/**
 * 上门服务 · 客户上门地址(完整门牌 + 找路指引 + 大致区域 + 距离)组装 · 共享服务
 *
 * 到店 shopInfo.ts 的镜像 —— 到店把【技师店址】下发给客户;本功能把【客户上门址】下发给技师。
 *
 * 用于两处:
 *   1) getOrderDetail —— viewer 是本单客户/技师时注入 customerLocation
 *   2) confirmAndLock 成功后 —— 私聊自动推「客户上门地址卡」(type='customer_location')
 *
 * 安全门控(后端强制 · 绝不靠前端隐藏):
 *   - 客户看自己单 → full=true(看自己填的完整地址)。
 *   - 技师看本单 → 仅 status ∈ {LOCKED,PAID,IN_SERVICE,COMPLETED,REVIEWED} 且
 *     serviceMode ∈ {outcall, both} 时 full=true(确认/锁单后才下发门牌);
 *     否则 full=false(确认前只见大致区域 + 距离,绝不漏门牌)。
 *
 * 指引媒体:把 customerAddressMedia 的 mediaId 批量查 media_assets,只保留 auditStatus==='approved' 的。
 *
 * 铁律:全程不抛(组装失败降级,绝不阻断订单流程)。
 */

import { inArray, eq } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { mediaAssets, areas, cities } from '@loverush/db';
import { distanceKmRounded } from './geo-distance';

/** 门控允许技师看完整客户地址的订单状态 */
export const CUSTOMER_LOCATION_VISIBLE_STATUSES = ['LOCKED', 'PAID', 'IN_SERVICE', 'COMPLETED', 'REVIEWED'] as const;

/** 需要客户上门地址的服务方式(到店 incall 不需要) */
export const OUTCALL_SERVICE_MODES = ['outcall', 'both'] as const;

export interface CustomerAddressMediaItem {
  mediaId: string;
  kind: 'image' | 'video';
  caption?: string;
}

export interface ResolvedCustomerMedia {
  url: string;
  kind: 'image' | 'video';
  thumbnailUrl?: string;
  caption?: string;
}

export interface CustomerLocation {
  /** 大致区域名 · full=false 也下发 */
  areaName: string | null;
  /** 完整门牌 · full=false 时为 null */
  address: string | null;
  /** 找路指引 · full=false 时为 null */
  note: string | null;
  /** 楼栋照/视频(仅 approved)· full=false 时为 [] */
  media: ResolvedCustomerMedia[];
  /** 客户坐标 vs 技师区域中心 的距离(km · 模糊到 1km)· 无坐标则 null */
  distanceKm: number | null;
  /** 技师是否看到完整地址(门控结果) */
  full: boolean;
}

/**
 * 纯函数 · 是否允许技师看到【完整】客户上门地址。
 * 状态在白名单内 且 技师 serviceMode 为上门类 → true。
 * (确认前 / incall 技师 → false,只会下发区域 + 距离)
 */
export function customerLocationVisibleToTherapist(
  orderStatus: string | null | undefined,
  serviceMode: string | null | undefined,
): boolean {
  if (!orderStatus || !serviceMode) return false;
  return (
    (CUSTOMER_LOCATION_VISIBLE_STATUSES as readonly string[]).includes(orderStatus) &&
    (OUTCALL_SERVICE_MODES as readonly string[]).includes(serviceMode)
  );
}

/**
 * 把 customerAddressMedia(订单上存的 mediaId 列表)解析为可下发的媒体数组。
 * 只保留 media_assets.auditStatus==='approved' 的;保持原始顺序;无 publicUrl 的丢弃。
 * 失败/异常 → 返回 []。
 */
export async function resolveCustomerMedia(
  db: Database,
  media: CustomerAddressMediaItem[] | null | undefined,
): Promise<ResolvedCustomerMedia[]> {
  try {
    const items = Array.isArray(media) ? media : [];
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
    const out: ResolvedCustomerMedia[] = [];
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
    console.warn('[customerLocation] resolveCustomerMedia failed (降级为空):', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * 解析技师区域中心坐标:优先 serviceAreaId→areas.latCenter/lngCenter,回退 serviceCityId→cities。
 * 任一缺失 → 返回 { lat:null, lng:null }(距离校验/展示自动跳过)。失败不抛。
 */
export async function resolveTherapistAreaCenter(
  db: Database,
  args: { serviceAreaId?: string | null; serviceCityId?: string | null },
): Promise<{ lat: string | null; lng: string | null }> {
  try {
    if (args.serviceAreaId) {
      const area = await db.query.areas.findFirst({ where: eq(areas.id, args.serviceAreaId) });
      if (area?.latCenter && area?.lngCenter) return { lat: area.latCenter, lng: area.lngCenter };
    }
    if (args.serviceCityId) {
      const city = await db.query.cities.findFirst({ where: eq(cities.id, args.serviceCityId) });
      if (city?.latCenter && city?.lngCenter) return { lat: city.latCenter, lng: city.lngCenter };
    }
    return { lat: null, lng: null };
  } catch (err) {
    console.warn('[customerLocation] resolveTherapistAreaCenter failed:', err instanceof Error ? err.message : err);
    return { lat: null, lng: null };
  }
}

/**
 * 组装客户上门地址。调用前应先用 customerLocationVisibleToTherapist 判定门控(技师视角),
 * 客户自见时直接传 full=true。
 *  - full=false → address/note 置 null、media 置 [](只留 areaName + distanceKm)。
 *  - distanceKm 用技师区域中心 vs 客户 lat/lng 计算(任一缺失 → null)。
 */
export async function buildCustomerLocation(
  db: Database,
  args: {
    address: string | null | undefined;
    note: string | null | undefined;
    areaName: string | null | undefined;
    lat: string | null | undefined;
    lng: string | null | undefined;
    media: CustomerAddressMediaItem[] | null | undefined;
    full: boolean;
    therapistAreaLat?: string | null;
    therapistAreaLng?: string | null;
  },
): Promise<CustomerLocation> {
  const distanceKm = distanceKmRounded(args.therapistAreaLat, args.therapistAreaLng, args.lat, args.lng);
  if (!args.full) {
    return {
      areaName: args.areaName ?? null,
      address: null,
      note: null,
      media: [],
      distanceKm,
      full: false,
    };
  }
  const media = await resolveCustomerMedia(db, args.media);
  return {
    areaName: args.areaName ?? null,
    address: args.address ?? null,
    note: args.note ?? null,
    media,
    distanceKm,
    full: true,
  };
}
