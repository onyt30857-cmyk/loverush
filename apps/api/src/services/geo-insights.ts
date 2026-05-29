/**
 * 地域运营看板 service · M02 Phase 5.2
 *
 * 5 个聚合函数 · 给 admin /admin/geo/dashboard/* 用
 *
 * 设计原则:
 *  - 双轨匹配:service_city_id 优先 · 旧 text 用 translations.zh/en 兜底(过渡期)
 *  - 30 天滚动窗口:NOW() - INTERVAL '30 days'
 *  - GMV 算法:SUM(price_points) FILTER (WHERE status IN PAID/IN_SERVICE/COMPLETED/REVIEWED)
 *  - 0 数据保留显示 · 让运营看全图
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@loverush/db';

// ──────────────────── 国家 meta(跟 routes/geo.ts 一致) ────────────────────

const COUNTRY_META: Record<string, { flag: string; nameZh: string; nameEn: string }> = {
  TH: { flag: '🇹🇭', nameZh: '泰国', nameEn: 'Thailand' },
  MY: { flag: '🇲🇾', nameZh: '马来西亚', nameEn: 'Malaysia' },
  VN: { flag: '🇻🇳', nameZh: '越南', nameEn: 'Vietnam' },
  ID: { flag: '🇮🇩', nameZh: '印度尼西亚', nameEn: 'Indonesia' },
};

function countryFlag(code: string): string {
  return COUNTRY_META[code]?.flag ?? '🌍';
}
function countryLabel(code: string, locale: string): string {
  const meta = COUNTRY_META[code];
  if (!meta) return code;
  return locale === 'en' ? meta.nameEn : meta.nameZh;
}

// ──────────────────── 1. 全局汇总(4 卡) ────────────────────

export interface GlobalSummary {
  cityCount: number;
  therapistCount: number;
  customerCount: number;
  orders30d: number;
  gmv30d: number;
}

export async function getGlobalSummary(db: Database): Promise<GlobalSummary> {
  // 4 个独立 COUNT/SUM · 简单清晰
  const rows = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM cities WHERE enabled=1)::int AS city_count,
      (SELECT COUNT(*) FROM therapists WHERE verification_status='passed')::int AS therapist_count,
      (SELECT COUNT(*) FROM user_location_preference WHERE city_id IS NOT NULL)::int AS customer_count,
      (SELECT COUNT(*) FROM orders
        WHERE created_at >= NOW() - INTERVAL '30 days')::int AS orders_30d,
      (SELECT COALESCE(SUM(price_points), 0) FROM orders
        WHERE created_at >= NOW() - INTERVAL '30 days'
          AND status IN ('PAID','IN_SERVICE','COMPLETED','REVIEWED'))::bigint AS gmv_30d
  `)) as Array<{
    city_count: number;
    therapist_count: number;
    customer_count: number;
    orders_30d: number;
    gmv_30d: number | string;
  }>;
  const row = rows[0]!;
  return {
    cityCount: row.city_count,
    therapistCount: row.therapist_count,
    customerCount: row.customer_count,
    orders30d: row.orders_30d,
    gmv30d: Number(row.gmv_30d),
  };
}

// ──────────────────── 2. 城市维度排行 ────────────────────

export interface CityInsight {
  cityId: string;
  cityCode: string;
  name: string;
  country: string;
  flag: string;
  therapistCount: number;
  customerCount: number;
  orders30d: number;
  gmv30d: number;
  completionRate: number; // 0..1 · -1 表示无订单
}

export async function getCityInsights(
  db: Database,
  options: { country?: string; locale?: string } = {},
): Promise<CityInsight[]> {
  const locale = options.locale ?? 'zh';
  const country = options.country?.toUpperCase();

  // 复杂多 JOIN · 用 CTE 一次构建
  const rows = (await db.execute(sql`
    WITH city_therapists AS (
      SELECT
        c.id AS city_id,
        t.user_id AS therapist_user_id
      FROM cities c
      LEFT JOIN therapists t ON (
        t.verification_status='passed' AND (
          t.service_city_id = c.id
          OR (t.service_city_id IS NULL AND t.service_city = c.translations->>'zh')
          OR (t.service_city_id IS NULL AND t.service_city = c.translations->>'en')
        )
      )
      WHERE c.enabled=1 ${country ? sql`AND c.country_code = ${country}` : sql``}
    ),
    city_orders AS (
      SELECT
        ct.city_id,
        COUNT(o.id)::int AS total,
        COUNT(o.id) FILTER (WHERE o.status IN ('COMPLETED','REVIEWED'))::int AS completed,
        COALESCE(SUM(o.price_points) FILTER (WHERE o.status IN ('PAID','IN_SERVICE','COMPLETED','REVIEWED')), 0)::bigint AS gmv
      FROM city_therapists ct
      LEFT JOIN orders o ON o.therapist_user_id = ct.therapist_user_id
        AND o.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY ct.city_id
    )
    SELECT
      c.id, c.code, c.country_code, c.translations, c.sort_order,
      (SELECT COUNT(DISTINCT therapist_user_id) FROM city_therapists WHERE city_id=c.id AND therapist_user_id IS NOT NULL)::int AS therapist_count,
      (SELECT COUNT(*) FROM user_location_preference WHERE city_id=c.id)::int AS customer_count,
      COALESCE(co.total, 0) AS orders_30d,
      COALESCE(co.completed, 0) AS orders_30d_completed,
      COALESCE(co.gmv, 0)::bigint AS gmv_30d
    FROM cities c
    LEFT JOIN city_orders co ON co.city_id = c.id
    WHERE c.enabled=1 ${country ? sql`AND c.country_code = ${country}` : sql``}
    ORDER BY gmv_30d DESC, therapist_count DESC, c.sort_order
  `)) as Array<{
    id: string;
    code: string;
    country_code: string;
    translations: Record<string, string>;
    therapist_count: number;
    customer_count: number;
    orders_30d: number;
    orders_30d_completed: number;
    gmv_30d: number | string;
  }>;

  return rows.map((r) => ({
    cityId: r.id,
    cityCode: r.code,
    name: r.translations[locale] ?? r.translations.zh ?? r.code,
    country: r.country_code,
    flag: countryFlag(r.country_code),
    therapistCount: r.therapist_count,
    customerCount: r.customer_count,
    orders30d: r.orders_30d,
    gmv30d: Number(r.gmv_30d),
    completionRate: r.orders_30d > 0 ? r.orders_30d_completed / r.orders_30d : -1,
  }));
}

// ──────────────────── 3. 国家维度排行 ────────────────────

export interface CountryInsight {
  country: string;
  flag: string;
  label: string;
  cityCount: number;
  therapistCount: number;
  customerCount: number;
  orders30d: number;
  gmv30d: number;
}

export async function getCountryInsights(
  db: Database,
  options: { locale?: string } = {},
): Promise<CountryInsight[]> {
  const locale = options.locale ?? 'zh';

  const rows = (await db.execute(sql`
    WITH city_therapists AS (
      SELECT
        c.country_code,
        c.id AS city_id,
        t.user_id AS therapist_user_id
      FROM cities c
      LEFT JOIN therapists t ON (
        t.verification_status='passed' AND (
          t.service_city_id = c.id
          OR (t.service_city_id IS NULL AND t.service_city = c.translations->>'zh')
          OR (t.service_city_id IS NULL AND t.service_city = c.translations->>'en')
        )
      )
      WHERE c.enabled=1
    )
    SELECT
      c.country_code,
      COUNT(DISTINCT c.id)::int AS city_count,
      (SELECT COUNT(DISTINCT therapist_user_id) FROM city_therapists ct
        WHERE ct.country_code = c.country_code AND therapist_user_id IS NOT NULL)::int AS therapist_count,
      (SELECT COUNT(*) FROM user_location_preference ulp
        JOIN cities cc ON cc.id = ulp.city_id
        WHERE cc.country_code = c.country_code)::int AS customer_count,
      (SELECT COUNT(*) FROM orders o
        JOIN city_therapists ct ON ct.therapist_user_id = o.therapist_user_id
        WHERE ct.country_code = c.country_code
          AND o.created_at >= NOW() - INTERVAL '30 days')::int AS orders_30d,
      (SELECT COALESCE(SUM(o.price_points), 0) FROM orders o
        JOIN city_therapists ct ON ct.therapist_user_id = o.therapist_user_id
        WHERE ct.country_code = c.country_code
          AND o.created_at >= NOW() - INTERVAL '30 days'
          AND o.status IN ('PAID','IN_SERVICE','COMPLETED','REVIEWED'))::bigint AS gmv_30d
    FROM cities c
    WHERE c.enabled=1
    GROUP BY c.country_code
    ORDER BY gmv_30d DESC, therapist_count DESC, c.country_code
  `)) as Array<{
    country_code: string;
    city_count: number;
    therapist_count: number;
    customer_count: number;
    orders_30d: number;
    gmv_30d: number | string;
  }>;

  return rows.map((r) => ({
    country: r.country_code,
    flag: countryFlag(r.country_code),
    label: countryLabel(r.country_code, locale),
    cityCount: r.city_count,
    therapistCount: r.therapist_count,
    customerCount: r.customer_count,
    orders30d: r.orders_30d,
    gmv30d: Number(r.gmv_30d),
  }));
}

// ──────────────────── 4. 供需缺口 ────────────────────

export type SupplyDemandStatus =
  | 'critical_shortage' // 比 >3 红:严重缺技师
  | 'shortage'          // 1.5 - 3 黄:轻度缺
  | 'balanced'          // 0.5 - 1.5 绿:平衡
  | 'oversupply'        // <0.5 蓝:客户不够
  | 'unopened';         // 技师 0 灰:暂未开通

export interface SupplyDemand {
  cityId: string;
  cityCode: string;
  name: string;
  country: string;
  flag: string;
  therapistCount: number;
  customerCount: number;
  ratio: number | null; // null 当 therapistCount=0
  status: SupplyDemandStatus;
  suggestion: string;
}

/** 纯函数 · 易测 */
export function classifySupplyDemand(args: {
  therapistCount: number;
  customerCount: number;
}): { ratio: number | null; status: SupplyDemandStatus; suggestion: string } {
  if (args.therapistCount === 0) {
    return {
      ratio: null,
      status: 'unopened',
      suggestion: args.customerCount > 0 ? '有客户期待 · 立即拉技师' : '暂未开通 · 评估是否撤城',
    };
  }
  const ratio = args.customerCount / args.therapistCount;
  if (ratio > 3) return { ratio, status: 'critical_shortage', suggestion: '严重缺技师 · 立即重点投入' };
  if (ratio > 1.5) return { ratio, status: 'shortage', suggestion: '轻度供给不足 · 关注' };
  if (ratio >= 0.5) return { ratio, status: 'balanced', suggestion: '供需平衡 · 维持' };
  return { ratio, status: 'oversupply', suggestion: '技师过剩 / 客户不够 · 拉客户做活动' };
}

export async function getSupplyDemand(
  db: Database,
  options: { locale?: string } = {},
): Promise<SupplyDemand[]> {
  const locale = options.locale ?? 'zh';

  const rows = (await db.execute(sql`
    SELECT
      c.id, c.code, c.country_code, c.translations,
      (SELECT COUNT(DISTINCT t.user_id) FROM therapists t
        WHERE t.verification_status='passed' AND (
          t.service_city_id = c.id
          OR (t.service_city_id IS NULL AND t.service_city = c.translations->>'zh')
          OR (t.service_city_id IS NULL AND t.service_city = c.translations->>'en')
        ))::int AS therapist_count,
      (SELECT COUNT(*) FROM user_location_preference WHERE city_id=c.id)::int AS customer_count
    FROM cities c
    WHERE c.enabled=1
    ORDER BY c.country_code, c.sort_order
  `)) as Array<{
    id: string;
    code: string;
    country_code: string;
    translations: Record<string, string>;
    therapist_count: number;
    customer_count: number;
  }>;

  const out = rows.map((r) => {
    const cls = classifySupplyDemand({
      therapistCount: r.therapist_count,
      customerCount: r.customer_count,
    });
    return {
      cityId: r.id,
      cityCode: r.code,
      name: r.translations[locale] ?? r.translations.zh ?? r.code,
      country: r.country_code,
      flag: countryFlag(r.country_code),
      therapistCount: r.therapist_count,
      customerCount: r.customer_count,
      ratio: cls.ratio,
      status: cls.status,
      suggestion: cls.suggestion,
    };
  });

  // 排序:critical → shortage → oversupply → balanced → unopened (高优先暴露问题)
  const order: Record<SupplyDemandStatus, number> = {
    critical_shortage: 0,
    shortage: 1,
    oversupply: 2,
    balanced: 3,
    unopened: 4,
  };
  out.sort((a, b) => {
    const d = order[a.status] - order[b.status];
    if (d !== 0) return d;
    return (b.ratio ?? -1) - (a.ratio ?? -1);
  });

  return out;
}

// ──────────────────── 5. 单城市深度 insight ────────────────────

export interface CityDeepInsight {
  city: { id: string; code: string; name: string; country: string; flag: string };
  metrics: {
    therapistCount: number;
    customerCount: number;
    orders30d: number;
    gmv30d: number;
    completionRate: number;
    avgRating: number | null;
    avgPrice: number | null;
  };
  statusBreakdown: Record<string, number>;
  topTherapists: Array<{
    therapistId: string;
    userId: string;
    displayName: string | null;
    scoreService: number;
    orders30d: number;
    gmv30d: number;
  }>;
  areasBreakdown: Array<{
    areaId: string;
    code: string;
    name: string;
    therapistCount: number;
    orders30d: number;
  }>;
}

export async function getCityDeepInsight(
  db: Database,
  cityId: string,
  options: { locale?: string } = {},
): Promise<CityDeepInsight | null> {
  const locale = options.locale ?? 'zh';

  // 1. city
  const cityRows = (await db.execute(sql`
    SELECT id, code, country_code, translations FROM cities WHERE id=${cityId}
  `)) as Array<{ id: string; code: string; country_code: string; translations: Record<string, string> }>;
  const city = cityRows[0];
  if (!city) return null;

  // 2. 该城市技师 user_id 集合(双轨匹配)
  const therapistRows = (await db.execute(sql`
    SELECT t.id AS therapist_id, t.user_id, u.display_name, t.score_service, t.base_price_json
    FROM therapists t
    JOIN users u ON u.id = t.user_id
    WHERE t.verification_status='passed' AND (
      t.service_city_id = ${cityId}
      OR (t.service_city_id IS NULL AND t.service_city = ${city.translations.zh ?? ''})
      OR (t.service_city_id IS NULL AND t.service_city = ${city.translations.en ?? ''})
    )
  `)) as Array<{
    therapist_id: string;
    user_id: string;
    display_name: string | null;
    score_service: number;
    base_price_json: Array<{ duration: number; pricePoints: number }> | null;
  }>;
  const therapistUserIds = therapistRows.map((t) => t.user_id);

  // 3. 客户偏好数
  const customerRow = (await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM user_location_preference WHERE city_id=${cityId}
  `)) as Array<{ n: number }>;
  const customerCount = customerRow[0]?.n ?? 0;

  // 4. 订单 + GMV + 状态分布(30 天 · 该城技师为对象)
  let orders30d = 0;
  let completed = 0;
  let gmv30d = 0;
  const statusBreakdown: Record<string, number> = {};
  const ordersByTherapist = new Map<string, { count: number; gmv: number }>();
  if (therapistUserIds.length > 0) {
    const orderRows = (await db.execute(sql`
      SELECT
        therapist_user_id,
        status::text AS status,
        price_points
      FROM orders
      WHERE therapist_user_id IN (
        SELECT unnest(${sql.raw(`ARRAY['${therapistUserIds.join("','")}']::uuid[]`)})
      )
        AND created_at >= NOW() - INTERVAL '30 days'
    `)) as Array<{ therapist_user_id: string; status: string; price_points: number | string }>;
    for (const o of orderRows) {
      orders30d++;
      statusBreakdown[o.status] = (statusBreakdown[o.status] ?? 0) + 1;
      if (['COMPLETED', 'REVIEWED'].includes(o.status)) completed++;
      const isGmv = ['PAID', 'IN_SERVICE', 'COMPLETED', 'REVIEWED'].includes(o.status);
      const cents = Number(o.price_points);
      if (isGmv) gmv30d += cents;
      const cur = ordersByTherapist.get(o.therapist_user_id) ?? { count: 0, gmv: 0 };
      cur.count++;
      if (isGmv) cur.gmv += cents;
      ordersByTherapist.set(o.therapist_user_id, cur);
    }
  }

  // 5. 平均评分(reviews on therapists in this city)
  let avgRating: number | null = null;
  if (therapistUserIds.length > 0) {
    const ratingRows = (await db.execute(sql`
      SELECT AVG(r.score_service)::float AS avg_score
      FROM reviews r
      JOIN orders o ON o.id = r.order_id
      WHERE o.therapist_user_id IN (
        SELECT unnest(${sql.raw(`ARRAY['${therapistUserIds.join("','")}']::uuid[]`)})
      )
    `)) as Array<{ avg_score: number | null }>;
    avgRating = ratingRows[0]?.avg_score ?? null;
  }

  // 6. 平均价(60min 档)
  const prices60 = therapistRows
    .map((t) => t.base_price_json?.find((p) => p.duration === 60)?.pricePoints)
    .filter((p): p is number => typeof p === 'number');
  const avgPrice = prices60.length > 0 ? Math.round(prices60.reduce((a, b) => a + b, 0) / prices60.length) : null;

  // 7. Top 10 技师(按 30d GMV 降序)
  const topTherapists = therapistRows
    .map((t) => {
      const stats = ordersByTherapist.get(t.user_id) ?? { count: 0, gmv: 0 };
      return {
        therapistId: t.therapist_id,
        userId: t.user_id,
        displayName: t.display_name,
        scoreService: t.score_service,
        orders30d: stats.count,
        gmv30d: stats.gmv,
      };
    })
    .sort((a, b) => b.gmv30d - a.gmv30d || b.orders30d - a.orders30d || b.scoreService - a.scoreService)
    .slice(0, 10);

  // 8. 区域 breakdown(该城下 areas)
  const areasBreakdownRows = (await db.execute(sql`
    SELECT
      a.id, a.code, a.translations,
      (SELECT COUNT(DISTINCT t2.user_id) FROM therapists t2
        WHERE t2.verification_status='passed' AND (
          t2.service_area_id = a.id
          OR (t2.service_area_id IS NULL AND t2.service_area = a.translations->>'zh')
          OR (t2.service_area_id IS NULL AND t2.service_area = a.translations->>'en')
        ))::int AS therapist_count
    FROM areas a
    WHERE a.city_id=${cityId} AND a.enabled=1
    ORDER BY a.sort_order
  `)) as Array<{
    id: string;
    code: string;
    translations: Record<string, string>;
    therapist_count: number;
  }>;

  const areasBreakdown = areasBreakdownRows.map((a) => ({
    areaId: a.id,
    code: a.code,
    name: a.translations[locale] ?? a.translations.zh ?? a.code,
    therapistCount: a.therapist_count,
    orders30d: 0, // 简化:区域级订单暂不统计(需要 orders 关联 area · 当前 schema 没有)
  }));

  return {
    city: {
      id: city.id,
      code: city.code,
      name: city.translations[locale] ?? city.translations.zh ?? city.code,
      country: city.country_code,
      flag: countryFlag(city.country_code),
    },
    metrics: {
      therapistCount: therapistRows.length,
      customerCount,
      orders30d,
      gmv30d,
      completionRate: orders30d > 0 ? completed / orders30d : -1,
      avgRating,
      avgPrice,
    },
    statusBreakdown,
    topTherapists,
    areasBreakdown,
  };
}
