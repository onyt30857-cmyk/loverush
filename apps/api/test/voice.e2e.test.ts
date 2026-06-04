/**
 * M18 声音复刻端点 e2e · 技师自助通路(本地无语音 key → 优雅降级,不 500)
 */
import { describe, it, expect } from 'vitest';
import { api, registerNew } from './helpers';

describe('M18 声音复刻 · 技师端点', () => {
  it('GET /voice/me 返回复刻状态(不 500)', async () => {
    const t = await registerNew('therapist');
    const r = await api.get<{ engine: string; hasSample: boolean; cloned: boolean; label: string }>(
      '/voice/me',
      t.access_token,
    );
    expect(r.status).toBe(200);
    expect(['elevenlabs', 'openai', 'none']).toContain(r.body.data?.engine);
    expect(typeof r.body.data?.label).toBe('string');
  });

  it('POST /voice/me/preview 本地无 key → 400 优雅(非 500)', async () => {
    const t = await registerNew('therapist');
    const r = await api.post('/voice/me/preview', undefined, t.access_token);
    // 本地无 ELEVENLABS/OPENAI key → 合成 null → 400(可控错误,绝非 500)
    expect(r.status).toBe(400);
  });
});
