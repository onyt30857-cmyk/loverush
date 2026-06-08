/**
 * Admin 图片上传工具 · M09a
 *
 * 轻量三步链路（不依赖 apps/web，admin 独立实现）：
 *   1. POST /admin/shop/media/upload-init → { mediaId, uploadUrl }
 *   2. fetch PUT uploadUrl，直传 R2
 *   3. POST /admin/shop/media/finalize   → { publicUrl }
 *
 * 仅支持 gallery 用途（jpeg/png/webp，≤20MB）。
 */

import { api } from './api';

/** 归一化 mime：去掉 `;codecs=...` 等参数后缀 */
export function baseMime(type: string): string {
  return (type || '').split(';')[0]!.trim().toLowerCase();
}

const GALLERY_MIME_WHITELIST = ['image/jpeg', 'image/png', 'image/webp'];
const GALLERY_MAX_BYTES = 20 * 1024 * 1024; // 20MB

function extOf(file: File): string {
  const m = file.name.match(/\.([a-z0-9]{1,8})$/i);
  return (m?.[1] ?? baseMime(file.type).split('/')[1] ?? 'bin').toLowerCase();
}

/**
 * 上传单张图片到 R2，返回 publicUrl。
 * 校验不通过或上传失败时 throw Error，调用方显示 error.message。
 */
export async function uploadImage(file: File): Promise<string> {
  const mime = baseMime(file.type);

  if (!GALLERY_MIME_WHITELIST.includes(mime)) {
    throw new Error(`不支持的格式 ${file.type || '未知'}，请选择 jpeg / png / webp`);
  }
  if (file.size > GALLERY_MAX_BYTES) {
    throw new Error(`文件超过 20MB 限制（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`);
  }

  // 1. 申请预签名 URL
  const init = await api.post<{ mediaId: string; uploadUrl: string }>(
    '/admin/shop/media/upload-init',
    { mime_type: mime, size_bytes: file.size, ext: extOf(file) },
  );

  // 2. 直传 R2（stub 模式下 uploadUrl 含 ?stub=1，直接跳过）
  const isStub =
    init.uploadUrl.includes('?stub=1') || init.uploadUrl.includes('r2-stub.local');
  if (!isStub) {
    const putRes = await fetch(init.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mime },
      body: file,
    });
    if (!putRes.ok) {
      throw new Error(`上传到 R2 失败 HTTP ${putRes.status}`);
    }
  }

  // 3. finalize → publicUrl
  const finalized = await api.post<{ publicUrl: string }>('/admin/shop/media/finalize', {
    media_id: init.mediaId,
    actual_size_bytes: file.size,
  });

  return finalized.publicUrl;
}
