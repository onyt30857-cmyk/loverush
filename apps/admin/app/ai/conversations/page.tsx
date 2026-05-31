'use client';

/**
 * AI 对话审查 · M06 Phase 2
 *
 * Admin/auditor 看全量客户↔技师对话 · 用于:
 *   - 红线触发时看完整上下文(改写前/后都显)
 *   - AI 代发 vs 真人对比 · 判断 AI 质量
 *   - 加密消息: 显"🔐 加密内容 · admin 不可见"(后端自动 mask)
 *
 * 每次打开对话 = 后端自动写 admin_audit_log type='ai.view_conversation'
 */

import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api, ApiClientError } from '@/lib/api';

interface ConvRow {
  id: string;
  customer_id: string;
  therapist_user_id: string;
  last_message_at: string | null;
  message_count: number;
  status: string;
  customer_display_name: string | null;
  therapist_display_name: string | null;
  therapist_avatar_url: string | null;
  redline_count: number;
  ai_alter_count: number;
  encrypted_count: number;
}

interface MessageRow {
  id: string;
  sender_user_id: string;
  type: string;
  content_original: string;
  content_language: string | null;
  is_ai_alter: number;
  is_encrypted: number;
  redline_action: string | null;
  redline_flags: string[] | null;
  sent_at: string;
  sender_display_name: string | null;
  sender_avatar_url: string | null;
}

interface ConvDetail {
  conv: {
    id: string;
    customer_id: string;
    therapist_user_id: string;
    customer_display_name: string | null;
    therapist_display_name: string | null;
    therapist_avatar_url: string | null;
    ai_alter_enabled: number;
    ai_kill_switch_reason: string | null;
    ai_health_latest_score: number | null;
  };
  messages: MessageRow[];
}

export default function AdminAiConversationsPage() {
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 筛选
  const [therapistId, setTherapistId] = useState('');
  const [hasRedline, setHasRedline] = useState(false);
  const [hasAi, setHasAi] = useState(false);
  // 详情抽屉
  const [detail, setDetail] = useState<ConvDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ConvRow[]>('/admin/ai/conversations', {
        therapist_user_id: therapistId || undefined,
        has_redline: hasRedline ? 'true' : undefined,
        has_ai_alter: hasAi ? 'true' : undefined,
        limit: 50,
      });
      setConvs(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function openDetail(convId: string) {
    setDetailLoading(true);
    try {
      const data = await api.get<ConvDetail>(`/admin/ai/conversations/${convId}`);
      setDetail(data);
    } catch (err) {
      alert(err instanceof ApiClientError ? err.payload.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <AdminShell>
      <div className="p-6 max-w-7xl mx-auto">
        <h1 className="text-xl font-bold mb-2">AI 对话审查</h1>
        <div className="mb-4 text-sm text-gray-600">
          仅 admin / auditor 可见 · 每次打开对话会写 audit log
        </div>

        {/* 筛选 */}
        <div className="bg-white border rounded-lg p-4 mb-4 flex gap-3 items-end flex-wrap">
          <div>
            <label className="block text-xs text-gray-600 mb-1">技师 user ID</label>
            <input
              type="text"
              value={therapistId}
              onChange={(e) => setTherapistId(e.target.value)}
              placeholder="UUID(可空)"
              className="border rounded px-3 py-1.5 text-sm w-72"
            />
          </div>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={hasRedline} onChange={(e) => setHasRedline(e.target.checked)} />
            仅含红线
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={hasAi} onChange={(e) => setHasAi(e.target.checked)} />
            仅含 AI 代发
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm"
            disabled={loading}
          >
            {loading ? '加载中…' : '搜索'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-3 text-sm">
            {error}
          </div>
        )}

        {/* 列表 */}
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2">技师 / 客户</th>
                <th className="text-center px-3 py-2">消息数</th>
                <th className="text-center px-3 py-2 text-red-700">⚠ 红线</th>
                <th className="text-center px-3 py-2 text-purple-700">🤖 AI 代发</th>
                <th className="text-center px-3 py-2">🔐 加密</th>
                <th className="text-left px-3 py-2">最近消息</th>
                <th className="text-right px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {convs.map((c) => (
                <tr key={c.id} className="border-b hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {c.therapist_avatar_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.therapist_avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                      )}
                      <div>
                        <div className="font-medium">{c.therapist_display_name ?? '(无名)'}</div>
                        <div className="text-xs text-gray-500">↔ {c.customer_display_name ?? '(无名)'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-center">{c.message_count}</td>
                  <td className="text-center">
                    {c.redline_count > 0 ? (
                      <span className="text-red-600 font-semibold">{c.redline_count}</span>
                    ) : (
                      <span className="text-gray-300">0</span>
                    )}
                  </td>
                  <td className="text-center">
                    {c.ai_alter_count > 0 ? (
                      <span className="text-purple-600">{c.ai_alter_count}</span>
                    ) : (
                      <span className="text-gray-300">0</span>
                    )}
                  </td>
                  <td className="text-center text-gray-500">{c.encrypted_count > 0 ? c.encrypted_count : '—'}</td>
                  <td className="text-xs text-gray-600">
                    {c.last_message_at ? new Date(c.last_message_at).toLocaleString('zh-CN') : '—'}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => void openDetail(c.id)}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      查看对话
                    </button>
                  </td>
                </tr>
              ))}
              {convs.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="text-center text-gray-400 py-8">没有符合条件的对话</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 详情抽屉 · modal */}
      {detail && (
        <div
          className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setDetail(null)}
        >
          <div
            className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 抽屉头 */}
            <div className="border-b p-4 flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-3">
                {detail.conv.therapist_avatar_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={detail.conv.therapist_avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                )}
                <div>
                  <div className="font-semibold">{detail.conv.therapist_display_name}</div>
                  <div className="text-xs text-gray-500">↔ {detail.conv.customer_display_name}</div>
                  <div className="text-xs mt-0.5 flex gap-2 items-center">
                    <span>AI 分身:</span>
                    {detail.conv.ai_alter_enabled === 1 ? (
                      <span className="text-green-600">启用</span>
                    ) : (
                      <span className="text-red-600">已关闭{detail.conv.ai_kill_switch_reason ? ` · ${detail.conv.ai_kill_switch_reason}` : ''}</span>
                    )}
                    {detail.conv.ai_health_latest_score != null && (
                      <span>· 健康度 {detail.conv.ai_health_latest_score}</span>
                    )}
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>

            {/* 消息列表 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {detail.messages.length === 0 ? (
                <div className="text-center text-gray-400 py-8">没有消息</div>
              ) : (
                detail.messages.map((m) => {
                  const isTherapist = m.sender_user_id === detail.conv.therapist_user_id;
                  return (
                    <div key={m.id} className={`flex gap-2 ${isTherapist ? 'flex-row' : 'flex-row-reverse'}`}>
                      {m.sender_avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.sender_avatar_url} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-300 flex-shrink-0" />
                      )}
                      <div className={`max-w-[70%] ${isTherapist ? '' : 'text-right'}`}>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-0.5">
                          <span>{m.sender_display_name}</span>
                          {m.is_ai_alter === 1 && (
                            <span className="bg-purple-100 text-purple-700 px-1 rounded text-[10px]">AI 代发</span>
                          )}
                          {m.redline_action && m.redline_action !== 'pass' && (
                            <span className="bg-red-100 text-red-700 px-1 rounded text-[10px]">
                              ⚠ {m.redline_action}{m.redline_flags ? ` · ${m.redline_flags.join(',')}` : ''}
                            </span>
                          )}
                          {m.is_encrypted === 1 && <span className="text-gray-400">🔐</span>}
                          <span>· {new Date(m.sent_at).toLocaleTimeString('zh-CN')}</span>
                        </div>
                        <div className={`inline-block px-3 py-2 rounded-2xl text-sm ${
                          m.is_encrypted === 1
                            ? 'bg-gray-200 text-gray-600 italic'
                            : isTherapist
                              ? 'bg-white border'
                              : 'bg-blue-500 text-white'
                        }`}>
                          {m.content_original}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t p-3 text-center text-xs text-gray-400">
              已写入 audit log · type=ai.view_conversation · target={detail.conv.id.slice(0, 8)}
            </div>
          </div>
        </div>
      )}

      {detailLoading && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center">
          <div className="bg-white px-6 py-3 rounded shadow">加载对话中…</div>
        </div>
      )}
    </AdminShell>
  );
}
