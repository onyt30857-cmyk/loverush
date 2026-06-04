/**
 * M18 声音复刻 · 技师自助
 *
 * GET  /voice/me            我的声音复刻状态(引擎/是否已克隆/样本)
 * POST /voice/me/preview    用我的声音合成一句试听
 */
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { getVoiceCloneStatus, synthesizeWhisper } from '../services/voice';

const PREVIEW_TEXT = '来，我凑你耳边说……今晚别熬了，早点睡，我陪着你。';

export const voiceRoutes = new Hono();
voiceRoutes.use('*', requireAuth);

voiceRoutes.get('/me', async (c) => {
  const userId = c.get('userId') as string;
  const status = await getVoiceCloneStatus({ db: getDb() }, userId);
  return c.json({ data: status });
});

voiceRoutes.post('/me/preview', async (c) => {
  const userId = c.get('userId') as string;
  const audioUrl = await synthesizeWhisper({ db: getDb() }, { therapistUserId: userId, text: PREVIEW_TEXT });
  if (!audioUrl) {
    throw HttpError.badRequest(
      ErrorCode.E0000_UNKNOWN,
      '暂时听不到 · 语音服务未就绪(缺样本/未配语音 key)',
    );
  }
  return c.json({ data: { audioUrl } });
});
