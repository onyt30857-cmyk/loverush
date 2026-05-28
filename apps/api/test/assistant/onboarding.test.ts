/**
 * 单元测试 · 6 步首见对话 onboarding 状态机
 *
 * 覆盖:
 *   - 6 步完整流程(step 1 → 6)
 *   - 任意步骤 skipped=true → 跳到 step 6 + facts 默认值兜底
 *   - 连续 2 步空 payload → 跳 step 6 + 自嘲开场
 *   - 步 6 后 customer_saved_memory.facts.onboarding_complete = true
 *   - swipe payload 解析(从 card tags 抽 gender/age/style)
 *   - 中英 locale 切换
 *
 * 不依赖真实 PG。用 in-memory 模拟 customer_saved_memory + therapists + users + relations。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  onboardingStep,
  isOnboardingComplete,
  resetOnboarding,
  type OnboardingContext,
} from '../../src/services/assistant/onboarding';
import type { LLMGateway } from '@loverush/llm';

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
  content: string;
  entities: string[];
  importance: number;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  refTherapistId: string | null;
  refOrderId: string | null;
  archivedAt: Date | null;
  endpoint: string;
  clusterId: number | null;
}

interface ClusterRow {
  id: string;
  userId: string;
  clusterIdx: number;
  label: string | null;
  weight: number;
  topEntities: string[];
  sampleSize: number;
}

let savedRows: SavedRow[] = [];
let userRows: UserRow[] = [];
let refRows: RefRow[] = [];
let clusterRows: ClusterRow[] = [];

function makeFakeDb(): OnboardingContext['db'] {
  // 极简 drizzle mock · 仅覆盖 onboarding / readSaved / upsertSaved 路径
  const noopFindMany = async () => [];
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
      customerReferenceMemory: { findMany: noopFindMany },
      customerInterestClusters: {
        findMany: async (opts: { where?: { _user?: string } }) => {
          const wantedId = opts?.where?._user;
          return clusterRows.filter((c) => c.userId === wantedId);
        },
      },
      customerAssistantSessions: { findMany: noopFindMany },
      blockList: { findMany: noopFindMany },
      customerMasterPreferences: { findFirst: async () => null },
      customerBehaviorProfile: { findFirst: async () => null },
      customerRelationshipProfile: { findMany: noopFindMany },
      therapists: {
        findMany: noopFindMany,
        findFirst: async () => null,
      },
    },
    insert: () => ({
      values: (val: Record<string, unknown>) => ({
        returning: async () => {
          // 仅 saved memory 走这条路径
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
      set: (patch: Record<string, unknown>) => {
        const apply = () => {
          for (const s of savedRows) {
            if (patch.facts) s.facts = patch.facts as Record<string, unknown>;
            if (patch.stablePrefs)
              s.stablePrefs = { ...s.stablePrefs, ...(patch.stablePrefs as Record<string, unknown>) };
            if (patch.shameSafePrefs)
              s.shameSafePrefs = {
                ...s.shameSafePrefs,
                ...(patch.shameSafePrefs as Record<string, unknown>),
              };
            s.updatedAt = new Date();
          }
        };
        const whereResult: PromiseLike<unknown> & {
          returning: () => Promise<SavedRow[]>;
        } = Object.assign(
          {
            then: (
              onfulfilled?: ((value: unknown) => unknown) | null | undefined,
              onrejected?: ((reason: unknown) => unknown) | null | undefined,
            ) => {
              try {
                apply();
                return Promise.resolve(savedRows).then(onfulfilled, onrejected);
              } catch (e) {
                return Promise.reject(e).then(onfulfilled, onrejected);
              }
            },
          } as PromiseLike<unknown>,
          {
            returning: async () => {
              apply();
              return savedRows;
            },
          },
        );
        return {
          where: () => whereResult,
        };
      },
    }),
  };

  // 因为 drizzle 的 eq() 返回 SQL object,这里用 hack 让 findFirst 能拿到 user_id
  // 通过 monkey-patch drizzle eq · 这里取巧:直接给 _user 字段传值
  return db as OnboardingContext['db'];
}

// 由于真实 readSaved 用 drizzle eq(),我们 mock 一下让 _user 字段流过
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

// LLM gateway mock(onboarding step 6 会调 recommender · 我们 stub 一下)
function makeFakeGateway(): LLMGateway {
  return {
    complete: async () => ({
      content: '风格对路 · 时段稳 · 评分没翻车',
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      providerUsed: 'anthropic',
      modelUsed: 'haiku',
      latencyMs: 1,
    }),
  } as unknown as LLMGateway;
}

const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function ctx(): OnboardingContext {
  return { db: makeFakeDb() };
}

beforeEach(() => {
  savedRows = [];
  refRows = [];
  clusterRows = [];
  userRows = [{ id: userId, locale: 'zh' }];
});

describe('Unit · onboarding · 6 步完整流程', () => {
  it('step 1 → 2:city 抓取 + 个性化兑现', async () => {
    const r = await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 1,
      payload: { city: '曼谷' },
    });
    expect(r.next_step).toBe(2);
    expect(r.ai_reply).toContain('曼谷');
    expect(r.visible_options).toBeDefined();
    expect(r.visible_options!.length).toBeGreaterThanOrEqual(3);
  });

  it('step 2 → 3:intent 抓取 + 即将展示风格图', async () => {
    // 先走 step 1
    await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 1,
      payload: { city: '曼谷' },
    });
    const r = await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 2,
      payload: { intent: 'deep_tissue' },
    });
    expect(r.next_step).toBe(3);
    expect(r.visible_swipe_cards).toBeDefined();
    expect(r.visible_swipe_cards!.length).toBe(6);
    // 每张图都带 gender/age/style 三个 tag
    for (const card of r.visible_swipe_cards!) {
      expect(card.tags.some((t) => t.startsWith('gender:'))).toBe(true);
      expect(card.tags.some((t) => t.startsWith('age:'))).toBe(true);
      expect(card.tags.some((t) => t.startsWith('style:'))).toBe(true);
    }
  });

  it('step 3 swipe 解析 · liked card 的 tags 抽出 gender/age/style', async () => {
    await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 1,
      payload: { city: '曼谷' },
    });
    await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 2,
      payload: { intent: 'deep_tissue' },
    });
    // liked 2 张图
    const r = await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 3,
      payload: { liked: ['style_pro_mid_f', 'style_mature_f'], skipped: false },
    });
    expect(r.next_step).toBe(4);
    expect(r.visible_options).toBeDefined();

    // 检查 facts 写入 saved memory
    const saved = savedRows[0];
    expect(saved).toBeDefined();
    const progress = (saved!.facts as { onboarding_progress?: Record<string, unknown> })
      .onboarding_progress;
    expect(progress).toBeDefined();
    const styles = progress!.style_pref as string[];
    expect(styles).toContain('专业');
    expect(progress!.gender_pref).toBe('female');
  });

  it('step 4 → 5:time + language 抓取', async () => {
    for (const s of [
      { step: 1 as const, payload: { city: '曼谷' } },
      { step: 2 as const, payload: { intent: 'relax' } },
      { step: 3 as const, payload: { liked: ['style_tender_young_f'] } },
    ]) {
      await onboardingStep(ctx(), makeFakeGateway(), userId, s);
    }
    const r = await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 4,
      payload: { time_slot: '20:00', language: 'zh' },
    });
    expect(r.next_step).toBe(5);
  });

  it('step 5 → 6:price + privacy + 出推荐(空候选时 picks=0 但 reply 仍生成)', async () => {
    for (const s of [
      { step: 1 as const, payload: { city: '曼谷' } },
      { step: 2 as const, payload: { intent: 'relax' } },
      { step: 3 as const, payload: { liked: ['style_tender_young_f'] } },
      { step: 4 as const, payload: { time_slot: '20:00', language: 'zh' } },
    ]) {
      await onboardingStep(ctx(), makeFakeGateway(), userId, s);
    }
    const r = await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 5,
      payload: { price_range: 'mid', privacy_mode: 'codename' },
    });
    expect(r.next_step).toBe(6);
    expect(r.first_recommendation).toBeDefined();
    // 测试库无技师 · 数组为空
    expect(r.first_recommendation!.length).toBe(0);
    expect(r.ai_reply.length).toBeGreaterThan(5);
  });

  it('step 6 → done:onboarding_complete=true 写入 saved memory', async () => {
    for (const s of [
      { step: 1 as const, payload: { city: '曼谷' } },
      { step: 2 as const, payload: { intent: 'relax' } },
      { step: 3 as const, payload: { liked: ['style_tender_young_f'] } },
      { step: 4 as const, payload: { time_slot: '20:00', language: 'zh' } },
      { step: 5 as const, payload: { price_range: 'mid', privacy_mode: 'codename' } },
    ]) {
      await onboardingStep(ctx(), makeFakeGateway(), userId, s);
    }
    const r = await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 6,
      payload: { engaged: true },
    });
    expect(r.next_step).toBe('done');

    // 完成判定 · isOnboardingComplete → true
    const complete = await isOnboardingComplete(ctx(), userId);
    expect(complete).toBe(true);
  });
});

describe('Unit · onboarding · 异常处理 F03-OB2', () => {
  it('任意步 skipped=true → 直接跳到 step 6 · 用默认值兜底', async () => {
    // 步 1 就 skip
    const r = await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 1,
      payload: { skipped: true },
    });
    expect(r.next_step).toBe(6);
    expect(r.first_recommendation).toBeDefined();
    // saved 应有 facts.onboarding_progress 且填了默认 style_pref
    const saved = savedRows[0]!;
    const progress = (saved.facts as { onboarding_progress?: Record<string, unknown> })
      .onboarding_progress;
    expect(progress).toBeDefined();
    expect(progress!.style_pref).toBeDefined();
  });

  it('单步空 payload → 留在原步等待 · 不跳', async () => {
    const r = await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 1,
      payload: {},
    });
    expect(r.next_step).toBe(1);
  });

  it('连续 2 步空 payload → 跳到 step 6 + 自嘲开场', async () => {
    await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 1,
      payload: {},
    });
    const r = await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 1,
      payload: {},
    });
    expect(r.next_step).toBe(6);
    // 自嘲开场关键词:"话多了" 或 "Talked too much"
    expect(r.ai_reply.includes('话多了') || r.ai_reply.toLowerCase().includes('talked too much'))
      .toBe(true);
  });

  it('skipped 比空 payload 优先 · 不计入 emptyStreak', async () => {
    await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 1,
      payload: { skipped: true },
    });
    // 应该已经在 step 6 · 走默认值
    const complete = await isOnboardingComplete(ctx(), userId);
    // step 6 willShowStep6 触发 complete
    expect(complete).toBe(true);
  });
});

describe('Unit · onboarding · 中英 locale 切换', () => {
  it('locale=en · step 1 用英文台词', async () => {
    const r = await onboardingStep(
      ctx(),
      makeFakeGateway(),
      userId,
      { step: 1, payload: { city: '曼谷' } },
      'en',
    );
    expect(r.ai_reply).toMatch(/Hey bro|got it|Bangkok/i);
  });

  it('locale=zh · step 1 用中文台词', async () => {
    const r = await onboardingStep(
      ctx(),
      makeFakeGateway(),
      userId,
      { step: 1, payload: { city: '曼谷' } },
      'zh',
    );
    expect(r.ai_reply).toMatch(/嘿|曼谷|懂了/);
  });
});

describe('Unit · onboarding · 工具函数', () => {
  it('resetOnboarding · 清空 progress', async () => {
    // 走一步先有数据
    await onboardingStep(ctx(), makeFakeGateway(), userId, {
      step: 1,
      payload: { city: '曼谷' },
    });
    expect(savedRows[0]).toBeDefined();
    await resetOnboarding(ctx(), userId);
    const progress = (savedRows[0]!.facts as { onboarding_progress?: unknown }).onboarding_progress;
    expect(progress).toBeUndefined();
    expect(
      (savedRows[0]!.facts as { onboarding_complete?: boolean }).onboarding_complete,
    ).toBe(false);
  });

  it('isOnboardingComplete · 新用户返回 false', async () => {
    const complete = await isOnboardingComplete(ctx(), userId);
    expect(complete).toBe(false);
  });
});
