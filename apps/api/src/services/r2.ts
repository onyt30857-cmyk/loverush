/**
 * Cloudflare R2 上传 · D-102
 *
 * R2 兼容 S3 API，用 @aws-sdk/client-s3 调，endpoint 指向 R2 域名：
 *   https://<account_id>.r2.cloudflarestorage.com
 *
 * 客户端上传两步：
 *   1. 服务端 createSignedUploadUrl → 返回 PUT URL（5min 过期）
 *   2. 客户端 PUT 文件到该 URL
 *
 * 公开访问：通过 R2 Public Bucket 或自定义域（R2_PUBLIC_URL）
 *
 * 凭证缺失时 isR2Available() = false，services/media.ts 自动 fallback 到 stub URL。
 */

import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadEnv } from '../env';

let cachedClient: S3Client | null = null;

function getR2Client(): S3Client | null {
  if (cachedClient) return cachedClient;
  const env = loadEnv() as unknown as {
    R2_ACCOUNT_ID?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_SECRET_ACCESS_KEY?: string;
  };
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return null;
  }
  const config: S3ClientConfig = {
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  };
  cachedClient = new S3Client(config);
  return cachedClient;
}

export function isR2Available(): boolean {
  return getR2Client() !== null;
}

export interface SignedUploadUrlArgs {
  key: string;
  contentType: string;
  contentLengthMax?: number; // bytes
  expiresInSeconds?: number;
}

export async function createSignedUploadUrl(args: SignedUploadUrlArgs): Promise<{
  uploadUrl: string;
  publicUrl: string;
  expiresInSeconds: number;
}> {
  const client = getR2Client();
  if (!client) throw new Error('R2 not configured');

  const env = loadEnv() as unknown as {
    R2_BUCKET_NAME: string;
    R2_PUBLIC_URL?: string;
    R2_ACCOUNT_ID?: string;
  };

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: args.key,
    ContentType: args.contentType,
    // 客户端 PUT 时必须发送相同 Content-Length，否则签名不匹配
    ContentLength: args.contentLengthMax,
  });

  const expiresIn = args.expiresInSeconds ?? 300;
  const uploadUrl = await getSignedUrl(client, command, { expiresIn });

  // 公开访问 URL（优先用自定义域）
  const publicUrl = env.R2_PUBLIC_URL
    ? `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${args.key}`
    : `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${args.key}`;

  return { uploadUrl, publicUrl, expiresInSeconds: expiresIn };
}

export async function deleteObject(key: string): Promise<void> {
  const client = getR2Client();
  if (!client) return;
  const env = loadEnv() as unknown as { R2_BUCKET_NAME: string };
  await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
}
