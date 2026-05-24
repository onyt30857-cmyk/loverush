/**
 * PWA / Service Worker / Web Push 客户端 hook
 *
 * 用法：
 *   import { registerSW, subscribePush } from '@/lib/pwa';
 *   useEffect(() => { void registerSW(); }, []);
 *   <button onClick={() => subscribePush()}>开启推送</button>
 */

import { apiPost } from './api';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    return reg;
  } catch (err) {
    console.error('[pwa] sw register failed:', err);
    return null;
  }
}

export async function subscribePush(): Promise<{ ok: boolean; reason?: string }> {
  if (typeof window === 'undefined') return { ok: false, reason: 'ssr' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' };
  }
  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, reason: 'no_vapid_public_key' };
  }

  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // TS 5.x ArrayBuffer 类型收紧（Uint8Array<ArrayBufferLike> ≠ ArrayBuffer）
      // applicationServerKey 接受 BufferSource，但 TS 5.6 严格之后要 unknown 中转
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: 'bad_subscription' };
  }

  await apiPost('/notifications/web-push/subscribe', {
    endpoint: json.endpoint,
    p256dh_key: json.keys.p256dh,
    auth_key: json.keys.auth,
    user_agent: navigator.userAgent,
  });

  return { ok: true };
}

export async function unsubscribePush(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await apiPost('/notifications/web-push/unsubscribe', { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
}
