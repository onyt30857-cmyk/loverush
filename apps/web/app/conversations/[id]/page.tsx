'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { ErrorBanner, LoadingFull } from '@/components/ui';
import { apiGet, apiPost, ApiClientError, getAccessToken } from '@/lib/api';
import { decryptMessage, encryptMessage, hasKeys, isEncryptedBlob } from '@/lib/crypto';

interface Conversation {
  id: string;
  customerId: string;
  therapistUserId: string;
}

interface Message {
  id: string;
  conversationId: string;
  senderUserId: string;
  type: string;
  contentOriginal: string | null;
  contentLanguage: string | null;
  isAiAlter: number;
  isEncrypted: number;
  sentAt: string;
  readAt: string | null;
  translation?: { translatedText: string; cultureNotes: Array<{ phrase: string; note: string }> } | null;
}

function parseJwtSub(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? ''));
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [e2eEnabled, setE2eEnabled] = useState(false);
  const [peerPubKey, setPeerPubKey] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setMe(parseJwtSub(getAccessToken()));
  }, []);

  // 加载对话元信息（获取对方 user_id）+ 对方公钥
  useEffect(() => {
    void (async () => {
      try {
        const list = await apiGet<Conversation[]>('/conversations');
        const target = list.find((c) => c.id === id);
        if (target) setConv(target);
        // 拉对方公钥（如果对方已派生过 e2e key 就拿到 base64 pub）
        const myId = parseJwtSub(getAccessToken());
        if (target && myId) {
          const peerId = target.customerId === myId ? target.therapistUserId : target.customerId;
          try {
            const r = await apiGet<{ algorithm: string; public_key: string } | null>(`/users/${peerId}/encryption-key`);
            if (r?.public_key) setPeerPubKey(r.public_key);
          } catch {}
        }
      } catch {}
    })();
  }, [id]);

  async function load(silent = false) {
    try {
      const list = await apiGet<Message[]>(`/conversations/${id}/messages`, { limit: 50 });
      setMessages(list);
      if (!silent) setLoading(false);
      await apiPost(`/conversations/${id}/read`).catch(() => {});

      // 解密 isEncrypted=1 的消息
      const hasMyKey = await hasKeys();
      if (hasMyKey) {
        const updates: Record<string, string> = {};
        for (const m of list) {
          if (m.isEncrypted === 1 && m.contentOriginal && !decrypted[m.id] && isEncryptedBlob(m.contentOriginal)) {
            try {
              updates[m.id] = await decryptMessage(m.contentOriginal);
            } catch {
              updates[m.id] = '【解密失败 · 请检查密钥】';
            }
          }
        }
        if (Object.keys(updates).length > 0) setDecrypted((prev) => ({ ...prev, ...updates }));
      }
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    pollRef.current = setInterval(() => void load(true), 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function send() {
    const text = input.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    setInput('');
    try {
      if (e2eEnabled && peerPubKey) {
        const blob = await encryptMessage(text, peerPubKey);
        await apiPost(`/conversations/${id}/messages`, { text: blob, is_encrypted: true });
      } else {
        await apiPost(`/conversations/${id}/messages`, { text });
      }
      await load(true);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  if (loading) return <AppShell title="对话" showBack hideTabBar><LoadingFull /></AppShell>;

  return (
    <AppShell title="对话" showBack hideTabBar>
      <ErrorBanner message={error} />
      <div className="flex h-[calc(100vh-7rem)] flex-col bg-gradient-soft">
        <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.map((m, i) => {
            const mine = m.senderUserId === me;
            let text: string;
            if (m.isEncrypted === 1) {
              text = decrypted[m.id] ?? '🔐 解密中…';
            } else {
              text = m.translation?.translatedText ?? m.contentOriginal ?? '';
            }
            return (
              <div
                key={m.id}
                className={`flex items-end gap-2 animate-fade-up ${mine ? 'flex-row-reverse' : ''}`}
                style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
              >
                <div className={mine ? 'msg-bubble-mine' : 'msg-bubble-other'}>
                  <div>{text}</div>
                  {m.isEncrypted === 1 && (
                    <div className={`mt-1.5 text-[10px] ${mine ? 'text-white/70' : 'text-warm-500'}`}>🔐 端到端加密</div>
                  )}
                  {m.translation && m.translation.cultureNotes.length > 0 && (
                    <div className={`mt-1.5 space-y-0.5 border-t border-current/10 pt-1.5 text-[11px] ${mine ? 'text-white/80' : 'text-ink-600'}`}>
                      {m.translation.cultureNotes.map((n, i) => (
                        <div key={i}>
                          <strong>{n.phrase}</strong> · {n.note}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={`mt-1 text-[9.5px] tracking-wider ${mine ? 'text-white/60' : 'text-ink-300'}`}>
                    {new Date(m.sentAt).toLocaleTimeString().slice(0, 5)}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-warm-100 bg-white/95 px-3 pb-3 pt-2 backdrop-blur">
          <div className="mb-1.5 flex items-center justify-between text-[10px]">
            <label className="flex cursor-pointer items-center gap-1.5 text-ink-600">
              <input
                type="checkbox"
                checked={e2eEnabled}
                onChange={(e) => setE2eEnabled(e.target.checked)}
                disabled={!peerPubKey}
                className="h-3 w-3 accent-primary"
              />
              <span>🔐 端到端加密</span>
              {!peerPubKey && <span className="text-ink-300">（对方未启用）</span>}
              {e2eEnabled && <span className="text-cormorant text-warm-500">· 关闭翻译</span>}
            </label>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-ink-50 px-3 py-1.5">
            <input
              className="flex-1 bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-300"
              placeholder={e2eEnabled ? '加密发送…' : '说点什么…'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !input.trim()}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-cta text-white shadow-rose-md disabled:opacity-50"
              aria-label="发送"
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
