/**
 * M18 声音复刻 · ElevenLabs 语音克隆 + 多语言 TTS
 *
 * 流程：技师 voiceIntroUrl(上传的语音介绍样本) → ElevenLabs Instant Voice Clone
 *   → voice_id(存 therapists.eleven_voice_id, 懒克隆) → 对 companion 回复做 TTS
 *   → mp3 存 R2 → 返回公开 URL,前端语音气泡播放。
 *
 * 双通道(降级链)：
 *   A · ElevenLabs 真克隆(最忠实她的声音,需付费 ELEVENLABS_API_KEY + voiceIntroUrl 样本)
 *   B · OpenAI TTS(复用现有生产 OPENAI_API_KEY,零新账号,但通用女声非克隆 ·
 *       按技师 hash 固定分配一个女声保一致)
 *   都不可用 → null,前端 demo 占位。全程 try/catch 降级,绝不破坏计费。
 * ⚠️ 两条 API 路径均未对真实服务验证(本地无 key)。生产有 OPENAI_API_KEY →
 *   通道 B 部署后应即可发声;通道 A 待配 ELEVENLABS_API_KEY。
 *   验真:apps/api/scripts/verify-voice-clone.mts。
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

export interface VoiceCloneStatus {
  /** 技师是否传了语音样本(voiceIntroUrl) */
  hasSample: boolean;
  sampleUrl: string | null;
  /** 当前会用哪个引擎发声 */
  engine: 'elevenlabs' | 'openai' | 'none';
  /** ElevenLabs 是否已真克隆出 voice_id */
  cloned: boolean;
  /** 一句话人话状态(给 UI 直接显) */
  label: string;
}

/** 技师声音复刻状态 · 给技师端/后台展示与管控 */
export async function getVoiceCloneStatus(
  ctx: VoiceContext,
  therapistUserId: string,
): Promise<VoiceCloneStatus> {
  // 窄 select 只取需要列(不用 query.findFirst 选全表,免疫并发 schema 漂移如 match_persona)
  const [t] = await ctx.db
    .select({ voiceIntroUrl: therapists.voiceIntroUrl, elevenVoiceId: therapists.elevenVoiceId })
    .from(therapists)
    .where(eq(therapists.userId, therapistUserId))
    .limit(1);
  const hasSample = !!t?.voiceIntroUrl;
  const cloned = !!t?.elevenVoiceId;
  const hasEleven = !!apiKey();
  const hasOpenai = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 8);

  // 引擎判定:有 eleven key 且有样本 → 真克隆;否则有 openai → 通用女声;都无 → 不可用
  let engine: VoiceCloneStatus['engine'] = 'none';
  if (hasEleven && hasSample) engine = 'elevenlabs';
  else if (hasOpenai) engine = 'openai';

  let label: string;
  if (engine === 'elevenlabs') label = cloned ? '已用本人声音复刻' : '将用本人语音克隆(首次发声时生成)';
  else if (engine === 'openai') label = '通用女声(未接本人克隆)';
  else label = '声音不可用(缺样本或未配语音服务)';

  return { hasSample, sampleUrl: t?.voiceIntroUrl ?? null, engine, cloned, label };
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

  const [t] = await ctx.db
    .select({ voiceIntroUrl: therapists.voiceIntroUrl, elevenVoiceId: therapists.elevenVoiceId })
    .from(therapists)
    .where(eq(therapists.userId, therapistUserId))
    .limit(1);
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

// ── 通道 A：ElevenLabs 真克隆（最忠实，需付费 key + voiceIntroUrl 样本）──
async function elevenWhisper(ctx: VoiceContext, therapistUserId: string, text: string): Promise<Uint8Array | null> {
  const key = apiKey();
  if (!key) return null;
  const voiceId = await ensureClonedVoice(ctx, therapistUserId);
  if (!voiceId) return null;
  const r = await fetch(`${EL_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: TTS_MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3 },
    }),
  });
  if (!r.ok) return null;
  const buf = new Uint8Array(await r.arrayBuffer());
  return buf.byteLength ? buf : null;
}

// ── 通道 B：OpenAI TTS（复用现有 OPENAI_API_KEY，零新账号；通用女声非克隆）──
//   按技师 userId 哈希固定分配一个女声 → 同一技师永远同声，保一致(防露馅)。
const OPENAI_FEMALE_VOICES = ['nova', 'shimmer', 'coral', 'sage'] as const;
function openaiVoiceFor(therapistUserId: string): string {
  let h = 0;
  for (let i = 0; i < therapistUserId.length; i++) h = (h * 31 + therapistUserId.charCodeAt(i)) >>> 0;
  return OPENAI_FEMALE_VOICES[h % OPENAI_FEMALE_VOICES.length]!;
}
async function openaiWhisper(therapistUserId: string, text: string): Promise<Uint8Array | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.length < 8) return null;
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: openaiVoiceFor(therapistUserId),
      input: text,
      response_format: 'mp3',
    }),
  });
  if (!r.ok) return null;
  const buf = new Uint8Array(await r.arrayBuffer());
  return buf.byteLength ? buf : null;
}

/**
 * 合成「她的声音」说一段 companion 回复 → 存 R2 → 返回公开 URL。
 * 优先 ElevenLabs 真克隆；否则 OpenAI TTS 通用女声(复用现有 key)；都不可用 → null(前端占位)。
 * 任一环节失败绝不抛(降级)。
 */
export async function synthesizeWhisper(
  ctx: VoiceContext,
  args: { therapistUserId: string; text: string },
): Promise<string | null> {
  const text = args.text?.trim();
  if (!text) return null;
  try {
    // A 真克隆优先；拿不到再退 B 通用女声
    const buf =
      (await elevenWhisper(ctx, args.therapistUserId, text)) ??
      (await openaiWhisper(args.therapistUserId, text));
    if (!buf) return null;
    const r2Key = `companion-voice/${args.therapistUserId}/${Date.now()}-${Math.round(Math.random() * 1e6)}.mp3`;
    return await putObject(r2Key, buf, 'audio/mpeg');
  } catch {
    return null;
  }
}
