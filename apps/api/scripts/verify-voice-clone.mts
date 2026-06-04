/**
 * 验证 M18 声音复刻真实通路(克隆 + TTS + R2)。
 * 前提：①设了 ELEVENLABS_API_KEY ②某技师有 voiceIntroUrl 样本 ③R2 已配。
 *
 * 用法(本地)：
 *   ELEVENLABS_API_KEY=xxx DATABASE_URL=<local> bun apps/api/scripts/verify-voice-clone.mts
 *   (可选)指定技师 user_id：... bun apps/api/scripts/verify-voice-clone.mts <therapistUserId>
 */
import { createDb } from '@loverush/db';
import { synthesizeWhisper } from '../src/services/voice';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL 未注入'); process.exit(1); }
console.log('通道: ELEVENLABS_API_KEY=' + (process.env.ELEVENLABS_API_KEY ? '有(真克隆)' : '无') +
  ' · OPENAI_API_KEY=' + (process.env.OPENAI_API_KEY ? '有(通用女声退路)' : '无'));
if (!process.env.ELEVENLABS_API_KEY && !process.env.OPENAI_API_KEY) {
  console.error('⚠️ 两个 key 都没 → 必返 null。至少要一个。');
}
const db = createDb(url, { maxConnections: 3 });

const argId = process.argv[2];
let therapistUserId: string;
if (argId) {
  // 给了 userId → 直接用,跳过 DB 查询(通道 B/OpenAI 不需查 therapists,且避开生产未迁移的 eleven_voice_id 列)
  therapistUserId = argId;
  console.log('技师 userId(直传):', therapistUserId);
} else {
  // 没给 → 用窄查询(只选已存在列)挑一个有样本的,避开 eleven_voice_id
  const rows = (await db.execute(
    // eslint-disable-next-line
    (await import('drizzle-orm')).sql`SELECT user_id FROM therapists WHERE voice_intro_url IS NOT NULL LIMIT 1`,
  )) as unknown as Array<{ user_id: string }>;
  if (!rows[0]?.user_id) { console.error('找不到有 voiceIntroUrl 样本的技师,请传 userId 参数。'); process.exit(1); }
  therapistUserId = rows[0].user_id;
  console.log('技师 userId:', therapistUserId);
}

console.log('\n→ 合成中…');
const audioUrl = await synthesizeWhisper(
  { db },
  { therapistUserId, text: '来，我凑你耳边说……今晚别熬了，早点睡，我陪着你。' },
);

if (audioUrl) {
  console.log('✅ 通了！音频 URL:', audioUrl);
  console.log('   浏览器打开应能听到她的声音说这句话。');
} else {
  console.log('❌ 返回 null。排查：key 是否有效 / 该技师是否有 voiceIntroUrl / R2 是否配 / ElevenLabs 配额。');
  console.log('   (代码全程 try/catch 降级,具体错误可临时在 voice.ts 的 catch 里打 log 看。)');
}
process.exit(0);
