'use client';

/**
 * AI Kill Switch · M06 Phase 2
 *
 * Admin 一键关闭某技师的 AI 分身(平台强制 · 不需要技师配合)
 * 用于: AI 屡犯红线 / 复读机 / 客户投诉激增 等紧急止损
 *
 * 已关闭列表 + 恢复(取消 kill)
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface KilledRow {
  user_id: string;
  ai_kill_switch_reason: string;
  therapist_display_name: string | null;
  therapist_avatar_url: string | null;
  verification_status: string;
  killed_at: string;
}

export default function AdminAiKillSwitchPage() {
  const [killed, setKilled] = useState<KilledRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 关闭表单
  const [targetIds, setTargetIds] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<KilledRow[]>(`/admin/ai/kill-switch/list`);
      setKilled(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function handleKill() {
    const ids = targetIds.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return alert('请输入至少一个技师 user ID');
    if (reason.trim().length < 3) return alert('原因至少 3 个字');
    if (!confirm(`确定关闭 ${ids.length} 个技师的 AI 分身?\n\n原因: ${reason}\n\n会立即生效 · 写 audit log`)) return;
    setBusy(true);
    try {
      const result = await api.post<{ affected: number; therapistUserIds: string[] }>(
        '/admin/ai/kill-switch',
        { therapist_user_ids: ids, reason },
      );
      alert(`✓ 已关闭 ${result.affected} 个 AI 分身`);
      setTargetIds('');
      setReason('');
      await load();
    } catch (err) {
      alert(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(userId: string, displayName: string | null) {
    if (!confirm(`恢复 ${displayName ?? userId.slice(0, 8)} 的 AI 分身?`)) return;
    try {
      await api.post<{ affected: number }>(
        '/admin/ai/kill-switch/restore',
        { therapist_user_ids: [userId] },
      );
      await load();
    } catch (err) {
      alert(err instanceof ApiClientError ? err.payload.message : String(err));
    }
  }

  return (
    <AdminShell>
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-xl font-bold mb-2">AI Kill Switch</h1>
        <div className="mb-4 text-sm text-gray-600">
          仅 admin 可见 · 关闭后技师 AI 分身停止回复 · 每次操作写 audit log
        </div>

        {/* 关闭表单 */}
        <div className="bg-white border rounded-lg p-5 mb-6">
          <div className="text-base font-semibold mb-3">关闭 AI 分身</div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">技师 user IDs (用逗号或空格分隔 · 最多 50 个)</label>
              <textarea
                value={targetIds}
                onChange={(e) => setTargetIds(e.target.value)}
                placeholder="9b6fb3bf-9013-4ccc-81a3-da42f099902d, 5688b3ba-... 或换行分隔"
                rows={3}
                className="w-full border rounded px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">关闭原因 (将被记入 audit log + 给技师看)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="如:近 7 天红线触发 12 次 · 暂停整改"
                rows={2}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleKill()}
              disabled={busy || !targetIds.trim() || reason.trim().length < 3}
              className="bg-red-600 text-white px-5 py-2 rounded font-semibold disabled:bg-gray-300"
            >
              {busy ? '处理中…' : '紧急关闭 AI 分身'}
            </button>
          </div>
        </div>

        {/* 已关闭列表 */}
        <div className="bg-white border rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b bg-gray-50 text-sm font-medium">
            当前被关闭的 AI 分身 · {killed.length} 个
          </div>
          {loading && <div className="p-4 text-center text-gray-400 text-sm">加载中…</div>}
          {error && <div className="p-3 bg-red-50 text-red-700 text-sm">{error}</div>}
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2">技师</th>
                <th className="text-left px-3 py-2">关闭原因</th>
                <th className="text-left px-3 py-2">关闭时间</th>
                <th className="text-right px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {killed.map((k) => (
                <tr key={k.user_id} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {k.therapist_avatar_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={k.therapist_avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                      )}
                      <div>
                        <div className="font-medium">{k.therapist_display_name ?? '(无名)'}</div>
                        <div className="text-xs text-gray-400 font-mono">{k.user_id.slice(0, 8)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-gray-700">{k.ai_kill_switch_reason}</td>
                  <td className="text-xs text-gray-500">{new Date(k.killed_at).toLocaleString('zh-CN')}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => void handleRestore(k.user_id, k.therapist_display_name)}
                      className="text-green-600 hover:underline text-xs"
                    >
                      恢复 AI
                    </button>
                  </td>
                </tr>
              ))}
              {killed.length === 0 && !loading && (
                <tr><td colSpan={4} className="text-center text-gray-400 py-6">没有被关闭的 AI · 全部正常</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
