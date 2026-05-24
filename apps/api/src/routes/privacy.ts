/**
 * 隐私模式路由 · M15
 *
 * GET    /privacy                       获取我的设置
 * PUT    /privacy                       更新设置
 * POST   /privacy/pin                   设置 / 修改 PIN
 * POST   /privacy/pin/verify            校验 PIN（前端解锁时调）
 * DELETE /privacy/pin                   清除 PIN
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import {
  clearPin,
  getOrCreate,
  setPin,
  updateSettings,
  verifyPin,
  type PrivacyContext,
} from '../services/privacy';

function pctx(): PrivacyContext {
  return { db: getDb() };
}

const PinBody = z.object({
  new_pin: z.string().regex(/^\d{4,8}$/),
  current_pin: z.string().regex(/^\d{4,8}$/).optional(),
});

const VerifyBody = z.object({ pin: z.string().regex(/^\d{4,8}$/) });
const ClearBody = z.object({ current_pin: z.string().regex(/^\d{4,8}$/) });

const SettingsBody = z.object({
  privacy_mode_enabled: z.boolean().optional(),
  decoy_enabled: z.boolean().optional(),
  decoy_type: z.enum(['calculator', 'notes', 'weather']).optional(),
  auto_lock_seconds: z.number().int().min(0).max(3600).optional(),
  obfuscate_notifications: z.boolean().optional(),
  panic_wipe_on_failed_attempts: z.boolean().optional(),
  panic_wipe_threshold: z.number().int().min(3).max(30).optional(),
});

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function clientIp(c: { req: { header: (k: string) => string | undefined } }) {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip')
  );
}

export const privacyRoutes = new Hono();
privacyRoutes.use('*', requireAuth);

privacyRoutes.get('/', async (c) => {
  const row = await getOrCreate(pctx(), c.get('userId') as string);
  // 不返回 pinHash
  const { pinHash, ...safe } = row;
  return c.json({ data: { ...safe, hasPin: Boolean(pinHash) } });
});

privacyRoutes.put('/', zValidator('json', SettingsBody), async (c) => {
  const body = c.req.valid('json');
  const row = await updateSettings(pctx(), {
    userId: c.get('userId') as string,
    patch: {
      privacyModeEnabled: body.privacy_mode_enabled,
      decoyEnabled: body.decoy_enabled,
      decoyType: body.decoy_type,
      autoLockSeconds: body.auto_lock_seconds,
      obfuscateNotifications: body.obfuscate_notifications,
      panicWipeOnFailedAttempts: body.panic_wipe_on_failed_attempts,
      panicWipeThreshold: body.panic_wipe_threshold,
    },
  });
  const { pinHash, ...safe } = row;
  return c.json({ data: safe });
});

privacyRoutes.post('/pin', zValidator('json', PinBody), async (c) => {
  const body = c.req.valid('json');
  const ip = clientIp(c);
  const row = await setPin(pctx(), {
    userId: c.get('userId') as string,
    newPin: body.new_pin,
    currentPin: body.current_pin,
    ipHash: ip ? await sha256Hex(ip) : undefined,
  });
  const { pinHash, ...safe } = row;
  return c.json({ data: { ...safe, hasPin: true } });
});

privacyRoutes.post('/pin/verify', zValidator('json', VerifyBody), async (c) => {
  const body = c.req.valid('json');
  const ip = clientIp(c);
  const result = await verifyPin(pctx(), {
    userId: c.get('userId') as string,
    pin: body.pin,
    ipHash: ip ? await sha256Hex(ip) : undefined,
  });
  return c.json({ data: result });
});

privacyRoutes.delete('/pin', zValidator('json', ClearBody), async (c) => {
  const body = c.req.valid('json');
  await clearPin(pctx(), { userId: c.get('userId') as string, currentPin: body.current_pin });
  return c.json({ data: { ok: true } });
});
