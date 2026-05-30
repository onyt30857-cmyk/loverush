/**
 * 客户个人资料编辑 · /me/profile
 *
 * 功能:
 *   - 头像上传(MediaUploader · basePath='/me' · purpose='avatar')
 *   - 昵称(display_name)输入,1-40 字符
 *   - 保存 → PATCH /me { display_name, avatar_url }
 *   - 双端共用此页(技师也可走,但本页只供客户;技师走 /t/me/profile)
 */
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check } from 'lucide-react';
import { Avatar } from '@/components/ui';
import { MediaUploader } from '@/components/upload/MediaUploader';
import { ApiClientError, apiPatch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface PatchMeResp {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  locale: string | null;
}

export default function MeProfileEditPage() {
  const router = useRouter();
  const { user, loading, refresh } = useAuth();
  const [displayName, setDisplayName] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // 初始化:从 useAuth 拉当前值
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName ?? '');
      setAvatarUrl(user.avatarUrl ?? null);
    }
  }, [user]);

  function validate(): string | null {
    const n = displayName.trim();
    if (n.length === 0) return '昵称不能为空';
    if (n.length > 40) return '昵称最长 40 字符';
    return null;
  }

  async function handleSave() {
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSaving(true);
    try {
      const patch: Record<string, string> = {};
      const n = displayName.trim();
      if (n !== (user?.displayName ?? '')) patch.display_name = n;
      const a = avatarUrl ?? '';
      if (a !== (user?.avatarUrl ?? '')) patch.avatar_url = a;
      if (Object.keys(patch).length === 0) {
        // 无改动 · 直接返回
        router.replace('/me');
        return;
      }
      await apiPatch<PatchMeResp>('/me', patch);
      await refresh();
      setSavedFlash(true);
      setTimeout(() => router.replace('/me'), 600);
    } catch (e) {
      if (e instanceof ApiClientError) {
        setError(`${e.payload.code} · ${e.payload.message}`);
      } else {
        setError(String((e as Error).message));
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mobile-container flex h-screen items-center justify-center">
        <span className="text-[12px] text-ink-400">加载中…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mobile-container flex h-screen flex-col items-center justify-center px-8 text-center">
        <p className="text-[13px] text-ink-500">先登录</p>
        <button
          type="button"
          onClick={() => router.replace('/login')}
          className="mt-4 rounded-full bg-gradient-cta px-6 py-2 text-[13px] font-medium text-white"
        >
          去登录
        </button>
      </div>
    );
  }

  const fallback = (displayName || user.displayName || '🙂').slice(0, 1);

  return (
    <div className="mobile-container flex min-h-screen flex-col bg-gradient-soft">
      {/* 顶部 */}
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-warm-100 bg-white/95 px-3 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="返回"
          className="-ml-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-500 active:bg-ink-100"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="flex-1 text-center text-[14px] font-semibold text-ink-800">编辑资料</h1>
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="rounded-full bg-gradient-cta px-4 py-1.5 text-[12px] font-semibold text-white shadow-rose-md disabled:opacity-50"
        >
          {saving ? '保存中…' : savedFlash ? '已保存' : '保存'}
        </button>
      </header>

      {/* 头像上传 */}
      <section className="flex flex-col items-center gap-3 px-6 pt-8 pb-6">
        <MediaUploader
          purpose="avatar"
          basePath="/me"
          onComplete={(asset) => {
            if (asset.publicUrl) setAvatarUrl(asset.publicUrl);
          }}
          className="flex flex-col items-center"
        >
          <div className="relative">
            <Avatar size={96} src={avatarUrl ?? undefined} fallback={fallback} />
            <div className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-gradient-cta text-white shadow-rose-md ring-2 ring-white">
              <span className="text-[11px]">✎</span>
            </div>
          </div>
        </MediaUploader>
        <div className="text-center text-[10.5px] text-ink-400">
          点击头像更换 · 上限 5 MB · JPG / PNG / WebP
        </div>
        {avatarUrl ? (
          <button
            type="button"
            onClick={() => setAvatarUrl('')}
            className="text-[11px] text-ink-400 underline-offset-2 hover:text-ink-600 hover:underline"
          >
            移除头像
          </button>
        ) : null}
      </section>

      {/* 昵称表单 */}
      <section className="px-5 pb-8">
        <label className="mb-1.5 block text-[11px] font-medium text-ink-700">
          昵称 <span className="text-ink-400">(1-40 字符)</span>
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value.slice(0, 40))}
          maxLength={40}
          placeholder="给自己起个名字"
          className="w-full rounded-xl border border-warm-100 bg-white px-4 py-3 text-sm outline-none focus:border-primary"
        />
        <div className="mt-1 text-right text-[10px] text-ink-400">{displayName.length} / 40</div>

        <div className="mt-3 rounded-xl border border-warm-100 bg-white/70 px-3 py-2.5 text-[11px] text-ink-500 leading-relaxed">
          昵称是技师在接到你的咨询时看到的"客户名片" · 写一个你愿意被叫的名字 · 不要写手机号 / 真名。
        </div>

        {error ? (
          <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[12px] text-primary">
            {error}
          </div>
        ) : null}
      </section>

      {/* 底部账号信息 */}
      <section className="mx-5 mb-8 mt-auto rounded-2xl border border-warm-100 bg-white/60 px-4 py-3 text-[11px] leading-6 text-ink-500">
        <div className="flex items-center justify-between">
          <span className="text-ink-400">账号 ID</span>
          <span className="font-mono text-ink-600">{user.id.slice(0, 14)}…</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-400">类型</span>
          <span className="text-ink-700">{user.userType === 'customer' ? '客户' : '技师'}</span>
        </div>
        {savedFlash ? (
          <div className="mt-2 flex items-center gap-1 text-emerald-600">
            <Check className="h-3 w-3" />
            <span>保存成功 · 返回主页</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
