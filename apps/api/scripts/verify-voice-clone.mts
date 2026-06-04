/**
 * 验证 M18 声音复刻真实通路(克隆 + TTS + R2)。
 * 前提：①设了 ELEVENLABS_API_KEY ②某技师有 voiceIntroUrl 样本 ③R2 已配。
 *
 * 用法(本地)：
 *   ELEVENLABS_API_KEY=xxx DATABASE_URL=<local> bun apps/api/scripts/verify-voice-clone.mts
 *   (可选)指定技师 user_id：... bun apps/api/scripts/verify-voice-clone.mts <therapistUserId>
 */
import { createDb, therapists } from '@loverush/db';
import { isNotNull, eq } from 'drizzle-orm';
import { synthesizeWhisper } from '../src/services/voice';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL 未注入'); process.exit(1); }
if (!process.env.ELEVENLABS_API_KEY) {
  console.error('⚠️ ELEVENLABS_API_KEY 未设 → synthesizeWhisper 必返 null。先设 key 再验。');
}
const db = createDb(url, { maxConnections: 3 });

const argId = process.argv[2];
const t = argId
  ? await db.query.therapists.findFirst({ where: eq(therapists.userId, argId) })
  : await db.query.therapists.findFirst({ where: isNotNull(therapists.voiceIntroUrl) });

if (!t) { console.error('找不到技师(或都没 voiceIntroUrl 样本)。'); process.exit(1); }
console.log('技师 userId:', t.userId);
console.log('voiceIntroUrl:', t.voiceIntroUrl ?? '(无样本 → 无法克隆)');
console.log('已有 elevenVoiceId:', t.elevenVoiceId ?? '(无 → 将懒克隆)');

console.log('\n→ 合成中…');
const audioUrl = await synthesizeWhisper(
  { db },
  { therapistUserId: t.userId, text: '来，我凑你耳边说……今晚别熬了，早点睡，我陪着你。' },
);

if (audioUrl) {
  console.log('✅ 通了！音频 URL:', audioUrl);
  console.log('   浏览器打开应能听到她的声音说这句话。');
} else {
  console.log('❌ 返回 null。排查：key 是否有效 / 该技师是否有 voiceIntroUrl / R2 是否配 / ElevenLabs 配额。');
  console.log('   (代码全程 try/catch 降级,具体错误可临时在 voice.ts 的 catch 里打 log 看。)');
}
process.exit(0);
