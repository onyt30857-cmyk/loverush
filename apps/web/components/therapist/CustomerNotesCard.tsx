'use client';

/**
 * 技师·客户备注卡(P1)· 在订单详情里给技师记住客人(昵称/备注),复购引擎。
 * 复用 customer_relationship_profile 的 privateNotes/customerNickname(只对该技师可见)。
 */

import { useEffect, useState } from 'react';
import { apiGet, apiPut, ApiClientError } from '@/lib/api';

interface Notes {
  privateNotes: string | null;
  customerNickname: string | null;
  privateTags: string[];
}

export function CustomerNotesCard({ customerId }: { customerId: string }) {
  const [nickname, setNickname] = useState('');
  const [notes, setNotes] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [orig, setOrig] = useState({ nickname: '', notes: '' });

  useEffect(() => {
    void (async () => {
      try {
        const d = await apiGet<Notes>(`/therapists/me/customers/${customerId}/notes`);
        setNickname(d.customerNickname ?? '');
        setNotes(d.privateNotes ?? '');
        setOrig({ nickname: d.customerNickname ?? '', notes: d.privateNotes ?? '' });
      } catch {
        /* 取不到按空 */
      } finally {
        setLoaded(true);
      }
    })();
  }, [customerId]);

  const dirty = loaded && (nickname !== orig.nickname || notes !== orig.notes);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await apiPut(`/therapists/me/customers/${customerId}/notes`, {
        customer_nickname: nickname.trim() || null,
        private_notes: notes.trim() || null,
      });
      setOrig({ nickname, notes });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      if (err instanceof ApiClientError) alert(err.payload.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
      <div className="flex items-center justify-between">
        <div className="text-serif-cn text-sm font-semibold text-ink-800">客户备注</div>
        <span className="text-[10px] text-ink-400">只有你看得到</span>
      </div>
      <div className="mt-3 space-y-2.5">
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="给 TA 起个昵称(如 阿强 / 老板)"
          maxLength={40}
          className="w-full rounded-xl bg-ink-50 px-3 py-2 text-[13.5px] text-ink-800 outline-none placeholder:text-ink-300"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="记下 TA 的偏好/忌讳/上次聊到的事,下次直接续上(如:喜欢重手法、怕痒、上次说要带朋友)"
          maxLength={2000}
          rows={3}
          className="w-full resize-none rounded-xl bg-ink-50 px-3 py-2 text-[13px] leading-[1.6] text-ink-800 outline-none placeholder:text-ink-300"
        />
        {(dirty || saved) && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="w-full rounded-full bg-gradient-cta py-2 text-[13px] font-medium text-white shadow-rose-md transition active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? '保存中…' : saved ? '已保存 ✓' : '保存备注'}
          </button>
        )}
      </div>
    </div>
  );
}
