#!/usr/bin/env node
/**
 * 一次性脚本 · 上传 demo voice mp3 到 R2 · 拿固定 public URL
 * 用法: node /tmp/upload-voice.mjs
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, existsSync } from 'fs';

const ENV_FILE = '/Users/tony/Desktop/我的项目/为爱冲锋/code/.env.production';
const SRC = '/tmp/voice-intro/en-shimmer.mp3';
const KEY = 'demo/therapist-voice-intro-v1.mp3';

if (!existsSync(ENV_FILE)) {
  console.error('env file missing:', ENV_FILE);
  process.exit(1);
}
if (!existsSync(SRC)) {
  console.error('src missing:', SRC);
  process.exit(1);
}

// 简易 .env parse · 不依赖 dotenv
const env = {};
for (const line of readFileSync(ENV_FILE, 'utf-8').split('\n')) {
  const trim = line.trim();
  if (!trim || trim.startsWith('#')) continue;
  const eq = trim.indexOf('=');
  if (eq < 0) continue;
  const k = trim.slice(0, eq).trim();
  let v = trim.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[k] = v;
}

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  R2_PUBLIC_URL,
} = env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error('R2 env vars missing');
  process.exit(1);
}

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const body = readFileSync(SRC);
console.log(`Uploading ${SRC} (${body.length} bytes) to ${R2_BUCKET_NAME}/${KEY}...`);

await client.send(
  new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: KEY,
    Body: body,
    ContentType: 'audio/mpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }),
);

const publicUrl = R2_PUBLIC_URL
  ? `${R2_PUBLIC_URL.replace(/\/$/, '')}/${KEY}`
  : `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}/${KEY}`;

console.log('\n✅ Done');
console.log('Public URL:', publicUrl);
