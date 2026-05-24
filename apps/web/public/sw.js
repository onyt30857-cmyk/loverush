/**
 * LoveRush Service Worker
 *
 * 职责：
 *  1. Web Push 接收 + 显示通知（含模糊化兜底）
 *  2. notificationclick → 打开 deepLink
 *  3. install / activate 跳过等待，避免老 SW 缓存问题
 *
 * 不在本 SW 做：
 *  - 离线壳缓存（PWA 上线后单独发版加入 workbox）
 *  - 大文件预缓存
 */

const SW_VERSION = '0.1.0';

self.addEventListener('install', (event) => {
  console.log('[sw] install', SW_VERSION);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[sw] activate', SW_VERSION);
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: '新消息', body: '点击查看', url: '/', tag: 'default' };
  try {
    if (event.data) payload = event.data.json();
  } catch (e) {
    // 非 JSON · 用默认
  }

  const options = {
    body: payload.body ?? '',
    tag: payload.tag ?? 'loverush',
    badge: '/icons/icon-192.png',
    icon: payload.icon ?? '/icons/icon-192.png',
    data: { url: payload.url ?? '/' },
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(payload.title ?? 'LoveRush', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(url);
            } catch (e) {}
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
