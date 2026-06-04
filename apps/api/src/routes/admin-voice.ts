/**
 * M18 声音复刻 · 后台管理
 *
 * GET  /admin/voice-clones                列技师声音样本 + 复刻状态(引擎/是否已克隆)
 * POST /admin/voice-clones/:userId/preview 用该技师声音合成一句试听
 * POST /admin/voice-clones/:userId/reset   清 eleven_voice_id(强制下次重克隆)
 */
import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { therapists, users } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { getDb } from '../db';
import { HttpError } from '../middleware/errors';
import { ErrorCode } from '@loverush/types';
import { getVoiceCloneStatus, synthesizeWhisper } from '../services/voice';

const PREVIEW_TEXT = '来，我凑你耳边说……今晚别熬了，早点睡，我陪着你。';

export const adminVoiceRoutes = new Hono();
adminVoiceRoutes.use('*', requireAuth, requireRole(['admin', 'cs', 'ops']));

adminVoiceRoutes.get('/', async (c) => {
  const db = getDb();
  const rows = await db
    .select({
      userId: therapists.userId,
      displayName: users.displayName,
      verificationStatus: therapists.verificationStatus,
      voiceIntroUrl: therapists.voiceIntroUrl,
      elevenVoiceId: therapists.elevenVoiceId,
    })
    .from(therapists)
    .leftJoin(users, eq(users.id, therapists.userId))
    .orderBy(desc(therapists.updatedAt))
    .limit(200);

  const hasEleven = !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.length > 8);
  const hasOpenai = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 8);

  const data = rows.map((r) => {
    const hasSample = !!r.voiceIntroUrl;
    const cloned = !!r.elevenVoiceId;
    const engine = hasEleven && hasSample ? 'elevenlabs' : hasOpenai ? 'openai' : 'none';
    return {
      userId: r.userId,
      displayName: r.displayName,
      verificationStatus: r.verificationStatus,
      sampleUrl: r.voiceIntroUrl,
      hasSample,
      cloned,
      engine,
    };
  });
  return c.json({ data });
});

adminVoiceRoutes.post('/:userId/preview', async (c) => {
  const userId = c.req.param('userId');
  const audioUrl = await synthesizeWhisper({ db: getDb() }, { therapistUserId: userId, text: PREVIEW_TEXT });
  if (!audioUrl) {
    throw HttpError.badRequest(
      ErrorCode.E0000_UNKNOWN,
      '合成失败:检查语音服务 key/样本/R2。无 ELEVENLABS 且无 OPENAI key 时无法发声。',
    );
  }
  return c.json({ data: { audioUrl } });
});

adminVoiceRoutes.post('/:userId/reset', async (c) => {
  const userId = c.req.param('userId');
  const db = getDb();
  const t = await db.query.therapists.findFirst({ where: eq(therapists.userId, userId) });
  if (!t) throw HttpError.notFound(ErrorCode.E0003_RESOURCE_NOT_FOUND, 'therapist not found');
  await db.update(therapists).set({ elevenVoiceId: null }).where(eq(therapists.userId, userId));
  const status = await getVoiceCloneStatus({ db }, userId);
  return c.json({ data: { reset: true, status } });
});
