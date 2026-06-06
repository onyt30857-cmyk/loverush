/**
 * M18 声音复刻 · 技师自助
 *
 * GET  /voice/me            我的声音复刻状态(引擎/是否已克隆/样本)
 * POST /voice/me/clone      确认提交 → 真实合成(克隆出本人 voice_id)
 * POST /voice/me/preview    用我的声音合成一句试听(仅真克隆,没合成好明确报错)
 */
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { getVoiceCloneStatus, synthesizeWhisper, cloneVoice } from '../services/voice';

const PREVIEW_TEXT = '来，我凑你耳边说……今晚别熬了，早点睡，我陪着你。';

export const voiceRoutes = new Hono();
voiceRoutes.use('*', requireAuth);

voiceRoutes.get('/me', async (c) => {
  const userId = c.get('userId');
  const status = await getVoiceCloneStatus({ db: getDb() }, userId);
  return c.json({ data: status });
});

// 确认提交 → 真实合成(克隆)·失败明确报原因,绝不静默兜底通用女声
voiceRoutes.post('/me/clone', async (c) => {
  const userId = c.get('userId');
  const result = await cloneVoice({ db: getDb() }, userId);
  if (!result.ok) {
    throw HttpError.badRequest(ErrorCode.E0000_UNKNOWN, result.message);
  }
  return c.json({ data: { cloned: true, label: result.label } });
});

// 试听 · 仅本人真克隆,没合成好就明确报错(不放通用女声冒充)
voiceRoutes.post('/me/preview', async (c) => {
  const userId = c.get('userId');
  const audioUrl = await synthesizeWhisper(
    { db: getDb() },
    { therapistUserId: userId, text: PREVIEW_TEXT, cloneOnly: true },
  );
  if (!audioUrl) {
    throw HttpError.badRequest(
      ErrorCode.E0000_UNKNOWN,
      '还没合成你的声音 · 请先录音并提交合成',
    );
  }
  return c.json({ data: { audioUrl } });
});
