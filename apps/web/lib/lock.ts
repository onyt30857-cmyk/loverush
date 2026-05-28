/**
 * 本机 PIN 锁状态管理 + wrong-PIN 节流
 *
 * 设备本地存储模型(无服务端):
 * - ev_blob_mn        12 词助记词 加密块(SecretBlob)
 * - ev_blob_rt        refresh_token 加密块(SecretBlob)
 * - ev_user_meta      用户基本信息 JSON(用于解锁屏显示昵称)
 * - ev_wrong          连续错误次数(int)
 * - ev_lockout_until  锁定到期时间戳 OR "FORCED"(强制走助记词恢复)
 * - ev_unlock_until   信任窗口到期戳(本机 30 天内免 PIN)
 *
 * Wrong-PIN 节流梯度:
 *   3 次 → 10s 锁
 *   5 次 → 60s 锁
 *  10 次 → FORCED,本机强制走 /recover
 *
 * 解锁后 access_token 永不落盘,只放内存;refresh_token 由 lock 解出后交回 AuthProvider 用一次即可。
 */

import { encryptWithPin, decryptWithPin, type SecretBlob } from './pinCrypto';

const K = {
  blob_mn: 'ev_blob_mn',
  blob_rt: 'ev_blob_rt',
  user_meta: 'ev_user_meta',
  wrong_count: 'ev_wrong',
  lockout_until: 'ev_lockout_until',
  unlock_until: 'ev_unlock_until',
} as const;

const LOCKOUT_LADDER: ReadonlyArray<{ fails: number; ms: number }> = [
  { fails: 3, ms: 10_000 },
  { fails: 5, ms: 60_000 },
  { fails: 10, ms: -1 }, // -1 = FORCED
];

const DEFAULT_UNLOCK_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 天信任窗口

export interface LockUserMeta {
  id: string;
  displayName: string | null;
  userType: 'customer' | 'therapist';
}

function isClient(): boolean {
  return typeof window !== 'undefined';
}

export function hasLock(): boolean {
  if (!isClient()) return false;
  return !!window.localStorage.getItem(K.blob_mn);
}

export function getUserMeta(): LockUserMeta | null {
  if (!isClient()) return null;
  const s = window.localStorage.getItem(K.user_meta);
  if (!s) return null;
  try {
    return JSON.parse(s) as LockUserMeta;
  } catch {
    return null;
  }
}

export async function setupLock(args: {
  pin: string;
  mnemonic: string;
  refreshToken: string;
  meta: LockUserMeta;
}): Promise<void> {
  const blobMn = await encryptWithPin(args.mnemonic, args.pin);
  const blobRt = await encryptWithPin(args.refreshToken, args.pin);
  window.localStorage.setItem(K.blob_mn, JSON.stringify(blobMn));
  window.localStorage.setItem(K.blob_rt, JSON.stringify(blobRt));
  window.localStorage.setItem(K.user_meta, JSON.stringify(args.meta));
  window.localStorage.removeItem(K.wrong_count);
  window.localStorage.removeItem(K.lockout_until);
}

export function clearLock(): void {
  if (!isClient()) return;
  for (const k of Object.values(K)) window.localStorage.removeItem(k);
}

export function getLockoutMsRemaining(): number {
  if (!isClient()) return 0;
  const raw = window.localStorage.getItem(K.lockout_until);
  if (!raw || raw === 'FORCED') return 0;
  const until = parseInt(raw, 10);
  if (!until) return 0;
  return Math.max(0, until - Date.now());
}

export function isForcedRecover(): boolean {
  if (!isClient()) return false;
  return window.localStorage.getItem(K.lockout_until) === 'FORCED';
}

export type UnlockResult =
  | { ok: true; mnemonic: string; refreshToken: string }
  | { ok: false; error: string; lockedUntil?: number; forced?: boolean };

export async function unlock(pin: string): Promise<UnlockResult> {
  if (!isClient()) return { ok: false, error: 'not in browser' };
  if (isForcedRecover()) {
    return { ok: false, error: '错误次数过多,请通过助记词恢复', forced: true };
  }
  if (getLockoutMsRemaining() > 0) {
    return { ok: false, error: '请稍后再试', lockedUntil: parseInt(window.localStorage.getItem(K.lockout_until) || '0', 10) };
  }
  const sMn = window.localStorage.getItem(K.blob_mn);
  const sRt = window.localStorage.getItem(K.blob_rt);
  if (!sMn || !sRt) return { ok: false, error: '本机尚未设置 PIN' };

  let blobMn: SecretBlob;
  let blobRt: SecretBlob;
  try {
    blobMn = JSON.parse(sMn) as SecretBlob;
    blobRt = JSON.parse(sRt) as SecretBlob;
  } catch {
    return { ok: false, error: '本机数据损坏,请通过助记词恢复', forced: true };
  }

  try {
    const mnemonic = await decryptWithPin(blobMn, pin);
    const refreshToken = await decryptWithPin(blobRt, pin);
    // 成功:清错误计数
    window.localStorage.removeItem(K.wrong_count);
    window.localStorage.removeItem(K.lockout_until);
    return { ok: true, mnemonic, refreshToken };
  } catch {
    // PIN 错(AES-GCM tag mismatch)→ 计数累加 + 看是否撞梯度
    const wrong = parseInt(window.localStorage.getItem(K.wrong_count) || '0', 10) + 1;
    window.localStorage.setItem(K.wrong_count, String(wrong));
    let rung: { fails: number; ms: number } | undefined;
    for (const r of LOCKOUT_LADDER) {
      if (wrong >= r.fails) rung = r;
    }
    if (rung) {
      if (rung.ms === -1) {
        window.localStorage.setItem(K.lockout_until, 'FORCED');
        return { ok: false, error: '错误次数过多,请通过助记词恢复', forced: true };
      }
      const until = Date.now() + rung.ms;
      window.localStorage.setItem(K.lockout_until, String(until));
      return { ok: false, error: `密码错误,请 ${Math.ceil(rung.ms / 1000)} 秒后重试`, lockedUntil: until };
    }
    const nextRung = LOCKOUT_LADDER[0]!;
    return { ok: false, error: `密码错误,还可尝试 ${nextRung.fails - wrong} 次` };
  }
}

/** 解锁成功后调用:本机信任窗口内免再问 PIN(默认 30 天)*/
export function markUnlocked(ttlMs: number = DEFAULT_UNLOCK_TTL_MS): void {
  if (!isClient()) return;
  window.localStorage.setItem(K.unlock_until, String(Date.now() + ttlMs));
}

export function isWithinUnlockWindow(): boolean {
  if (!isClient()) return false;
  const u = parseInt(window.localStorage.getItem(K.unlock_until) || '0', 10);
  return u > Date.now();
}

export function clearUnlockWindow(): void {
  if (!isClient()) return;
  window.localStorage.removeItem(K.unlock_until);
}
