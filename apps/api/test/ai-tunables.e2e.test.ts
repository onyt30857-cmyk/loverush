/**
 * E2E · AI 分身可调参数（aiTunables）
 *
 * 跑：
 *   PASS=$(grep '^DATABASE_URL=' .env | sed -E 's#.*loverush:([^@]*)@localhost.*#\1#')
 *   export JWT_SECRET=$(grep '^JWT_SECRET=' .env | cut -d= -f2-)
 *   export DATABASE_URL="postgresql://loverush:$PASS@localhost:54399/loverush_test"
 *   cd apps/api && ./node_modules/.bin/vitest run test/ai-tunables.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { userRoles, roles } from '@loverush/db';
import { api, getDb, registerNew, truncateAll } from './helpers';
import { loadAiTunables, clearAiTunablesCache, AI_TUNABLES, AI_TUNABLES_DEFAULTS } from '../src/services/aiTunables';

let adminToken: string;
let adminId: string;

beforeAll(async () => {
  await truncateAll();
  const db = await getDb();

  const a = await registerNew('customer');
  adminToken = a.access_token;
  adminId = a.user.id;
  await db.insert(userRoles).values({ userId: adminId, role: 'admin' });

  // 系统角色种子（测试库无 seed）
  await db.insert(roles).values([
    { key: 'admin', nameZh: '超级管理员', isSystem: true },
    { key: 'ops',   nameZh: '运营',       isSystem: true },
    { key: 'cs',    nameZh: '客服',       isSystem: true },
  ]).onConflictDoNothing();

  // 每次测试前清缓存，确保从 DB 重新读
  clearAiTunablesCache();
});

// ─── 1. GET 返回 8 项，全部 current=default ─────────────────────────────────

describe('1. GET /admin/ai-system/tunables 返回 8 个参数，初始 current=default', () => {
  it('返回 200 + items 数组', async () => {
    const r = await api.get<{ items: unknown[] }>('/admin/ai-system/tunables', adminToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data?.items)).toBe(true);
    expect(r.body.data!.items.length).toBe(8);
  });

  it('所有 item 结构正确且初始 isOverridden=false', async () => {
    const r = await api.get<{ items: Array<{
      key: string; label: string; group: string;
      default: number; min: number; max: number; step: number; unit: string; isFloat: boolean;
      current: number; isOverridden: boolean;
    }> }>('/admin/ai-system/tunables', adminToken);
    expect(r.status).toBe(200);
    for (const item of r.body.data!.items) {
      expect(typeof item.key).toBe('string');
      expect(typeof item.label).toBe('string');
      expect(typeof item.group).toBe('string');
      expect(typeof item.default).toBe('number');
      expect(typeof item.current).toBe('number');
      expect(typeof item.isOverridden).toBe('boolean');
      // 初始状态 current 必须等于 default
      expect(item.current).toBe(item.default);
      expect(item.isOverridden).toBe(false);
    }
  });

  it('8 个 key 全部在 catalog 中', async () => {
    const r = await api.get<{ items: Array<{ key: string }> }>('/admin/ai-system/tunables', adminToken);
    const catalogKeys = AI_TUNABLES.map((d) => d.key);
    for (const item of r.body.data!.items) {
      expect(catalogKeys).toContain(item.key);
    }
  });
});

// ─── 2. POST 改 temperature=0.8 → loadAiTunables 返回 0.8，GET current=0.8 ──

describe('2. POST 覆盖 temperature=0.8', () => {
  it('POST 返回 200 + {key, value}', async () => {
    clearAiTunablesCache();
    const r = await api.post('/admin/ai-system/tunables', { key: 'temperature', value: 0.8 }, adminToken);
    expect(r.status).toBe(200);
    expect((r.body.data as { key: string; value: number }).key).toBe('temperature');
    expect((r.body.data as { key: string; value: number }).value).toBe(0.8);
  });

  it('loadAiTunables 从 DB 读到 temperature=0.8', async () => {
    clearAiTunablesCache();
    const db = await getDb();
    const vals = await loadAiTunables(db);
    expect(vals['temperature']).toBe(0.8);
  });

  it('GET current=0.8, isOverridden=true', async () => {
    clearAiTunablesCache();
    const r = await api.get<{ items: Array<{ key: string; current: number; isOverridden: boolean }> }>(
      '/admin/ai-system/tunables',
      adminToken,
    );
    expect(r.status).toBe(200);
    const item = r.body.data!.items.find((i) => i.key === 'temperature');
    expect(item).toBeDefined();
    expect(item!.current).toBe(0.8);
    expect(item!.isOverridden).toBe(true);
  });

  it('其他参数 isOverridden 仍为 false', async () => {
    const r = await api.get<{ items: Array<{ key: string; isOverridden: boolean }> }>(
      '/admin/ai-system/tunables',
      adminToken,
    );
    for (const item of r.body.data!.items) {
      if (item.key !== 'temperature') {
        expect(item.isOverridden).toBe(false);
      }
    }
  });
});

// ─── 3. 范围外 temperature=2 → 400 ─────────────────────────────────────────

describe('3. 范围外校验 → 400', () => {
  it('temperature=2 → 400', async () => {
    const r = await api.post('/admin/ai-system/tunables', { key: 'temperature', value: 2 }, adminToken);
    expect(r.status).toBe(400);
  });

  it('temperature=-1 → 400', async () => {
    const r = await api.post('/admin/ai-system/tunables', { key: 'temperature', value: -1 }, adminToken);
    expect(r.status).toBe(400);
  });

  it('未知 key → 400', async () => {
    const r = await api.post('/admin/ai-system/tunables', { key: 'nonexistentParam', value: 5 }, adminToken);
    expect(r.status).toBe(400);
  });

  it('value 非数字 → 400', async () => {
    const r = await api.post('/admin/ai-system/tunables', { key: 'temperature', value: 'hot' }, adminToken);
    expect(r.status).toBe(400);
  });

  it('缺少 key → 400', async () => {
    const r = await api.post('/admin/ai-system/tunables', { value: 0.5 }, adminToken);
    expect(r.status).toBe(400);
  });
});

// ─── 4. DELETE → 回退 default ──────────────────────────────────────────────

describe('4. DELETE /admin/ai-system/tunables/temperature → 回退 default', () => {
  it('DELETE 返回 200', async () => {
    const r = await api.delete('/admin/ai-system/tunables/temperature', undefined, adminToken);
    expect(r.status).toBe(200);
    const data = r.body.data as { key: string; current: number; isOverridden: boolean };
    expect(data.key).toBe('temperature');
    expect(data.isOverridden).toBe(false);
  });

  it('loadAiTunables 回退到 default', async () => {
    clearAiTunablesCache();
    const db = await getDb();
    const vals = await loadAiTunables(db);
    const tempDef = AI_TUNABLES.find((d) => d.key === 'temperature')!.default;
    expect(vals['temperature']).toBe(tempDef);
  });

  it('GET current 回到 default, isOverridden=false', async () => {
    clearAiTunablesCache();
    const r = await api.get<{ items: Array<{ key: string; current: number; isOverridden: boolean; default: number }> }>(
      '/admin/ai-system/tunables',
      adminToken,
    );
    const item = r.body.data!.items.find((i) => i.key === 'temperature');
    expect(item!.current).toBe(item!.default ?? AI_TUNABLES_DEFAULTS['temperature']);
    expect(item!.isOverridden).toBe(false);
  });
});

// ─── 5. 权限校验 ────────────────────────────────────────────────────────────

describe('5. 权限校验', () => {
  it('未登录 GET → 401', async () => {
    const r = await api.get('/admin/ai-system/tunables');
    expect(r.status).toBe(401);
  });

  it('未登录 POST → 401', async () => {
    const r = await api.post('/admin/ai-system/tunables', { key: 'temperature', value: 0.7 });
    expect(r.status).toBe(401);
  });
});

// ─── 6. loadAiTunables 基础单元 ─────────────────────────────────────────────

describe('6. loadAiTunables 基础行为', () => {
  it('无覆盖时全部返回 default', async () => {
    clearAiTunablesCache();
    const db = await getDb();
    const vals = await loadAiTunables(db);
    for (const def of AI_TUNABLES) {
      expect(vals[def.key]).toBe(def.default);
    }
  });

  it('返回值包含全部 8 个 key', async () => {
    clearAiTunablesCache();
    const db = await getDb();
    const vals = await loadAiTunables(db);
    for (const def of AI_TUNABLES) {
      expect(def.key in vals).toBe(true);
    }
  });
});
