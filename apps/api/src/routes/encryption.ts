/**
 * 端到端加密公钥管理 · D-204
 *
 * POST /me/encryption-key            上传/覆盖我的公钥（algorithm + public_key）
 * GET  /users/:userId/encryption-key 查询对方公钥（用于私聊加密发送）
 *
 * 私钥永不入服务端 · 仅公钥可写可查。
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { encryptionKeys } from '@loverush/db';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';

const UploadBody = z.object({
  algorithm: z.enum(['x25519', 'ed25519']),
  public_key: z.string().min(32).max(200), // base64 32 字节 = 44 字符
  key_version: z.number().int().min(1).max(100).optional(),
});

export const myEncryptionKeyRoutes = new Hono();
myEncryptionKeyRoutes.use('*', requireAuth);

myEncryptionKeyRoutes.post('/', zValidator('json', UploadBody), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  const db = getDb();

  // 把现有 active 的密钥标记 expired（保留历史）
  await db
    .update(encryptionKeys)
    .set({ isActive: 0, expiredAt: new Date() })
    .where(and(eq(encryptionKeys.userId, userId), eq(encryptionKeys.isActive, 1)));

  // 插入新公钥（私钥永远不传，encryptedPrivateKey 字段始终留空 sentinel）
  const [row] = await db
    .insert(encryptionKeys)
    .values({
      userId,
      algorithm: body.algorithm,
      publicKey: body.public_key,
      encryptedPrivateKey: 'CLIENT_HELD', // 表示私钥客户端持有 · 不上传
      keySalt: 'BIP39_HKDF_LOVERUSH_X25519_V1',
      keyVersion: body.key_version ?? 1,
      isActive: 1,
    })
    .returning();

  return c.json({
    data: {
      id: row?.id,
      algorithm: row?.algorithm,
      public_key: row?.publicKey,
      key_version: row?.keyVersion,
      created_at: row?.createdAt,
    },
  });
});

// 公开端点（仍要认证 · 避免爬虫批量拉公钥）
export const publicKeyRoutes = new Hono();
publicKeyRoutes.use('*', requireAuth);

publicKeyRoutes.get('/:userId/encryption-key', async (c) => {
  const userId = c.req.param('userId');
  const db = getDb();
  const row = await db.query.encryptionKeys.findFirst({
    where: and(eq(encryptionKeys.userId, userId), eq(encryptionKeys.isActive, 1)),
  });
  if (!row || row.algorithm === 'pending') {
    return c.json({ data: null });
  }
  return c.json({
    data: {
      algorithm: row.algorithm,
      public_key: row.publicKey,
      key_version: row.keyVersion,
    },
  });
});
