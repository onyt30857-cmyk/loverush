/**
 * 用 S3 API 直接配 R2 bucket CORS · 不需要 CF API token
 * 复用现有 R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY
 *
 * 用法: bash scripts/configure-r2-cors.sh
 */

import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET_NAME ?? 'loverush-media';

if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY) {
  throw new Error('R2 凭证不全(R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)');
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

const CORS_RULES = [
  {
    AllowedOrigins: [
      'https://loverush-web-production.up.railway.app',
      'https://loverush-admin-production.up.railway.app',
      'http://localhost:4321',
      'http://localhost:3000',
    ],
    AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  },
];

async function main() {
  console.log(`→ 配置 R2 bucket ${BUCKET} CORS...`);
  await s3.send(new PutBucketCorsCommand({
    Bucket: BUCKET,
    CORSConfiguration: { CORSRules: CORS_RULES },
  }));
  console.log('✓ CORS 已配置');

  console.log('\n→ 拉回当前 CORS 验证...');
  const cur = await s3.send(new GetBucketCorsCommand({ Bucket: BUCKET }));
  console.log(JSON.stringify(cur.CORSRules, null, 2));
}

main().catch((e) => {
  console.error('❌ 失败:', e.message);
  process.exit(1);
});
