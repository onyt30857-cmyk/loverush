'use client';

/**
 * ⚠ 一次性维护页 · 清空所有客户/技师账户
 *
 * 用于产品从 mnemonic 模式切换到账号密码模式时清旧账户。
 * 保留所有有 admin/cs/auditor 等角色的账户(后台管理员)。
 */

import { useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface ResetResp {
  deleted: number;
  kept_with_roles: number;
  remaining_total_users: number;
  invite_codes_reset: boolean;
}

const CONFIRM_PHRASE = 'I_KNOW_I_WILL_DELETE_ALL_DATA';

export default function ResetAccountsPage() {
  const [resetInviteCodes, setResetInviteCodes] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResetResp | null>(null);

  async function execute() {
    if (confirmText !== CONFIRM_PHRASE) {
      setError(`必须完整输入确认句:${CONFIRM_PHRASE}`);
      return;
    }
    if (!confirm(`⚠ 最后确认\n\n将永久删除所有客户/技师账户。\n点击「确定」=> 真删 · 不可撤销。`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<ResetResp>('/admin/_internal/reset-all-accounts', {
        confirm: CONFIRM_PHRASE,
        reset_invite_codes: resetInviteCodes,
      });
      setResult(data);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      else setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-rose-700">⚠ 重置所有客户/技师账户</h1>
        <p className="mt-1 text-xs text-ink-500">
          一次性维护操作 · 不可撤销 · 用于产品从 mnemonic 切换到账号密码模式
        </p>
      </div>

      {/* 警告框 */}
      <section className="card mb-4 border-rose-300 bg-rose-50">
        <h2 className="text-sm font-semibold text-rose-700">将删除什么</h2>
        <ul className="mt-2 list-inside list-disc text-xs text-rose-900">
          <li>所有 user_type = customer / therapist 的账户</li>
          <li>关联的:订单、支付流水、提现、小费、消息、媒体、AI 助理画像/记忆 等全部 CASCADE</li>
        </ul>
        <h2 className="mt-3 text-sm font-semibold text-emerald-700">会保留什么</h2>
        <ul className="mt-2 list-inside list-disc text-xs text-emerald-900">
          <li>所有有 admin / cs / auditor / finance / ops 角色的账户(后台管理员)</li>
          <li>系统配置 / 灰度开关 / 启动页配置 等系统级数据</li>
        </ul>
      </section>

      {/* 选项 */}
      <section className="card mb-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={resetInviteCodes}
            onChange={(e) => setResetInviteCodes(e.target.checked)}
            className="h-4 w-4 accent-rose-600"
          />
          <span>同时重置邀请码使用计数(used_count = 0)</span>
        </label>
        <p className="ml-6 mt-1 text-[10px] text-ink-500">
          建议勾选 · 旧用户消耗的邀请码可以再用
        </p>
      </section>

      {/* 输入确认 */}
      <section className="card mb-4">
        <label className="mb-2 block text-xs text-ink-700">
          请完整输入确认句 <code className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px]">{CONFIRM_PHRASE}</code>
        </label>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
          className="input w-full font-mono text-xs"
        />
      </section>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {result && (
        <section className="card mb-4 border-emerald-300 bg-emerald-50">
          <h2 className="text-sm font-semibold text-emerald-700">✓ 已完成</h2>
          <ul className="mt-2 text-xs text-emerald-900">
            <li>删除账户:{result.deleted} 个</li>
            <li>保留(有角色):{result.kept_with_roles} 个</li>
            <li>当前用户总数:{result.remaining_total_users} 个</li>
            <li>邀请码已重置:{result.invite_codes_reset ? '是' : '否'}</li>
          </ul>
        </section>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void execute()}
          disabled={busy || confirmText !== CONFIRM_PHRASE}
          className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {busy ? '执行中…' : '🗑 永久删除'}
        </button>
      </div>
    </AdminShell>
  );
}
