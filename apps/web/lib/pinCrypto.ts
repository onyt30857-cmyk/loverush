/**
 * PIN-based encryption for sensitive client-side secrets (mnemonic, refresh_token)
 *
 * 所有操作走浏览器 WebCrypto(零服务端依赖)。
 *
 * 威胁模型 + 防护:
 * - 攻击者拿到 localStorage 转储(XSS / 设备备份 / 控制台访问)
 *   → 没 PIN 无法解密(GCM authentication tag 防篡改)
 * - PBKDF2 250k iter:单次 PIN 派生 ~250ms,GPU 攻击 6 位 PIN 10^6 次 ≈ 70 小时 CPU
 * - 配合 lock.ts 的 wrong-PIN 节流(3/5/10 次梯度),暴破不可行
 * - 注:Argon2id 更稳但 WebCrypto 没原生支持,polyfill 太重 → PBKDF2 在此用例足够
 */

const ENC_VERSION = 1;
const PBKDF2_ITER = 250_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

export interface SecretBlob {
  v: typeof ENC_VERSION;
  salt: string; // base64 16B
  iv: string; // base64 12B
  ct: string; // base64 ciphertext + 16B GCM tag
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

async function deriveAesKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, [
    'deriveKey',
  ]);
  // ts: WebCrypto types want BufferSource,Uint8Array 是 BufferSource 但 lib.dom 写得严
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITER },
    baseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptWithPin(plain: string, pin: string): Promise<SecretBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(pin, salt);
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plain),
  );
  return { v: ENC_VERSION, salt: b64(salt), iv: b64(iv), ct: b64(ctBuf) };
}

/** PIN 错或密文损坏会抛 DOMException("OperationError") */
export async function decryptWithPin(blob: SecretBlob, pin: string): Promise<string> {
  if (blob.v !== ENC_VERSION) throw new Error('unsupported blob version');
  const salt = unb64(blob.salt);
  const iv = unb64(blob.iv);
  const ct = unb64(blob.ct);
  const key = await deriveAesKey(pin, salt);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return new TextDecoder().decode(plainBuf);
}
