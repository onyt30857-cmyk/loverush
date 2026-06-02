/* eslint-disable no-console */
/**
 * M17 · Telegram Mini App 免密登录 · 本地集成验证（不调 TG API）
 *
 * 自签一条合法 initData → verifyInitData 应通过 → loginOrCreateTelegramUser 两次(同 tgUserId)：
 *   首次 isNew=true 建号；再次 isNew=false 复用同账号；两次都发出 token。跑完自清理。
 *
 * 跑法：DATABASE_URL=<本地> JWT_SECRET=<≥32位> TELEGRAM_BOT_TOKEN=<任意> bun scripts/verify-m17-tg-login.mts
 */
import { eq } from 'drizzle-orm';
import { createDb, users, tgUserBinding } from '@loverush/db';
import { verifyInitData } from '../src/services/telegram.ts';
import { loginOrCreateTelegramUser, type AuthContext } from '../src/services/auth.ts';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://loverush:loverush_dev@localhost:54399/loverush';
if (!DB_URL.includes('localhost') && !DB_URL.includes('127.0.0.1')) {
  console.error('💥 拒绝运行：DATABASE_URL 非本地');
  process.exit(3);
}
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '123456:LOCAL_TEST_TOKEN_abcdef';
const TG_USER_ID = 999000111;
const db = createDb(DB_URL);

const ctx: AuthContext = {
  db,
  jwtSecret: new TextEncoder().encode(process.env.JWT_SECRET ?? 'x'.repeat(40)),
  jwtIssuer: 'loverush',
  accessTtlSeconds: 3600,
  refreshTtlSeconds: 2592000,
};

async function signInitData(token: string, fields: Record<string, string>): Promise<string> {
  const enc = new TextEncoder();
  const dcs = Object.entries(fields).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const kWeb = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', kWeb, enc.encode(token));
  const kSecret = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', kSecret, enc.encode(dcs));
  const hash = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

async function cleanup(userId?: string) {
  await db.delete(tgUserBinding).where(eq(tgUserBinding.tgUserId, TG_USER_ID));
  if (userId) await db.delete(users).where(eq(users.id, userId));
}

const checks: Array<[string, boolean]> = [];

async function main() {
  await cleanup();
  const user = JSON.stringify({ id: TG_USER_ID, username: 'tg_tester', first_name: '小明' });
  const initData = await signInitData(BOT_TOKEN, { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'q', user });

  const v = await verifyInitData(initData, BOT_TOKEN);
  checks.push(['initData 验签通过', v.ok === true]);
  checks.push(['解析出 tg user id', v.user?.id === TG_USER_ID]);

  const first = await loginOrCreateTelegramUser(ctx, { tgUserId: TG_USER_ID, tgUsername: 'tg_tester', displayName: '小明' });
  checks.push(['首次登录建号 isNew=true', first.isNew === true]);
  checks.push(['首次返回 access_token', Boolean(first.accessToken)]);
  checks.push(['新号是 customer', first.user.userType === 'customer']);

  const second = await loginOrCreateTelegramUser(ctx, { tgUserId: TG_USER_ID, tgUsername: 'tg_tester', displayName: '小明' });
  checks.push(['再次登录复用 isNew=false', second.isNew === false]);
  checks.push(['两次同一个 userId', first.user.id === second.user.id]);

  const binding = await db.query.tgUserBinding.findFirst({ where: eq(tgUserBinding.tgUserId, TG_USER_ID) });
  checks.push(['绑定行存在且指向该账号', binding?.userId === first.user.id]);

  console.log('\n=== 断言 ===');
  let pass = true;
  for (const [n, ok] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${n}`);
    if (!ok) pass = false;
  }
  await cleanup(first.user.id);
  console.log('\n🧹 已清理');
  console.log(`\n===== ${pass ? '✅ TG Mini App 登录链路跑通' : '❌ 有失败项'} =====`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('💥 失败:', e);
  process.exit(1);
});
