/**
 * 单元测试 · 助理 Home 仪表盘
 *
 * 覆盖:
 *   - 新用户 → onboarding_required=true · 卡片/历史为空
 *   - 老用户 → today_cards 含 recall/available/new_match
 *   - 时段切换 → greeting tone 变化(buildGreeting 5 时段)
 *   - quick_acts 默认 6 个 chip · 中英文切换
 *   - history 取最近 3 条
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getAssistantHome, type HomeContext } from '../../src/services/assistant/home';
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
  locale: string | null;
}

interface RefRow {
  id: string;
  userId: string;
  memoryType: 'rotating' | 'relation' | 'diff';
  refTherapistId: string | null;
  archivedAt: Date | null;
  recordedAt: Date;
  content: string;
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

let savedRows: SavedRow[] = [];
let userRows: UserRow[] = [];
let refRows: RefRow[] = [];
let therapistRows: TherapistRow[] = [];
let sessionRows: SessionRow[] = [];

// 计数器:辨别 findMany 是 pickAvailable(第一次 · 要在线) 还是 pickNewMatch(第二次 · 要本周)
let therapistFindManyCallIdx = 0;

function makeFakeDb(): HomeContext['db'] {
  const findManyHistory = async (opts: { where?: { _user?: string }; limit?: number }) => {
    const uid = opts?.where?._user;
    return sessionRows
      .filter((s) => s.userId === uid)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, opts?.limit ?? 100);
  };

  const findManyRefs = async (opts: { where?: { _and?: unknown[] }; limit?: number }) => {
    // 简化:返回所有 ref rows · 由调用方过滤 user_id
    void opts;
    return refRows
      .filter((r) => r.memoryType === 'relation' && !r.archivedAt && r.refTherapistId)
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
      .slice(0, opts?.limit ?? 100);
  };

  const findManyTherapists = async (opts: { where?: unknown; limit?: number }) => {
    therapistFindManyCallIdx += 1;
    const callNo = therapistFindManyCallIdx;
    void opts;
    // 第 1 次调用 = pickAvailableCard → 必须在线
    // 第 2 次调用 = pickNewMatchCard → 必须本周入驻
    let rows = therapistRows.filter(
      (t) => t.verificationStatus === 'passed' && t.coolingStatus !== 'cold',
    );
    if (callNo === 1) {
      rows = rows.filter((t) => t.onlineStatus === 'online');
    } else if (callNo === 2) {
      const sevenAgo = Date.now() - 7 * 24 * 3600 * 1000;
      rows = rows.filter((t) => t.createdAt.getTime() >= sevenAgo);
    }
    return rows.slice(0, opts?.limit ?? 100);
  };

  const findFirstTherapist = async (opts: { where?: unknown }) => {
    void opts;
    return therapistRows.find((t) => t.verificationStatus === 'passed' && t.coolingStatus !== 'cold') ?? null;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    query: {
      users: {
        findFirst: async (opts: { where: { _user?: string } }) => {
          const wantedId = (opts.where as { _user?: string })._user;
          return userRows.find((u) => u.id === wantedId) ?? null;
        },
      },
      customerSavedMemory: {
        findFirst: async (opts: { where: { _user?: string } }) => {
          const wantedId = (opts.where as { _user?: string })._user;
          return savedRows.find((s) => s.userId === wantedId) ?? null;
        },
      },
      customerReferenceMemory: { findMany: findManyRefs },
      customerInterestClusters: { findMany: async () => [] },
      customerAssistantSessions: { findMany: findManyHistory },
      therapists: { findMany: findManyTherapists, findFirst: findFirstTherapist },
      blockList: { findMany: async () => [] },
      customerMasterPreferences: { findFirst: async () => null },
      customerBehaviorProfile: { findFirst: async () => null },
      customerRelationshipProfile: { findMany: async () => [] },
    },
    insert: () => ({
      values: (val: Record<string, unknown>) => ({
        returning: async () => {
          const row: SavedRow = {
            userId: val.userId as string,
            facts: (val.facts as Record<string, unknown>) ?? {},
            stablePrefs: (val.stablePrefs as Record<string, unknown>) ?? {},
            shameSafePrefs: (val.shameSafePrefs as Record<string, unknown>) ?? {},
            tabooZones: (val.tabooZones as string[]) ?? [],
            exportedAt: null,
            deletionScheduledAt: null,
            updatedAt: new Date(),
            createdAt: new Date(),
          };
          savedRows.push(row);
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

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('drizzle-orm');
  return {
    ...actual,
    eq: (col: { name?: string } | unknown, val: unknown) => ({ _user: String(val), _col: col }),
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
  userRows = [{ id: userId, locale: 'zh' }];
  refRows = [];
  therapistRows = [];
  sessionRows = [];
  therapistFindManyCallIdx = 0;
});

describe('Unit · home · 新用户路径', () => {
  it('新用户 → onboarding_required=true', async () => {
    const home = await getAssistantHome(ctx(), userId);
    expect(home.onboarding_required).toBe(true);
  });

  it('新用户 → today_cards 为空 · history 为空', async () => {
    const home = await getAssistantHome(ctx(), userId);
    expect(home.today_cards).toEqual([]);
    expect(home.history).toEqual([]);
  });

  it('新用户 → quick_acts 有 6 个 · 含必备 keys', async () => {
    const home = await getAssistantHome(ctx(), userId);
    expect(home.quick_acts.length).toBe(6);
    const keys = home.quick_acts.map((q) => q.key);
    expect(keys).toContain('by_height');
    expect(keys).toContain('by_style');
    expect(keys).toContain('tonight');
    expect(keys).toContain('new_to_city');
  });
});

describe('Unit · home · 老用户路径', () => {
  beforeEach(() => {
    // 完成 onboarding 的 saved
    savedRows.push({
      userId,
      facts: { city: '曼谷', language: 'zh', onboarding_complete: true } as Record<string, unknown>,
      stablePrefs: { priorities: ['温柔', '专业'] } as Record<string, unknown>,
      shameSafePrefs: {},
      tabooZones: [],
      exportedAt: null,
      deletionScheduledAt: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    });
  });

  it('完成 onboarding → onboarding_required=false', async () => {
    const home = await getAssistantHome(ctx(), userId);
    expect(home.onboarding_required).toBe(false);
  });

  it('有 L4 relation + 在线技师 → recall 卡', async () => {
    const therapistId = 'tttttttt-1111-1111-1111-111111111111';
    therapistRows.push({
      id: therapistId,
      userId: 'uuuuuuuu-1111-1111-1111-111111111111',
      bio: 'Lily 温柔细致',
      avatarUrl: 'https://x/1',
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
    refRows.push({
      id: 'ref_1',
      userId,
      memoryType: 'relation',
      refTherapistId: therapistId,
      archivedAt: null,
      recordedAt: new Date(),
      content: '昨晚看了 Lily 3 次',
    });
    const home = await getAssistantHome(ctx(), userId);
    const recall = home.today_cards.find((c) => c.type === 'recall');
    expect(recall).toBeDefined();
    expect(recall!.action_href).toContain(therapistId);
  });

  it('稳定偏好 + 在线技师匹配 tag → available 卡', async () => {
    therapistRows.push({
      id: 'tttttttt-2222-2222-2222-222222222222',
      userId: 'uuuuuuuu-2222-2222-2222-222222222222',
      bio: 'Anna 专业',
      avatarUrl: null,
      serviceCity: '曼谷',
      verificationStatus: 'passed',
      coolingStatus: 'active',
      onlineStatus: 'online',
      lastOnlineAt: new Date(),
      createdAt: new Date(Date.now() - 60 * 24 * 3600 * 1000),
      rating: 420,
      scoreService: 850,
      tags: ['温柔', '专业'],
    });
    const home = await getAssistantHome(ctx(), userId);
    const available = home.today_cards.find((c) => c.type === 'available');
    expect(available).toBeDefined();
  });

  it('本周新到技师 + 稳定偏好命中 → new_match 卡', async () => {
    therapistRows.push({
      id: 'tttttttt-3333-3333-3333-333333333333',
      userId: 'uuuuuuuu-3333-3333-3333-333333333333',
      bio: '新到 · 温柔',
      avatarUrl: null,
      serviceCity: '曼谷',
      verificationStatus: 'passed',
      coolingStatus: 'active',
      onlineStatus: 'offline',
      lastOnlineAt: new Date(),
      createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000), // 2 天前入驻
      rating: 400,
      scoreService: 800,
      tags: ['温柔'],
    });
    const home = await getAssistantHome(ctx(), userId);
    const newMatch = home.today_cards.find((c) => c.type === 'new_match');
    expect(newMatch).toBeDefined();
  });

  it('today_cards 最多 3 张', async () => {
    // 塞多个 therapists 各类型都能命中
    for (let i = 0; i < 5; i++) {
      therapistRows.push({
        id: `tttttttt-aaaa-aaaa-aaaa-${String(i).padStart(12, '0')}`,
        userId: `uuuuuuuu-aaaa-aaaa-aaaa-${String(i).padStart(12, '0')}`,
        bio: `技师 ${i}`,
        avatarUrl: null,
        serviceCity: '曼谷',
        verificationStatus: 'passed',
        coolingStatus: 'active',
        onlineStatus: 'online',
        lastOnlineAt: new Date(),
        createdAt: new Date(Date.now() - 1 * 24 * 3600 * 1000),
        rating: 400 + i,
        scoreService: 800 + i,
        tags: ['温柔', '专业'],
      });
    }
    const home = await getAssistantHome(ctx(), userId);
    expect(home.today_cards.length).toBeLessThanOrEqual(3);
  });

  it('history 取最近 3 条 + 按 updated_at 倒序', async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      sessionRows.push({
        id: `sess_${i}`,
        userId,
        preview: `对话 ${i}`,
        turnsCount: 3,
        updatedAt: new Date(now - i * 3600 * 1000),
        createdAt: new Date(now - i * 3600 * 1000),
      });
    }
    const home = await getAssistantHome(ctx(), userId);
    expect(home.history.length).toBe(3);
    expect(home.history[0]!.preview).toBe('对话 0');
    expect(home.history[2]!.preview).toBe('对话 2');
  });
});

describe('Unit · home · greeting 5 时段', () => {
  it('toToneFromDate · 06:00 SGT → early', () => {
    // 06:00 SGT = 23:00 prev UTC + 7 = 23 UTC → but we add tz offset to ts then read getUTCHours
    // 构造一个时间使得加 7h 后 hour=6
    // hour=6 → original UTC hour = 6 - 7 = -1 → 23 prev day
    const d = new Date('2025-01-15T23:00:00Z');
    expect(toToneFromDate(d)).toBe('early');
  });

  it('toToneFromDate · 10:00 SGT → morning', () => {
    const d = new Date('2025-01-15T03:00:00Z');
    expect(toToneFromDate(d)).toBe('morning');
  });

  it('toToneFromDate · 15:00 SGT → afternoon', () => {
    const d = new Date('2025-01-15T08:00:00Z');
    expect(toToneFromDate(d)).toBe('afternoon');
  });

  it('toToneFromDate · 20:00 SGT → evening', () => {
    const d = new Date('2025-01-15T13:00:00Z');
    expect(toToneFromDate(d)).toBe('evening');
  });

  it('toToneFromDate · 00:30 SGT → late_night', () => {
    const d = new Date('2025-01-15T17:30:00Z');
    expect(toToneFromDate(d)).toBe('late_night');
  });

  it('buildGreeting · zh 不同时段返回不同台词', () => {
    const earlyText = buildGreeting('early', 'zh', null, 0);
    const eveningText = buildGreeting('evening', 'zh', null, 0);
    expect(earlyText).not.toBe(eveningText);
  });

  it('buildGreeting · en 含 "bro" / 时段关键词', () => {
    const eveningText = buildGreeting('evening', 'en', null, 0);
    expect(/bro|evening|tonight/i.test(eveningText)).toBe(true);
  });

  it('buildGreeting · zh + 籍贯=thailand → 含曼谷个性化', () => {
    const text = buildGreeting('morning', 'zh', 'thailand', 0);
    expect(text).toContain('曼谷');
  });

  it('home greeting 包含 tone 字段且属于 5 个枚举之一', async () => {
    const home = await getAssistantHome(ctx(), userId);
    expect(['early', 'morning', 'afternoon', 'evening', 'late_night']).toContain(home.greeting.tone);
    expect(home.greeting.text.length).toBeGreaterThan(0);
  });
});

describe('Unit · home · 中英 locale 切换', () => {
  it('locale=en · quick_acts 用英文 label', async () => {
    userRows = [{ id: userId, locale: 'en' }];
    const home = await getAssistantHome(ctx(), userId);
    const byHeight = home.quick_acts.find((q) => q.key === 'by_height');
    expect(byHeight!.label).toBe('By height');
  });

  it('locale=zh · quick_acts 用中文 label', async () => {
    const home = await getAssistantHome(ctx(), userId);
    const byHeight = home.quick_acts.find((q) => q.key === 'by_height');
    expect(byHeight!.label).toBe('按身高');
  });
});
