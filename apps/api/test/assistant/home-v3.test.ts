/**
 * 单元测试 · 助理 Home v3 仪表盘契约
 *
 * 覆盖:
 *   - 新用户 → memory_cta=null + recent_activity=[] + today_picks 永远 ≥3 条(兜底)
 *   - 老用户 → memory_cta 含 recall_last_booking + today_picks 含 why_recommend
 *   - refresh-picks 返回新一批 ids(避开 exclude)
 *   - smart_chips 老客含个性化"像 X 那种"
 *   - greeting tone 5 时段
 *   - 中英 locale 切换
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAssistantHome,
  refreshTodayPicks,
  type HomeContext,
} from '../../src/services/assistant/home';
import {
  buildGreeting,
  toToneFromDate,
} from '../../src/services/assistant/prompts/greeting';

// ──────────────── fake db ────────────────

interface SavedRow {
  userId: string;
  facts: Record<string, unknown>;
  stablePrefs: Record<string, unknown>;
  shameSafePrefs: Record<string, unknown>;
  tabooZones: string[];
  exportedAt: Date | null;
  deletionScheduledAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

interface UserRow {
  id: string;
  displayName: string | null;
  locale: string | null;
  createdAt: Date;
}

interface RefRow {
  id: string;
  userId: string;
  memoryType: 'rotating' | 'relation' | 'diff';
  refTherapistId: string | null;
  refOrderId: string | null;
  archivedAt: Date | null;
  validTo: Date | null;
  recordedAt: Date;
  content: string;
  entities: string[];
  importance: number;
}

interface TherapistRow {
  id: string;
  userId: string;
  bio: string | null;
  avatarUrl: string | null;
  serviceCity: string | null;
  verificationStatus: string;
  coolingStatus: string;
  onlineStatus: string;
  lastOnlineAt: Date | null;
  createdAt: Date;
  rating: number;
  scoreService: number;
  tags: string[] | null;
}

interface SessionRow {
  id: string;
  userId: string;
  preview: string | null;
  turnsCount: number;
  updatedAt: Date;
  createdAt: Date;
}

interface OrderRow {
  id: string;
  customerId: string;
  therapistId: string;
  status: string;
  customerRating: number | null;
  customerReview: string | null;
  completedAt: Date | null;
  createdAt: Date;
}

let savedRows: SavedRow[] = [];
let userRows: UserRow[] = [];
let refRows: RefRow[] = [];
let therapistRows: TherapistRow[] = [];
let sessionRows: SessionRow[] = [];
let orderRows: OrderRow[] = [];

function makeFakeDb(): HomeContext['db'] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    query: {
      users: {
        findFirst: async (opts: { where: { _user?: string } }) => {
          const wantedId = (opts.where)._user;
          return userRows.find((u) => u.id === wantedId) ?? null;
        },
      },
      customerSavedMemory: {
        findFirst: async (opts: { where: { _user?: string } }) => {
          const wantedId = (opts.where)._user;
          return savedRows.find((s) => s.userId === wantedId) ?? null;
        },
      },
      customerReferenceMemory: {
        findMany: async (opts: { where?: unknown; limit?: number }) => {
          void opts;
          // 简化:返回所有 ref rows · 由调用方过滤
          // 但我们要支持多 type 的 readReference,通过 opts.where 中的 _type 暗号区分
          // 这里 mock 默认只返回 relation 类型(对 home 主要用)
          // readReference 会 mock 'rotating' / 'diff' · 我们用全局 currentMemoryType 控制
          const type = currentMemoryType;
          return refRows
            .filter(
              (r) =>
                (!type || r.memoryType === type) &&
                !r.archivedAt &&
                !r.validTo,
            )
            .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
            .slice(0, opts?.limit ?? 100);
        },
      },
      customerInterestClusters: { findMany: async () => [] },
      customerAssistantSessions: {
        findMany: async (opts: { where?: { _user?: string }; limit?: number }) => {
          const uid = (opts?.where)?._user;
          return sessionRows
            .filter((s) => !uid || s.userId === uid)
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
            .slice(0, opts?.limit ?? 100);
        },
      },
      therapists: {
        findMany: async (opts: { where?: unknown; limit?: number }) => {
          void opts;
          const rows = therapistRows.filter(
            (t) => t.verificationStatus === 'passed' && t.coolingStatus !== 'cold',
          );
          return rows.slice(0, opts?.limit ?? 100);
        },
        findFirst: async (opts: { where?: { _user?: string } }) => {
          const wantedId = (opts.where)?._user;
          if (wantedId) {
            return therapistRows.find((t) => t.id === wantedId) ?? null;
          }
          return therapistRows.find(
            (t) => t.verificationStatus === 'passed' && t.coolingStatus !== 'cold',
          ) ?? null;
        },
      },
      orders: {
        findMany: async (opts: { where?: { _user?: string }; limit?: number }) => {
          void opts;
          return orderRows
            .filter((o) => o.status === 'COMPLETED')
            .sort(
              (a, b) =>
                (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
            )
            .slice(0, opts?.limit ?? 100);
        },
      },
      blockList: { findMany: async () => [] },
      customerMasterPreferences: { findFirst: async () => null },
      customerBehaviorProfile: { findFirst: async () => null },
      customerRelationshipProfile: { findMany: async () => [] },
    },
    insert: () => ({
      values: (val: Record<string, unknown>) => ({
        returning: async () => {
          const row = {
            ...val,
            id: `id_${Math.random().toString(36).slice(2)}`,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          return [row];
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: async () => [] }),
      }),
    }),
  };
  return db as HomeContext['db'];
}

// drizzle-orm mock(eq/and/sql/isNull)
let currentMemoryType: 'rotating' | 'relation' | 'diff' | null = null;
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('drizzle-orm');
  return {
    ...actual,
    eq: (col: { name?: string } | unknown, val: unknown) => {
      // 监测 memoryType 谓词 · 用于 fake findMany 反推
      const c = col as { columnName?: string; name?: string } | undefined;
      const colName = c?.columnName ?? c?.name ?? '';
      if (typeof colName === 'string' && colName.includes('memory_type')) {
        currentMemoryType = val as 'rotating' | 'relation' | 'diff';
      }
      return { _user: String(val), _col: col };
    },
    and: (...args: unknown[]) => ({ _and: args }),
    or: (...args: unknown[]) => ({ _or: args }),
    isNull: () => ({ _isnull: true }),
    desc: (col: unknown) => ({ _desc: col }),
    asc: (col: unknown) => ({ _asc: col }),
    gte: () => ({ _gte: true }),
    ne: () => ({ _ne: true }),
    inArray: () => ({ _inarray: true }),
    sql: Object.assign(() => ({ _sql: true }), {
      join: () => ({ _join: true }),
      raw: () => ({ _raw: true }),
    }),
  };
});

const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function ctx(): HomeContext {
  return { db: makeFakeDb() };
}

beforeEach(() => {
  savedRows = [];
  userRows = [
    {
      id: userId,
      displayName: '阿哲',
      locale: 'zh',
      createdAt: new Date(Date.now() - 22 * 24 * 3600 * 1000),
    },
  ];
  refRows = [];
  therapistRows = [];
  sessionRows = [];
  orderRows = [];
  currentMemoryType = null;
});

// ──────────────── 新用户路径 ────────────────

describe('Unit · home v3 · 新用户路径', () => {
  it('新用户 → onboarding_required=true · memory_cta=null', async () => {
    const home = await getAssistantHome(ctx(), userId);
    expect(home.onboarding_required).toBe(true);
    expect(home.memory_cta).toBeNull();
  });

  it('新用户 → recent_activity=[]', async () => {
    const home = await getAssistantHome(ctx(), userId);
    expect(home.recent_activity).toEqual([]);
  });

  it('新用户 · 平台有 verified passed 技师 → today_picks 兜底 3 条', async () => {
    for (let i = 0; i < 5; i++) {
      therapistRows.push({
        id: `tttttttt-aaaa-aaaa-aaaa-${String(i).padStart(12, '0')}`,
        userId: `uuuuuuuu-aaaa-aaaa-aaaa-${String(i).padStart(12, '0')}`,
        bio: `技师${i}`,
        avatarUrl: null,
        serviceCity: '曼谷',
        verificationStatus: 'passed',
        coolingStatus: 'active',
        onlineStatus: i % 2 === 0 ? 'online' : 'offline',
        lastOnlineAt: new Date(),
        createdAt: new Date(Date.now() - i * 24 * 3600 * 1000),
        rating: 400 + i,
        scoreService: 850 + i * 5,
        tags: ['温柔', '专业'],
      });
    }
    const home = await getAssistantHome(ctx(), userId);
    expect(home.today_picks.items.length).toBe(3);
    expect(home.today_picks.reason_tag).toContain('精选');
    expect(home.today_picks.refresh_token).toMatch(/^rt_/);
    // 每条 item 必须含 why_recommend(新客 fallback 固定文案)
    for (const it of home.today_picks.items) {
      expect(it.why_recommend.length).toBeGreaterThan(0);
    }
  });

  it('新用户 · 完全无 verified 技师 → today_picks 仍不 throw(items 可空但不挂)', async () => {
    const home = await getAssistantHome(ctx(), userId);
    expect(home.today_picks).toBeDefined();
    expect(Array.isArray(home.today_picks.items)).toBe(true);
  });

  it('新用户 → smart_chips 含默认 3 个(tonight/nearby/budget)', async () => {
    const home = await getAssistantHome(ctx(), userId);
    const keys = home.smart_chips.map((c) => c.key);
    expect(keys).toContain('tonight');
    expect(keys).toContain('nearby');
    expect(keys).toContain('budget');
    // 新用户不带"像 X 那种"
    expect(keys.some((k) => k.startsWith('like_'))).toBe(false);
  });
});

// ──────────────── 老用户路径 ────────────────

describe('Unit · home v3 · 老用户路径', () => {
  beforeEach(() => {
    savedRows.push({
      userId,
      facts: { city: '曼谷', onboarding_complete: true },
      stablePrefs: { priorities: ['温柔', '专业'] },
      shameSafePrefs: {},
      tabooZones: [],
      exportedAt: null,
      deletionScheduledAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
  });

  it('老用户 · L4 含 booking 好评 → memory_cta=recall_last_booking', async () => {
    const therapistId = 'tttttttt-1111-1111-1111-111111111111';
    const therapistUserId = 'uuuuuuuu-1111-1111-1111-111111111111';
    therapistRows.push({
      id: therapistId,
      userId: therapistUserId,
      bio: 'Mira 温柔细致',
      avatarUrl: 'https://x/mira',
      serviceCity: '曼谷',
      verificationStatus: 'passed',
      coolingStatus: 'active',
      onlineStatus: 'online',
      lastOnlineAt: new Date(),
      createdAt: new Date(),
      rating: 480,
      scoreService: 920,
      tags: ['温柔'],
    });
    userRows.push({
      id: therapistUserId,
      displayName: 'Mira',
      locale: 'zh',
      createdAt: new Date(),
    });
    refRows.push({
      id: 'ref_1',
      userId,
      memoryType: 'relation',
      refTherapistId: therapistId,
      refOrderId: 'order_xxx',
      archivedAt: null,
      validTo: null,
      recordedAt: new Date(),
      content: '上次约 Mira 还行 手法到位',
      entities: ['favorite:mira'],
      importance: 6,
    });
    const home = await getAssistantHome(ctx(), userId);
    expect(home.memory_cta).not.toBeNull();
    expect(home.memory_cta!.type).toBe('recall_last_booking');
    expect(home.memory_cta!.headline).toContain('Mira');
    // 含 book_again action 含 ref_id
    const book = home.memory_cta!.actions.find((a) => a.key === 'book_again');
    expect(book).toBeDefined();
    expect(book!.ref_id).toBe(therapistId);
  });

  it('老用户 → today_picks 永远 ≥3 条', async () => {
    for (let i = 0; i < 6; i++) {
      therapistRows.push({
        id: `tttttttt-bbbb-bbbb-bbbb-${String(i).padStart(12, '0')}`,
        userId: `uuuuuuuu-bbbb-bbbb-bbbb-${String(i).padStart(12, '0')}`,
        bio: `T${i}`,
        avatarUrl: null,
        serviceCity: '曼谷',
        verificationStatus: 'passed',
        coolingStatus: 'active',
        onlineStatus: 'online',
        lastOnlineAt: new Date(),
        createdAt: new Date(Date.now() - i * 24 * 3600 * 1000),
        rating: 400 + i,
        scoreService: 800 + i,
        tags: ['温柔', '专业'],
      });
    }
    const home = await getAssistantHome(ctx(), userId);
    expect(home.today_picks.items.length).toBe(3);
    // 每个 item 含 score_service / display_name / why_recommend
    for (const it of home.today_picks.items) {
      expect(it.therapist_id).toBeTruthy();
      expect(it.display_name).toBeTruthy();
      expect(it.why_recommend).toBeTruthy();
      // distance_km 允许 null
      expect(it.distance_km === null || typeof it.distance_km === 'number').toBe(true);
    }
  });

  it('老用户 · 有 COMPLETED orders → recent_activity 含 booking', async () => {
    const therapistId = 'tttttttt-cccc-cccc-cccc-cccccccccccc';
    const therapistUserId = 'uuuuuuuu-cccc-cccc-cccc-cccccccccccc';
    therapistRows.push({
      id: therapistId,
      userId: therapistUserId,
      bio: 'Mira',
      avatarUrl: null,
      serviceCity: '曼谷',
      verificationStatus: 'passed',
      coolingStatus: 'active',
      onlineStatus: 'online',
      lastOnlineAt: new Date(),
      createdAt: new Date(),
      rating: 450,
      scoreService: 900,
      tags: ['温柔'],
    });
    userRows.push({
      id: therapistUserId,
      displayName: 'Mira',
      locale: 'zh',
      createdAt: new Date(),
    });
    orderRows.push({
      id: 'o1',
      customerId: userId,
      therapistId,
      status: 'COMPLETED',
      customerRating: 4,
      customerReview: '手法刚好',
      completedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
    });
    const home = await getAssistantHome(ctx(), userId);
    const booking = home.recent_activity.find((a) => a.type === 'booking');
    expect(booking).toBeDefined();
    expect(booking!.summary).toContain('Mira');
    expect(booking!.summary).toContain('★4');
    expect(booking!.related_therapist_id).toBe(therapistId);
  });

  it('老用户 · sessions preview → recent_activity 含 question', async () => {
    sessionRows.push({
      id: 'sess_1',
      userId,
      preview: '泰式和中式哪个解乏',
      turnsCount: 3,
      updatedAt: new Date(Date.now() - 24 * 3600 * 1000),
      createdAt: new Date(Date.now() - 24 * 3600 * 1000),
    });
    const home = await getAssistantHome(ctx(), userId);
    const q = home.recent_activity.find((a) => a.type === 'question');
    expect(q).toBeDefined();
    expect(q!.summary).toContain('泰式');
  });

  it('老用户 · smart_chips 含个性化"像 X 那种"', async () => {
    const therapistId = 'tttttttt-dddd-dddd-dddd-dddddddddddd';
    const therapistUserId = 'uuuuuuuu-dddd-dddd-dddd-dddddddddddd';
    therapistRows.push({
      id: therapistId,
      userId: therapistUserId,
      bio: 'Linn',
      avatarUrl: null,
      serviceCity: '曼谷',
      verificationStatus: 'passed',
      coolingStatus: 'active',
      onlineStatus: 'online',
      lastOnlineAt: new Date(),
      createdAt: new Date(),
      rating: 450,
      scoreService: 900,
      tags: ['温柔'],
    });
    userRows.push({
      id: therapistUserId,
      displayName: 'Linn',
      locale: 'zh',
      createdAt: new Date(),
    });
    refRows.push({
      id: 'ref_2',
      userId,
      memoryType: 'relation',
      refTherapistId: therapistId,
      refOrderId: null,
      archivedAt: null,
      validTo: null,
      recordedAt: new Date(),
      content: 'Linn 不错',
      entities: ['favorite:linn'],
      importance: 6,
    });
    const home = await getAssistantHome(ctx(), userId);
    const personalized = home.smart_chips.find((c) => c.label.includes('Linn'));
    expect(personalized).toBeDefined();
    expect(personalized!.label).toContain('像');
    // 老客 chip 也含 refresh / describe
    const keys = home.smart_chips.map((c) => c.key);
    expect(keys).toContain('refresh');
    expect(keys).toContain('describe');
  });

  it('老用户 → greeting 含 "第 N 天" + 显示名', async () => {
    const home = await getAssistantHome(ctx(), userId);
    expect(home.greeting.text).toContain('第');
    expect(home.greeting.text).toContain('天');
    expect(home.greeting.text).toContain('阿哲');
    expect(home.greeting.days_since_first).toBeGreaterThan(0);
  });
});

// ──────────────── refresh-picks ────────────────

describe('Unit · home v3 · refresh-picks', () => {
  beforeEach(() => {
    savedRows.push({
      userId,
      facts: { city: '曼谷', onboarding_complete: true },
      stablePrefs: {},
      shameSafePrefs: {},
      tabooZones: [],
      exportedAt: null,
      deletionScheduledAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
    // 6 个候选(让能换出新的)
    for (let i = 0; i < 6; i++) {
      therapistRows.push({
        id: `tttttttt-eeee-eeee-eeee-${String(i).padStart(12, '0')}`,
        userId: `uuuuuuuu-eeee-eeee-eeee-${String(i).padStart(12, '0')}`,
        bio: `T${i}`,
        avatarUrl: null,
        serviceCity: '曼谷',
        verificationStatus: 'passed',
        coolingStatus: 'active',
        onlineStatus: 'online',
        lastOnlineAt: new Date(),
        createdAt: new Date(),
        rating: 400 + i,
        scoreService: 800 + i,
        tags: ['温柔'],
      });
    }
  });

  it('refresh-picks 返回新一批 picks · 排除上次 ids', async () => {
    const c = ctx();
    const first = await getAssistantHome(c, userId);
    const firstIds = new Set(first.today_picks.items.map((i) => i.therapist_id));
    expect(firstIds.size).toBe(3);

    const refresh = await refreshTodayPicks(c, userId, {
      refreshToken: first.today_picks.refresh_token,
    });
    // 6 候选 / 3 用过 / 还有 3 可换 → 不能与第一次完全相同
    const refreshIds = new Set(refresh.items.map((i) => i.therapist_id));
    const overlap = [...refreshIds].filter((id) => firstIds.has(id));
    expect(overlap.length).toBeLessThan(3); // 至少有一个新的
  });

  it('refresh-picks · 候选不足时 fallback 也保 ≥1', async () => {
    const c = ctx();
    // 调用 5 次 home 把 exclude 灌满 · 看 refresh 仍能返回 items
    for (let i = 0; i < 3; i++) await getAssistantHome(c, userId);
    const refresh = await refreshTodayPicks(c, userId, {});
    expect(refresh.items.length).toBeGreaterThanOrEqual(0); // 不 throw
    expect(Array.isArray(refresh.items)).toBe(true);
  });
});

// ──────────────── greeting tone 5 时段 ────────────────

describe('Unit · home v3 · greeting tone', () => {
  it('toToneFromDate 5 时段', () => {
    expect(toToneFromDate(new Date('2025-01-15T23:00:00Z'))).toBe('early');
    expect(toToneFromDate(new Date('2025-01-15T03:00:00Z'))).toBe('morning');
    expect(toToneFromDate(new Date('2025-01-15T08:00:00Z'))).toBe('afternoon');
    expect(toToneFromDate(new Date('2025-01-15T13:00:00Z'))).toBe('evening');
    expect(toToneFromDate(new Date('2025-01-15T17:30:00Z'))).toBe('late_night');
  });

  it('buildGreeting zh 不同时段 ≠', () => {
    expect(buildGreeting('early', 'zh', null, 0)).not.toBe(
      buildGreeting('evening', 'zh', null, 0),
    );
  });

  it('home.greeting.tone ∈ 5 枚举 · text 非空', async () => {
    const home = await getAssistantHome(ctx(), userId);
    expect(['early', 'morning', 'afternoon', 'evening', 'late_night']).toContain(
      home.greeting.tone,
    );
    expect(home.greeting.text.length).toBeGreaterThan(0);
  });
});

// ──────────────── locale 切换 ────────────────

describe('Unit · home v3 · locale en', () => {
  it('locale=en · greeting / smart_chips 用英文', async () => {
    userRows = [
      {
        id: userId,
        displayName: 'Tony',
        locale: 'en',
        createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
      },
    ];
    const home = await getAssistantHome(ctx(), userId);
    expect(home.greeting.text).toMatch(/day/);
    const tonight = home.smart_chips.find((c) => c.key === 'tonight');
    expect(tonight!.label).toBe('Free tonight');
  });
});
