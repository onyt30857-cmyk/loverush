/**
 * 一次性:用 OpenAI TTS 生成"新订单"语音 mp3,放到 web 静态目录。
 * 生成后前端自动改播这段真人感语音(没有则播合成提示音兜底)。
 *
 * 跑法(需 OPENAI_API_KEY,用 railway 注入生产 key):
 *   railway run --service loverush -- node apps/api/tools/gen-new-order-voice.mjs
 * 然后把生成的 apps/web/public/sounds/new-order.mp3 提交即可。
 *
 * 想换词/音色:改下面 TEXT / VOICE。
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEXT = '亲~有新订单啦,记得及时确认接单哦~';
const VOICE = 'nova'; // Tony 选定:明亮甜美暖声(gpt-4o-mini-tts 支持 instructions 调声线)
const MODEL = 'gpt-4o-mini-tts';
const INSTRUCTIONS = '用温柔、有磁性、亲和力很强的成熟女声,像贴心的私人助理在耳边轻声提醒,语速适中偏慢,尾音柔和,带一点点暖意和愉悦感,不要机械、不要客服腔。';

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('缺 OPENAI_API_KEY(用 railway run --service loverush -- node ... 注入)');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = resolve(__dirname, '../../web/public/sounds/new-order.mp3');

const res = await fetch('https://api.openai.com/v1/audio/speech', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: MODEL, voice: VOICE, input: TEXT, instructions: INSTRUCTIONS, response_format: 'mp3' }),
});
if (!res.ok) {
  console.error('TTS 失败:', res.status, await res.text());
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
await mkdir(dirname(out), { recursive: true });
await writeFile(out, buf);
console.log(`✅ 已生成 ${out}(${buf.length} bytes)· 提交后部署即生效`);
