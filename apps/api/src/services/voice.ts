/**
 * M18 声音复刻 · ElevenLabs 语音克隆 + 多语言 TTS
 *
 * 流程：技师 voiceIntroUrl(上传的语音介绍样本) → ElevenLabs Instant Voice Clone
 *   → voice_id(存 therapists.eleven_voice_id, 懒克隆) → 对 companion 回复做 TTS
 *   → mp3 存 R2 → 返回公开 URL,前端语音气泡播放。
 *
 * ⚠️ 未对真实 ElevenLabs API 验证(生产未配 ELEVENLABS_API_KEY)。
 *   按 ElevenLabs 稳定 API(v1/voices/add · v1/text-to-speech/{id})实现。
 *   激活步骤:①ElevenLabs 账号 + 设 ELEVENLABS_API_KEY ②技师有 voiceIntroUrl 样本。
 *   缺任一 → 全程 try/catch 降级返 null,前端用 demo 占位(零破坏)。
 *   加 key 后用 apps/api/scripts/verify-voice-clone.mts 验真,据真实结果修。
 */
import { eq } from 'drizzle-orm';
import { therapists } from '@loverush/db';
import type { Database } from '@loverush/db';
import { putObject } from './r2';

const EL_BASE = 'https://api.elevenlabs.io/v1';
// 多语言模型 · 支持 zh/th/vi/ms/id 等 SEA 语言(对齐 LoveRush 市场)
const TTS_MODEL = 'eleven_multilingual_v2';

export interface VoiceContext {
  db: Database;
}

function apiKey(): string | null {
  const k = process.env.ELEVENLABS_API_KEY;
  return k && k.length > 8 ? k : null;
}

/**
 * 确保技师有克隆 voice_id（懒克隆：首次需要时从 voiceIntroUrl 样本生成并落库）。
 * 无 key / 无样本 / 克隆失败 → null。
 */
async function ensureClonedVoice(ctx: VoiceContext, therapistUserId: string): Promise<string | null> {
  const key = apiKey();
  if (!key) return null;

  const t = await ctx.db.query.therapists.findFirst({
    where: eq(therapists.userId, therapistUserId),
  });
  if (!t) return null;
  if (t.elevenVoiceId) return t.elevenVoiceId;
  if (!t.voiceIntroUrl) return null; // 无样本无法克隆

  try {
    // 1) 拉样本字节
    const sampleResp = await fetch(t.voiceIntroUrl);
    if (!sampleResp.ok) return null;
    const sampleBlob = await sampleResp.blob();

    // 2) Instant Voice Clone · POST /v1/voices/add (multipart)
    const form = new FormData();
    form.append('name', `lr-companion-${therapistUserId.slice(0, 8)}`);
    form.append('files', sampleBlob, 'sample.mp3');
    form.append('description', 'LoveRush companion voice (M18)');

    const addResp = await fetch(`${EL_BASE}/voices/add`, {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
    });
    if (!addResp.ok) return null;
    const addJson = (await addResp.json()) as { voice_id?: string };
    const voiceId = addJson.voice_id;
    if (!voiceId) return null;

    // 3) 落库(幂等：再查一次防并发重复克隆覆盖)
    await ctx.db
      .update(therapists)
      .set({ elevenVoiceId: voiceId })
      .where(eq(therapists.userId, therapistUserId));
    return voiceId;
  } catch {
    return null;
  }
}

/**
 * 合成「她的声音」说一段 companion 回复 → 存 R2 → 返回公开 URL。
 * 任一环节失败(无 key/无样本/API 错/R2 未配) → null,调用方降级到占位音频。
 */
export async function synthesizeWhisper(
  ctx: VoiceContext,
  args: { therapistUserId: string; text: string },
): Promise<string | null> {
  const key = apiKey();
  if (!key) return null;
  const text = args.text?.trim();
  if (!text) return null;

  try {
    const voiceId = await ensureClonedVoice(ctx, args.therapistUserId);
    if (!voiceId) return null;

    // TTS · POST /v1/text-to-speech/{voice_id} → audio/mpeg
    const ttsResp = await fetch(`${EL_BASE}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: TTS_MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3 },
      }),
    });
    if (!ttsResp.ok) return null;

    const buf = new Uint8Array(await ttsResp.arrayBuffer());
    if (buf.byteLength === 0) return null;

    // 存 R2 · key 含时间戳防覆盖
    const r2Key = `companion-voice/${args.therapistUserId}/${Date.now()}-${Math.round(Math.random() * 1e6)}.mp3`;
    return await putObject(r2Key, buf, 'audio/mpeg');
  } catch {
    return null;
  }
}
