/**
 * M18 撩拨发图 · Phase 3 · 技师素材库自助 CRUD e2e
 *
 * 主干：注册 therapist → POST 增（tier paid）→ GET 列（含它）→
 *   PATCH（is_active 0, weight 5）→ DELETE → GET 列（不含它）
 *
 * 跑：
 *   cd apps/api
 *   DATABASE_URL=...loverush_test pnpm exec vitest run test/chat-media-crud.e2e.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { api, call, registerNew, truncateAll } from './helpers';

interface MediaRow {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  tier: string;
  pricePoints: number;
  intimacyMin: number;
  weight: number;
  isActive: number;
}

describe('M18 撩拨发图 · 技师素材库 CRUD /chat-media/me', () => {
  let token: string;
  let mediaId: string;

  beforeAll(async () => {
    await truncateAll();
    const therapist = await registerNew('therapist');
    token = therapist.access_token;
  });

  it('POST /me 新增一张 paid 私密图', async () => {
    const res = await api.post<{ id: string }>(
      '/chat-media/me',
      {
        url: 'https://cdn.test/paid-1.jpg',
        thumbnail_url: 'https://cdn.test/paid-1-thumb.jpg',
        tier: 'paid',
        price_points: 50,
        intimacy_min: 2,
        weight: 3,
      },
      token,
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.id).toBeTruthy();
    mediaId = res.body.data!.id;
  });

  it('GET /me 列出含刚增的那张', async () => {
    const res = await api.get<MediaRow[]>('/chat-media/me', token);
    expect(res.status).toBe(200);
    const found = res.body.data?.find((m) => m.id === mediaId);
    expect(found).toBeTruthy();
    expect(found!.tier).toBe('paid');
    expect(found!.pricePoints).toBe(50);
    expect(found!.intimacyMin).toBe(2);
    expect(found!.weight).toBe(3);
    expect(found!.isActive).toBe(1);
  });

  it('PATCH /me/:id 停用并改权重', async () => {
    const res = await call<{ id: string }>('PATCH', `/chat-media/me/${mediaId}`, {
      token,
      body: { is_active: 0, weight: 5 },
    });
    expect(res.status).toBe(200);
  });

  it('PATCH 后 GET 反映停用 + 新权重', async () => {
    const res = await api.get<MediaRow[]>('/chat-media/me', token);
    const found = res.body.data?.find((m) => m.id === mediaId);
    expect(found).toBeTruthy();
    expect(found!.isActive).toBe(0);
    expect(found!.weight).toBe(5);
  });

  it('DELETE /me/:id 删除', async () => {
    const res = await api.delete<{ ok: boolean }>(`/chat-media/me/${mediaId}`, undefined, token);
    expect(res.status).toBe(200);
    expect(res.body.data?.ok).toBe(true);
  });

  it('GET /me 删除后不再含它', async () => {
    const res = await api.get<MediaRow[]>('/chat-media/me', token);
    const found = res.body.data?.find((m) => m.id === mediaId);
    expect(found).toBeUndefined();
  });
});
