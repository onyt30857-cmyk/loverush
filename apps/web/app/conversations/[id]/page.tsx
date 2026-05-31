'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Globe } from 'lucide-react';
import { ErrorBanner, LoadingFull, Avatar } from '@/components/ui';
import { ChatHeader } from '@/components/chat/ChatHeader';
import {
  TRANSLATE_LANG_LABEL,
  type TranslateLang,
} from '@/components/chat/TranslateLangSheet';
import { apiGet, apiPost, ApiClientError, getAccessToken } from '@/lib/api';
import { decryptMessage, encryptMessage, hasKeys, isEncryptedBlob } from '@/lib/crypto';
import { useAuth } from '@/lib/auth';
import { useServerEvents } from '@/lib/sse';

// 翻译语言选择 BottomSheet 懒加载 · 点击才下载
const TranslateLangSheet = dynamic(
  () => import('@/components/chat/TranslateLangSheet').then((m) => m.TranslateLangSheet),
  { ssr: false },
);

interface Conversation {
  id: string;
  customerId: string;
  therapistUserId: string;
  // 后端新增 · 对方身份(/conversations 列表项已附带)
  counterpartyUserId?: string;
  counterpartyDisplayName?: string | null;
  counterpartyAvatarUrl?: string | null;
  /** 客户视角才有 · 点 chat header 跳 /therapist/[id] 用 */
  counterpartyTherapistId?: string | null;
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
  redlineAction?: 'pass' | 'rewrite' | 'block' | null;
  translation?: { translatedText: string; cultureNotes: Array<{ phrase: string; note: string }> } | null;
  // 后端新增 · 发送方身份(气泡侧头像)
  senderDisplayName?: string | null;
  senderAvatarUrl?: string | null;
  // 乐观渲染 · client-only 状态: sending=灰转圈 · failed=红叹号可重发 · undefined=已确认入库
  _status?: 'sending' | 'failed';
  _origText?: string; // failed 时保留原文以便重发
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
  const router = useRouter();
  const { user } = useAuth();
  const myLocale = (user?.locale ?? 'zh') as string;
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});
  // M05 Phase 1 · 加密消息客户端按需翻译 · 仅 React state · 不持久化(保 E2E 隐私)
  const [ephemeralTranslation, setEphemeralTranslation] = useState<
    Record<string, { text: string; cultureNotes: Array<{ phrase: string; note: string }> }>
  >({});
  /**
   * 翻译目标语言 · 默认用户 locale · 'off' = 不翻译
   * 持久化到 localStorage(key=chat_translate_lang) · 跨会话保留
   */
  const [translateLang, setTranslateLang] = useState<TranslateLang>(
    (user?.locale as TranslateLang) ?? 'zh',
  );
  const [translateSheetOpen, setTranslateSheetOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [e2eEnabled, setE2eEnabled] = useState(false);
  const [peerPubKey, setPeerPubKey] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const typingTimer = useRef<NodeJS.Timeout | null>(null);

  const autoTranslate = translateLang !== 'off';

  // 从 localStorage 恢复翻译语言
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = window.localStorage.getItem('chat_translate_lang');
    if (v && ['off', 'zh', 'en', 'th', 'vi', 'ms', 'id'].includes(v)) {
      setTranslateLang(v as TranslateLang);
    } else {
      // 老版本迁移 · 旧 chat_auto_translate=1 → 用 myLocale, =0 → off
      const old = window.localStorage.getItem('chat_auto_translate');
      if (old === '0') setTranslateLang('off');
    }
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('chat_translate_lang', translateLang);
    // 用户切语言 · 清掉旧 ephemeral 翻译 cache · 下次 load 重新翻译成新语言
    setEphemeralTranslation({});
  }, [translateLang]);

  // 切语言后立刻 reload 一次 · 触发新的翻译
  useEffect(() => {
    if (loading) return;
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translateLang]);

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

        // 加密消息客户端按需翻译(translateLang 选了非 off · 对方语言 ≠ 我选的)
        if (autoTranslate) {
          for (const m of list) {
            if (m.isEncrypted === 1 && m.senderUserId !== me && updates[m.id] && !ephemeralTranslation[m.id]) {
              const plaintext = updates[m.id];
              if (plaintext === '【解密失败 · 请检查密钥】') continue;
              void (async () => {
                try {
                  const res = await apiPost<{
                    text: string;
                    cultureNotes: Array<{ phrase: string; note: string }>;
                  }>('/translate', {
                    text: plaintext,
                    tgt_lang: translateLang,
                  });
                  setEphemeralTranslation((prev) => ({
                    ...prev,
                    [m.id]: { text: res.text, cultureNotes: res.cultureNotes ?? [] },
                  }));
                } catch {
                  // 翻译失败静默
                }
              })();
            }
          }
        }
      }

      // 明文消息按用户选的语言翻译(后端预存的可能是不同 locale 的翻译)
      // 仅当 translateLang !== user.locale 时才走 ephemeral · 否则用后端预存的 m.translation
      if (autoTranslate && translateLang !== myLocale) {
        for (const m of list) {
          if (
            m.isEncrypted !== 1 &&
            m.senderUserId !== me &&
            m.contentOriginal &&
            // 放宽:contentLanguage 缺失也尝试翻译(老消息字段空)
            // 仅当明确知道是同一语言时才跳过
            (!m.contentLanguage || m.contentLanguage !== translateLang) &&
            !ephemeralTranslation[m.id]
          ) {
            const plaintext = m.contentOriginal;
            void (async () => {
              try {
                const res = await apiPost<{
                  text: string;
                  cultureNotes: Array<{ phrase: string; note: string }>;
                }>('/translate', {
                  text: plaintext,
                  tgt_lang: translateLang,
                });
                setEphemeralTranslation((prev) => ({
                  ...prev,
                  [m.id]: { text: res.text, cultureNotes: res.cultureNotes ?? [] },
                }));
              } catch {
                // 失败静默
              }
            })();
          }
        }
      }
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // M05 Phase 2 · SSE 取代 5s polling · 改为 30s 兜底(SSE 断时不超过 30s 拉到)
    pollRef.current = setInterval(() => void load(true), 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // M05 Phase 2 · SSE 实时推送 · 收到该会话新消息立即增量拉
  useServerEvents((event, data) => {
    if (event === 'chat_message') {
      const payload = data as { conversationId?: string } | null;
      if (payload?.conversationId === id) {
        setPeerTyping(false); // 收到新消息 → 清除"正在输入"
        void load(true);
      }
    }
    if (event === 'typing') {
      const p = data as { conversationId?: string; isTyping?: boolean } | null;
      if (p?.conversationId === id) {
        setPeerTyping(!!p.isTyping);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        if (p.isTyping) {
          // 兜底：12s 没等到消息就自动收起（防生成失败时一直显示）
          typingTimer.current = setTimeout(() => setPeerTyping(false), 12000);
        }
      }
    }
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function send() {
    const text = input.trim();
    if (!text) return;

    // ────────────────── 乐观渲染 (Tony 铁律: 任何 mutation 必 instant 反馈) ──────────────────
    //   ① 立刻清输入框 + 把消息插进列表(status=sending) · 用户即时看到自己的气泡
    //   ② 后台 POST · 成功用真实 msg 替换 temp · 失败转 status=failed 显重发按钮
    //   ③ 不再 await load(true) 二次 GET 整列表 (省 300-800ms)
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tempMsg: Message = {
      id: tempId,
      conversationId: id ?? '',
      senderUserId: me ?? '',
      type: 'text',
      contentOriginal: text,
      contentLanguage: myLocale,
      isAiAlter: 0,
      isEncrypted: e2eEnabled ? 1 : 0,
      sentAt: new Date().toISOString(),
      readAt: null,
      _status: 'sending',
      _origText: text,
    };
    setMessages((prev) => [...prev, tempMsg]);
    setInput('');
    setSending(true);
    setError(null);
    // 滚到底显新气泡
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));

    try {
      const payload = e2eEnabled && peerPubKey
        ? { text: await encryptMessage(text, peerPubKey), is_encrypted: true }
        : { text };
      const realMsg = await apiPost<Message>(`/conversations/${id}/messages`, payload);
      // 把 temp 替换成真实 msg(保留服务端 id/sentAt/contentLanguage 等)
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...realMsg, _status: undefined } : m)));
    } catch (err) {
      // 标 failed · 文本原样保留 · 用户可点气泡重发
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, _status: 'failed' } : m)));
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setSending(false);
    }
  }

  // 失败气泡点击重发
  async function retry(tempId: string, text: string) {
    setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, _status: 'sending' } : m)));
    try {
      const payload = e2eEnabled && peerPubKey
        ? { text: await encryptMessage(text, peerPubKey), is_encrypted: true }
        : { text };
      const realMsg = await apiPost<Message>(`/conversations/${id}/messages`, payload);
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...realMsg, _status: undefined } : m)));
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, _status: 'failed' } : m)));
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  if (loading) {
    return (
      <div className="mobile-container flex h-screen flex-col bg-gradient-soft">
        <ChatHeader
          displayName={conv?.counterpartyDisplayName ?? null}
          avatarUrl={conv?.counterpartyAvatarUrl}
          onHeaderClick={
            conv?.counterpartyTherapistId
              ? () => router.push(`/therapist/${conv.counterpartyTherapistId}`)
              : undefined
          }
        />
        <div className="flex-1"><LoadingFull /></div>
      </div>
    );
  }

  return (
    <div className="mobile-container flex h-screen flex-col bg-gradient-soft">
      <ChatHeader
        displayName={conv?.counterpartyDisplayName ?? null}
        avatarUrl={conv?.counterpartyAvatarUrl}
        subtitle={e2eEnabled ? '端到端加密 · 对方已启用' : undefined}
        onHeaderClick={
          conv?.counterpartyTherapistId
            ? () => router.push(`/therapist/${conv.counterpartyTherapistId}`)
            : undefined
        }
      />
      <ErrorBanner message={error} />
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-3 py-4">
          {messages.map((m, i) => {
            const mine = m.senderUserId === me;
            // 连续同 sender 时只在最后一条显头像(iMessage 风格,减视觉噪音)
            const next = messages[i + 1];
            const showAvatar = !next || next.senderUserId !== m.senderUserId;
            // M05 Phase 1 · 计算原文 + 翻译 + cultureNotes(明文走 server translation · 加密走 ephemeral)
            let original = '';
            let translation: string | null = null;
            let cultureNotes: Array<{ phrase: string; note: string }> = [];
            if (m.isEncrypted === 1) {
              original = decrypted[m.id] ?? '🔐 解密中…';
              const eph = ephemeralTranslation[m.id];
              if (eph && autoTranslate && !mine) {
                translation = eph.text;
                cultureNotes = eph.cultureNotes;
              }
            } else {
              original = m.contentOriginal ?? '';
              // 放宽:contentLanguage 缺失也尝试用 ephemeral(从 /translate 异步拉回)
              if (autoTranslate && !mine && (!m.contentLanguage || m.contentLanguage !== translateLang)) {
                // 优先用 ephemeral(按用户选的 translateLang 翻的)
                const eph = ephemeralTranslation[m.id];
                if (eph) {
                  translation = eph.text;
                  cultureNotes = eph.cultureNotes;
                } else if (m.translation && translateLang === myLocale) {
                  // fallback:用户选的是默认 locale · 用后端预存的翻译
                  translation = m.translation.translatedText;
                  cultureNotes = m.translation.cultureNotes ?? [];
                }
              }
            }
            // 同语言:不显翻译 · 直接显原文
            const showSplit = translation !== null && translation !== original;
            const senderName = mine
              ? (user?.displayName ?? '')
              : (m.senderDisplayName ?? conv?.counterpartyDisplayName ?? '');
            const senderAvatar = mine
              ? (user?.avatarUrl ?? null)
              : (m.senderAvatarUrl ?? conv?.counterpartyAvatarUrl ?? null);
            const avatarFallback = (senderName || '').slice(0, 1) || '🙂';
            return (
              <div
                key={m.id}
                className={`flex items-end gap-2 animate-fade-up ${mine ? 'flex-row-reverse' : 'flex-row'}`}
                style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
              >
                <div className="shrink-0 w-8">
                  {showAvatar ? (
                    <Avatar size={32} src={senderAvatar ?? undefined} fallback={avatarFallback} />
                  ) : null}
                </div>
                <div className={`max-w-[72%] flex flex-col gap-0.5 ${mine ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`${mine ? 'msg-bubble-mine' : 'msg-bubble-other'} transition-opacity ${
                      m._status === 'sending' ? 'opacity-60' : ''
                    } ${m._status === 'failed' ? 'ring-2 ring-red-300 cursor-pointer' : ''}`}
                    onClick={m._status === 'failed' && m._origText ? () => void retry(m.id, m._origText!) : undefined}
                    title={m._status === 'failed' ? '点击重发' : undefined}
                  >
                    {showSplit ? (
                      <>
                        <div className={`text-[12px] ${mine ? 'text-white/70' : 'text-ink-500'}`}>{original}</div>
                        <div className="mt-1 text-[14px] font-medium">{translation}</div>
                      </>
                    ) : (
                      <div className="whitespace-pre-wrap break-words">{original}</div>
                    )}
                    {m.isEncrypted === 1 && (
                      <div className={`mt-1.5 text-[10px] ${mine ? 'text-white/70' : 'text-warm-500'}`}>🔐 端到端加密</div>
                    )}
                    {cultureNotes.length > 0 && (
                      <div className={`mt-1.5 space-y-0.5 border-t border-current/10 pt-1.5 text-[11px] ${mine ? 'text-white/80' : 'text-ink-600'}`}>
                        {cultureNotes.map((n, i) => (
                          <div key={i}>
                            <strong>{n.phrase}</strong> · {n.note}
                          </div>
                        ))}
                      </div>
                    )}
                    {m.redlineAction === 'rewrite' && !mine && (
                      <div className={`mt-1 text-[10px] ${mine ? 'text-white/70' : 'text-warm-600'}`}>
                        ⚠️ 系统已改写部分敏感内容
                      </div>
                    )}
                  </div>
                  <div className={`px-1 text-[9.5px] tracking-wider ${m._status === 'failed' ? 'text-red-500' : 'text-ink-400'}`}>
                    {new Date(m.sentAt).toLocaleTimeString().slice(0, 5)}
                    {m._status === 'sending' && <span className="ml-1.5">· 发送中…</span>}
                    {m._status === 'failed' && <span className="ml-1.5 font-medium">· 发送失败 · 点击重发</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {peerTyping && (
            <div className="flex justify-start px-1">
              <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-warm-50 px-3 py-2.5 shadow-warm-xs">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400 [animation-delay:300ms]" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-warm-100 bg-white/95 px-3 pb-3 pt-2 backdrop-blur">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-[10px]">
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
            </label>
            <button
              type="button"
              onClick={() => setTranslateSheetOpen(true)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold shadow-warm-xs transition active:scale-95 ${
                translateLang === 'off'
                  ? 'bg-ink-100 text-ink-500'
                  : 'bg-gradient-cta text-white shadow-rose-md'
              }`}
              aria-label="选择翻译语言"
            >
              <Globe className={`h-3.5 w-3.5 ${translateLang === 'off' ? 'text-ink-400' : 'text-white'}`} />
              <span>
                {translateLang === 'off' ? '不翻译' : `翻译 · ${TRANSLATE_LANG_LABEL[translateLang]}`}
              </span>
              <span className="text-[9px] opacity-70">▾</span>
            </button>
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

      {/* 翻译语言选择 BottomSheet */}
      <TranslateLangSheet
        isOpen={translateSheetOpen}
        current={translateLang}
        onClose={() => setTranslateSheetOpen(false)}
        onSelect={(lang) => setTranslateLang(lang)}
      />
    </div>
  );
}
