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
import { pointsToFiatLabel } from '@/lib/fiat';
import { decryptMessage, encryptMessage, hasKeys, isEncryptedBlob } from '@/lib/crypto';
import { useAuth } from '@/lib/auth';
import { useServerEvents } from '@/lib/sse';

// 翻译语言选择 BottomSheet 懒加载 · 点击才下载
const TranslateLangSheet = dynamic(
  () => import('@/components/chat/TranslateLangSheet').then((m) => m.TranslateLangSheet),
  { ssr: false },
);
// 快捷操作:送礼物 / 找话题 sheet 懒加载
const GiftSheet = dynamic(
  () => import('@/components/chat/GiftSheet').then((m) => m.GiftSheet),
  { ssr: false },
);
const TopicSheet = dynamic(
  () => import('@/components/chat/TopicSheet').then((m) => m.TopicSheet),
  { ssr: false },
);
import { QuickActionsBar } from '@/components/chat/QuickActionsBar';
import { IntimacyRibbon } from '@/components/chat/IntimacyRibbon';
import { useDialog } from '@/components/UIDialog';

// 心动陪伴动作卡（M18 · A 流内壳）懒加载 · 点"心动"才下载
const CompanionActionSheet = dynamic(
  () => import('@/components/chat/CompanionActionSheet').then((m) => m.CompanionActionSheet),
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
  // 快捷操作 sheet 状态
  const [giftSheetOpen, setGiftSheetOpen] = useState(false);
  const [topicSheetOpen, setTopicSheetOpen] = useState(false);
  // M18 心动陪伴 · 动作卡(A 流内壳)开关 + 当前亲密度等级(供文案"差一步到 X")
  const [companionSheetOpen, setCompanionSheetOpen] = useState(false);
  const [intimacyLevel, setIntimacyLevel] = useState<number | null>(null);
  // 0027 · 技师默认法币(GiftSheet 等积分→法币换算用)+ 公开 currencies 字典
  const [therapistCurrencyCode, setTherapistCurrencyCode] = useState<string | null>(null);
  const [currencies, setCurrencies] = useState<Array<{ code: string; symbol: string; decimals: number; pointsPerUnit: string | null }>>([]);
  const { confirm, alert: showAlert } = useDialog();
  // Tony 需求(2026-06-01):'选语言之后的新消息才翻译,已有的不翻'
  //   省 batch 翻译 latency · 减视觉混乱 · 用户主动选才翻的明确语义
  //   mount + 每次切语言时 reset 为 Date.now() · 之后 SSE 推送的新消息才走翻译
  const [translateSinceTs, setTranslateSinceTs] = useState<number>(() => Date.now());
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
    // 用户切语言 · 清掉旧 ephemeral 翻译 cache · 翻译起算时刻刷新为当下
    // → 切语言前已显示的消息不再触发翻译 · 之后新消息才翻
    setEphemeralTranslation({});
    setTranslateSinceTs(Date.now());
  }, [translateLang]);
  // 不再切语言时 reload · load 会按 translateSinceTs 自动只翻新消息

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
        // 0027 · 客户端拉技师默认法币 + currencies 字典(用于 GiftSheet 等积分→fiat 换算)
        if (target?.counterpartyTherapistId) {
          try {
            const [therapistView, curList] = await Promise.all([
              apiGet<{ defaultCurrencyCode?: string | null }>(`/therapists/${target.counterpartyTherapistId}`),
              apiGet<Array<{ code: string; symbol: string; decimals: number; pointsPerUnit: string | null }>>('/currencies'),
            ]);
            setTherapistCurrencyCode(therapistView.defaultCurrencyCode ?? null);
            setCurrencies(curList);
          } catch { /* 静默 · 兜底显积分 */ }
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
        // 仅翻 sentAt > translateSinceTs 的新消息 · 历史消息保持原状不消耗 LLM
        if (autoTranslate) {
          for (const m of list) {
            if (
              m.isEncrypted === 1
              && m.senderUserId !== me
              && updates[m.id]
              && !ephemeralTranslation[m.id]
              && new Date(m.sentAt).getTime() > translateSinceTs
            ) {
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
      // 仅翻 sentAt > translateSinceTs 的新消息 · 历史保留原状
      if (autoTranslate && translateLang !== myLocale) {
        for (const m of list) {
          if (
            m.isEncrypted !== 1 &&
            m.senderUserId !== me &&
            m.contentOriginal &&
            // 放宽:contentLanguage 缺失也尝试翻译(老消息字段空)
            // 仅当明确知道是同一语言时才跳过
            (!m.contentLanguage || m.contentLanguage !== translateLang) &&
            !ephemeralTranslation[m.id] &&
            new Date(m.sentAt).getTime() > translateSinceTs
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
          // 兜底：25s 没等到消息就自动收起(LLM 重试 + redline 检测最差 ~15s + safety)
          // 后端每次 LLM call 前 keep-alive 推 typing,timer 自动重置 · 不会撑到 25s
          typingTimer.current = setTimeout(() => setPeerTyping(false), 25000);
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

  // ──────── 快捷操作 handlers ────────

  /** 🎁 送礼物 · 成功后自动发一条"送出 X"系统气泡 */
  function handleGiftSent(sku: { emoji: string; name: string; points: number }) {
    setInput(`送出 ${sku.emoji} ${sku.name}`);
    void send(); // 同步发出对方能看到送了什么
  }

  /** 💝 约今晚 · 跳订单页(M04 已有) */
  function handleBook() {
    if (!conv?.counterpartyTherapistId) {
      void showAlert({ title: '无法预约', message: '对方非技师身份' });
      return;
    }
    router.push(`/therapist/${conv.counterpartyTherapistId}/order`);
  }

  /** 💬 找话题 · 点击话题自动填到输入框(不强发送 · 用户可编辑) */
  function handleTopicPick(text: string) {
    setInput(text);
  }

  /**
   * M18 心动陪伴 · 动作发起成功 → 把"她"的回复作为一条 her 气泡插进聊天流
   * (不二次 GET · 即时呈现 · 和送礼/发消息一样的乐观渲染节奏)
   */
  function handleCompanionReply(reply: string | null, newLevel?: number) {
    if (typeof newLevel === 'number') setIntimacyLevel(newLevel);
    // reply 可能为 null（后端 LLM 兜底）· 此时不插空气泡，仅更新亲密度
    if (reply) {
      const herMsg: Message = {
        id: `companion-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        conversationId: id ?? '',
        senderUserId: conv?.therapistUserId ?? '',
        type: 'text',
        contentOriginal: reply,
        contentLanguage: null,
        isAiAlter: 1,
        isEncrypted: 0,
        sentAt: new Date().toISOString(),
        readAt: null,
      };
      setMessages((prev) => [...prev, herMsg]);
    }
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }

  /** 🔓 解锁联系方式 · 100 积分 · 复用详情页 unlockSocial 流程 */
  async function handleUnlock() {
    if (!conv?.counterpartyTherapistId) {
      void showAlert({ title: '无法解锁', message: '对方非技师身份' });
      return;
    }
    const unlockLabel = pointsToFiatLabel(100, therapistCurrencyCode, currencies);
    const ok = await confirm({
      title: '解锁联系方式',
      message: `确定支付 ${unlockLabel}? 解锁后可看 WhatsApp / Line · 进她的详情页查看`,
      confirmText: '解锁',
    });
    if (!ok) return;
    try {
      await apiPost(`/therapists/${conv.counterpartyTherapistId}/unlock`, {
        unlock_type: 'social_contacts',
      });
      await showAlert({
        title: '解锁成功',
        message: '联系方式已显示在她的详情页 · 立即去看?',
      });
      router.push(`/therapist/${conv.counterpartyTherapistId}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        const msg = err.payload.message;
        if (msg.includes('balance') || msg.includes('积分') || err.payload.code === 'E2010') {
          void showAlert({ title: '余额不足', message: '充值后再来解锁' });
        } else {
          void showAlert({ title: '解锁失败', message: msg });
        }
      }
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
          loading={!conv}
          onHeaderClick={
            conv?.counterpartyTherapistId
              ? () => router.push(`/therapist/${conv.counterpartyTherapistId}`)
              : undefined
          }
        />
        {conv?.counterpartyTherapistId && conv?.therapistUserId && (
          <IntimacyRibbon therapistUserId={conv.therapistUserId} onLevel={setIntimacyLevel} />
        )}
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
        typing={peerTyping}
        loading={!conv}
        onHeaderClick={
          conv?.counterpartyTherapistId
            ? () => router.push(`/therapist/${conv.counterpartyTherapistId}`)
            : undefined
        }
      />
      {conv?.counterpartyTherapistId && conv?.therapistUserId && (
        <IntimacyRibbon therapistUserId={conv.therapistUserId} onLevel={setIntimacyLevel} />
      )}
      <ErrorBanner message={error} />
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="no-scrollbar flex-1 space-y-2 overflow-y-auto px-4 py-5">
          {messages.map((m, i) => {
            const mine = m.senderUserId === me;
            // 连续同 sender 时只在最后一条显头像(iMessage 风格,减视觉噪音)
            const next = messages[i + 1];
            // 同 sender 连续不显头像 + 不显时间 (iMessage 分组风格)
            // 跨 sender · 或 5min 间隔 · 或末尾 → 显头像 + 时间
            const gapMs = next ? new Date(next.sentAt).getTime() - new Date(m.sentAt).getTime() : Infinity;
            const showAvatar = !next || next.senderUserId !== m.senderUserId || gapMs > 5 * 60 * 1000;
            const showTime = showAvatar; // 同步 · 时间戳同位置出现
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
                <div className={`max-w-[72%] flex flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
                  {/* 主气泡 · 永远显原文 (微信式 · 用户能看见消息真实内容) */}
                  <div
                    className={`${mine ? 'msg-bubble-mine' : 'msg-bubble-other'} transition-opacity ${
                      m._status === 'sending' ? 'opacity-60' : ''
                    } ${m._status === 'failed' ? 'ring-2 ring-red-300 cursor-pointer' : ''}`}
                    onClick={m._status === 'failed' && m._origText ? () => void retry(m.id, m._origText!) : undefined}
                    title={m._status === 'failed' ? '点击重发' : undefined}
                  >
                    <div className="whitespace-pre-wrap break-words">{original}</div>
                    {m.isEncrypted === 1 && (
                      <div className={`mt-1.5 text-[10px] ${mine ? 'text-white/70' : 'text-warm-500'}`}>🔐 端到端加密</div>
                    )}
                    {m.redlineAction === 'rewrite' && !mine && (
                      <div className={`mt-1 text-[10px] ${mine ? 'text-white/70' : 'text-warm-600'}`}>
                        ⚠️ 系统已改写部分敏感内容
                      </div>
                    )}
                  </div>

                  {/* 翻译附件 (微信式 · 紧贴原文气泡下方 · 灰底独立小盒) */}
                  {showSplit && !mine && (
                    <div className="w-fit max-w-full rounded-[18px] border border-warm-100 bg-warm-50/70 px-3.5 py-2 shadow-warm-xs">
                      <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">
                        <Globe className="h-2.5 w-2.5" />
                        <span>翻译 · {TRANSLATE_LANG_LABEL[translateLang]}</span>
                      </div>
                      <div className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.55] text-ink-700">
                        {translation}
                      </div>
                      {cultureNotes.length > 0 && (
                        <div className="mt-2 space-y-1 border-t border-warm-100 pt-2 text-[11px]">
                          {cultureNotes.map((n, idx) => (
                            <div key={idx} className="leading-[1.5] text-ink-500">
                              <strong className="text-primary">{n.phrase}</strong>
                              <span className="opacity-80"> · {n.note}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {(showTime || m._status) && (
                    <div className={`px-1 text-[10px] tracking-wider ${m._status === 'failed' ? 'text-red-500' : 'text-ink-400'}`}>
                      {showTime && new Date(m.sentAt).toLocaleTimeString().slice(0, 5)}
                      {m._status === 'sending' && <span className={showTime ? 'ml-1.5' : ''}>· 发送中…</span>}
                      {m._status === 'failed' && <span className={`${showTime ? 'ml-1.5' : ''} font-medium`}>· 发送失败 · 点击重发</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {/* typing indicator 已上移到 ChatHeader subtitle 区域 · 不再在气泡内显示 */}
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-warm-100 bg-white/95 px-3 pb-3 pt-2 backdrop-blur">
          {/* 客户视角才显快捷按钮 · 技师侧不显(避免技师向客户发送礼物等不合业务的动作) */}
          {conv?.counterpartyTherapistId && (
            <QuickActionsBar
              onGift={() => setGiftSheetOpen(true)}
              onBook={handleBook}
              onTopics={() => setTopicSheetOpen(true)}
              onUnlock={() => void handleUnlock()}
              onCompanion={() => setCompanionSheetOpen(true)}
            />
          )}
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

      {/* 快捷操作:送礼物 sheet · 仅客户视角且对方是技师才挂载 */}
      {conv?.counterpartyTherapistId && (
        <>
          <GiftSheet
            isOpen={giftSheetOpen}
            therapistId={conv.counterpartyTherapistId}
            therapistName={conv.counterpartyDisplayName ?? null}
            therapistCurrencyCode={therapistCurrencyCode}
            currencies={currencies}
            onClose={() => setGiftSheetOpen(false)}
            onSent={handleGiftSent}
          />
          <TopicSheet
            isOpen={topicSheetOpen}
            therapistId={conv.counterpartyTherapistId}
            therapistName={conv.counterpartyDisplayName ?? null}
            onClose={() => setTopicSheetOpen(false)}
            onPickTopic={handleTopicPick}
          />
          {conv.therapistUserId && (
            <CompanionActionSheet
              isOpen={companionSheetOpen}
              therapistUserId={conv.therapistUserId}
              therapistName={conv.counterpartyDisplayName ?? null}
              currentLevel={intimacyLevel}
              onClose={() => setCompanionSheetOpen(false)}
              onReply={handleCompanionReply}
            />
          )}
        </>
      )}
    </div>
  );
}
