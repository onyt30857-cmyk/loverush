'use client';
/**
 * M18 声音复刻管理
 * 列技师语音样本 + 复刻状态(引擎/是否已克隆) · 试听 · 重置(强制重克隆)
 */
import { useEffect, useState } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { api } from '@/lib/api';

interface VoiceRow {
  userId: string;
  displayName: string | null;
  verificationStatus: string;
  sampleUrl: string | null;
  hasSample: boolean;
  cloned: boolean;
  engine: 'elevenlabs' | 'openai' | 'none';
}

const ENGINE_LABEL: Record<VoiceRow['engine'], string> = {
  elevenlabs: '本人克隆 (ElevenLabs)',
  openai: '通用女声 (OpenAI)',
  none: '不可用',
};
const ENGINE_COLOR: Record<VoiceRow['engine'], string> = {
  elevenlabs: 'bg-green-100 text-green-700',
  openai: 'bg-amber-100 text-amber-700',
  none: 'bg-gray-100 text-gray-500',
};

export default function VoiceClonePage() {
  const [rows, setRows] = useState<VoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await api.get<VoiceRow[]>('/admin/voice-clones'));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function doPreview(userId: string) {
    setBusy(userId); setErr(null); setPreview(null);
    try {
      const r = await api.post<{ audioUrl: string }>(`/admin/voice-clones/${userId}/preview`);
      setPreview(r.audioUrl);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function doReset(userId: string) {
    if (!window.confirm('清掉该技师的克隆 voice_id？下次发声会重新克隆。')) return;
    setBusy(userId); setErr(null);
    try {
      await api.post(`/admin/voice-clones/${userId}/reset`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const engineNow = rows[0]?.engine ?? 'none';

  return (
    <AdminShell>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-bold">声音复刻</h1>
          <p className="text-sm text-gray-500 mt-1">
            技师上传的「语音介绍」即 AI 分身的声音样本。当前发声引擎：
            <span className={`ml-1 px-2 py-0.5 rounded text-xs ${ENGINE_COLOR[engineNow]}`}>{ENGINE_LABEL[engineNow]}</span>
            <span className="ml-2 text-gray-400">（配 ELEVENLABS_API_KEY 后自动升级为本人克隆）</span>
          </p>
        </div>

        {err && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{err}</div>}
        {preview && (
          <div className="mb-3 flex items-center gap-3 rounded bg-rose-50 px-3 py-2">
            <span className="text-sm text-rose-700">试听：</span>
            <audio src={preview} controls autoPlay className="h-8" />
          </div>
        )}

        {loading ? (
          <div className="text-gray-400 py-10 text-center">加载中…</div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 pr-3">技师</th>
                <th className="py-2 pr-3">核验</th>
                <th className="py-2 pr-3">语音样本</th>
                <th className="py-2 pr-3">引擎</th>
                <th className="py-2 pr-3">已克隆</th>
                <th className="py-2 pr-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId} className="border-b hover:bg-gray-50">
                  <td className="py-2 pr-3 font-medium">{r.displayName ?? '—'}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${r.verificationStatus === 'passed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {r.verificationStatus}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    {r.sampleUrl ? <audio src={r.sampleUrl} controls className="h-7 w-44" preload="none" /> : <span className="text-gray-400">无样本</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${ENGINE_COLOR[r.engine]}`}>{ENGINE_LABEL[r.engine]}</span>
                  </td>
                  <td className="py-2 pr-3">{r.cloned ? '✅' : '—'}</td>
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => void doPreview(r.userId)}
                      disabled={busy === r.userId || r.engine === 'none'}
                      className="mr-2 rounded bg-rose-500 px-2.5 py-1 text-xs text-white disabled:opacity-40"
                    >
                      {busy === r.userId ? '合成中…' : '试听'}
                    </button>
                    <button
                      onClick={() => void doReset(r.userId)}
                      disabled={busy === r.userId || !r.cloned}
                      className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-600 disabled:opacity-40"
                    >
                      重置克隆
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminShell>
  );
}
