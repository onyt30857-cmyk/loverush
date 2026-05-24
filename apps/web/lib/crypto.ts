/**
 * 端到端加密客户端库 · D-204
 *
 * 流程：
 *  1. 注册时：BIP-39 助记词 → seed → HKDF-SHA256 派生 X25519 静态密钥对
 *     私钥存 IndexedDB（不入 localStorage 防其他 JS 扫到）
 *     公钥 base64 上传服务端
 *
 *  2. 发消息：
 *     - ephemeral X25519 keypair（每条消息新生成）
 *     - ECDH(ephemeral_priv, peer_pub) → shared secret
 *     - HKDF(shared, "v1.msg.aes256gcm") → 32-byte AES key
 *     - AES-GCM 加密（12-byte nonce 随机）
 *     - 拼装：v1.<ephemeralPubB64>.<nonceB64>.<ciphertextB64>
 *
 *  3. 收消息：
 *     - 解析 v1.<ephemeralPub>.<nonce>.<ciphertext>
 *     - ECDH(my_priv, ephemeralPub) → shared secret
 *     - HKDF → AES key
 *     - AES-GCM decrypt
 *
 * 注意：
 *  - 用 ephemeral key 而不是 sender 静态密钥 → 前向保密（PFS）
 *  - 没做 ratchet / 群聊 / 离线消息密钥协商，简化为 1-1 私聊
 *  - 加密消息无法翻译 / 无法做服务端红线（设计权衡）
 */

import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import * as bip39 from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english';

// ──────────────── base64 helpers ────────────────

function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// ──────────────── 密钥派生 ────────────────

export interface KeyPair {
  publicKeyB64: string;
  privateKeyB64: string;
}

/** 从 BIP-39 助记词派生 X25519 静态密钥对（注册时调一次） */
export async function deriveStaticKeyPair(mnemonic: string): Promise<KeyPair> {
  if (!bip39.validateMnemonic(mnemonic, english)) {
    throw new Error('invalid mnemonic');
  }
  const seed = await bip39.mnemonicToSeed(mnemonic);
  // HKDF：seed → 32-byte X25519 private scalar
  const privateScalar = hkdf(sha256, seed, undefined, 'loverush.x25519.v1', 32);
  const publicKey = x25519.getPublicKey(privateScalar);
  return {
    publicKeyB64: bytesToB64(publicKey),
    privateKeyB64: bytesToB64(privateScalar),
  };
}

// ──────────────── IndexedDB 私钥持久化 ────────────────

const DB_NAME = 'loverush_keys';
const STORE = 'keys';
const KEY_PRIV = 'static_priv';
const KEY_PUB = 'static_pub';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openDb();
  const result = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function storeKeyPair(kp: KeyPair): Promise<void> {
  await idbPut(KEY_PRIV, kp.privateKeyB64);
  await idbPut(KEY_PUB, kp.publicKeyB64);
}

export async function loadKeyPair(): Promise<KeyPair | null> {
  const priv = await idbGet(KEY_PRIV);
  const pub = await idbGet(KEY_PUB);
  if (!priv || !pub) return null;
  return { privateKeyB64: priv, publicKeyB64: pub };
}

export async function clearKeys(): Promise<void> {
  await idbDelete(KEY_PRIV);
  await idbDelete(KEY_PUB);
}

export async function hasKeys(): Promise<boolean> {
  return (await loadKeyPair()) !== null;
}

// ──────────────── 消息加密 / 解密 ────────────────

const PROTOCOL = 'v1';

/**
 * 加密一条消息发给 peer
 * 返回字符串：v1.<ephemeralPubB64>.<nonceB64>.<ciphertextB64>
 */
export async function encryptMessage(plaintext: string, peerPublicKeyB64: string): Promise<string> {
  const peerPub = b64ToBytes(peerPublicKeyB64);
  if (peerPub.length !== 32) throw new Error('peer public key length != 32');

  // ephemeral X25519 keypair（每条消息新生成 · PFS）
  const ephPriv = x25519.utils.randomPrivateKey();
  const ephPub = x25519.getPublicKey(ephPriv);

  // ECDH
  const shared = x25519.getSharedSecret(ephPriv, peerPub);
  // HKDF → AES-256 key
  const aesKeyBytes = hkdf(sha256, shared, undefined, 'loverush.msg.aes256gcm.v1', 32);
  const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes as unknown as ArrayBuffer, 'AES-GCM', false, ['encrypt']);

  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintextBytes);

  return [PROTOCOL, bytesToB64(ephPub), bytesToB64(nonce), bytesToB64(new Uint8Array(ciphertext))].join('.');
}

/**
 * 解密别人发来的消息（用我自己的静态私钥）
 */
export async function decryptMessage(blob: string, myPrivateKeyB64?: string): Promise<string> {
  const parts = blob.split('.');
  if (parts.length !== 4 || parts[0] !== PROTOCOL) {
    throw new Error('invalid encrypted blob');
  }
  const ephPub = b64ToBytes(parts[1]!);
  const nonce = b64ToBytes(parts[2]!);
  const ciphertext = b64ToBytes(parts[3]!);

  const privB64 = myPrivateKeyB64 ?? (await idbGet(KEY_PRIV));
  if (!privB64) throw new Error('no private key in IndexedDB');
  const myPriv = b64ToBytes(privB64);

  const shared = x25519.getSharedSecret(myPriv, ephPub);
  const aesKeyBytes = hkdf(sha256, shared, undefined, 'loverush.msg.aes256gcm.v1', 32);
  const aesKey = await crypto.subtle.importKey('raw', aesKeyBytes as unknown as ArrayBuffer, 'AES-GCM', false, ['decrypt']);

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as unknown as BufferSource },
    aesKey,
    ciphertext as unknown as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

/** 试探：判断是不是 v1 加密消息（用于聊天 UI 自动检测） */
export function isEncryptedBlob(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(s);
}
