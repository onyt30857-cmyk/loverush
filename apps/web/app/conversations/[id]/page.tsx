'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Globe, Mic } from 'lucide-react';
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
import { useSpeechToText } from '@/lib/useSpeechToText';
import { useServerEvents } from '@/lib/sse';

// 翻译语言选择 BottomSheet 懒加载 · 点击才下载
const TranslateLangSheet = dynamic(
  () => import('@/components/chat/TranslateLangSheet').then((m) => m.TranslateLangSheet),
  { ssr: false },
);
// 快捷操作:送礼物 sheet 懒加载
const GiftSheet = dynamic(
  () => import('@/components/chat/GiftSheet').then((m) => m.GiftSheet),
  { ssr: false },
);
import { QuickActionsBar } from '@/components/chat/QuickActionsBar';
import { TherapistQuickBar } from '@/components/chat/TherapistQuickBar';
import { CustomerNotesSheet } from '@/components/chat/CustomerNotesSheet';
import { VoiceWhisperBubble } from '@/components/chat/VoiceWhisperBubble';
import { GiftCeremony, type GiftCeremonyGift } from '@/components/chat/GiftCeremony';
import { GiftBubble } from '@/components/chat/GiftBubble';
import { LockedMediaCard } from '@/components/chat/LockedMediaCard';
import { OrderOfferCard, type OrderOffer } from '@/components/chat/OrderOfferCard';
import { OrderCard, type OrderCardData } from '@/components/chat/OrderCard';
import { ShopInfoCard, type ShopInfoOffer } from '@/components/chat/ShopInfoCard';
import { CustomerLocationCard, type CustomerLocationOffer } from '@/components/chat/CustomerLocationCard';
import { ScheduleOfferCard, type ScheduleOffer } from '@/components/chat/ScheduleOfferCard';
import { GiftHintCard } from '@/components/chat/GiftHintCard';
import { ChatPaywallCard } from '@/components/chat/ChatPaywallCard';
import { ChatSessionRibbon } from '@/components/chat/ChatSessionRibbon';
import { OrderActionRibbon } from '@/components/chat/OrderActionRibbon';
import { RechargeOfferCard } from '@/components/chat/RechargeOfferCard';
import type { PriceTier } from '@/components/ServiceTierSheet';
import { useDialog } from '@/components/UIDialog';

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
  /** 技师手动锁定接管:非 null=技师在亲自聊、分身完全不插手(直到交还) */
  alterLockedAt?: string | null;
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
  _audioUrl?: string | null; // M18 voice_whisper · 她的声音复刻音频(缺则气泡用占位)
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
  // 送礼仪式感动效(送出礼物时全屏播放)
  const [giftCeremony, setGiftCeremony] = useState<GiftCeremonyGift | null>(null);
  // 陪聊时段 · 进行中的过期时刻(倒计时);null = 无时段(走免费额度/软墙)
  const [chatSessionExpireAt, setChatSessionExpireAt] = useState<string | null>(null);
  // M-OAC · 订单操作刷新触发器(卡/条任一操作成功 +1,两处联动重拉最新状态)
  const [orderRefreshKey, setOrderRefreshKey] = useState(0);
  // 0027 · 技师默认法币(GiftSheet 等积分→法币换算用)+ 公开 currencies 字典
  const [therapistCurrencyCode, setTherapistCurrencyCode] = useState<string | null>(null);
  const [currencies, setCurrencies] = useState<Array<{ code: string; symbol: string; decimals: number; pointsPerUnit: string | null }>>([]);
  // 技师服务套餐(下单卡用)· 初始化随技师资料一并缓存
  const [therapistTiers, setTherapistTiers] = useState<PriceTier[]>([]);
  const { confirm, prompt, alert: showAlert } = useDialog();
  const [custMenuOpen, setCustMenuOpen] = useState(false);
  // 老客统计(技师视角)
  const [customerCompletedCount, setCustomerCompletedCount] = useState<number>(0);
  // 客户备注面板(技师视角)
  const [notesSheetOpen, setNotesSheetOpen] = useState(false);
  // Tony 需求(2026-06-01):'选语言之后的新消息才翻译,已有的不翻'
  //   省 batch 翻译 latency · 减视觉混乱 · 用户主动选才翻的明确语义
  //   mount + 每次切语言时 reset 为 Date.now() · 之后 SSE 推送的新消息才走翻译
  const [translateSinceTs, setTranslateSinceTs] = useState<number>(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  // 按住说话(语音转文字)· 录音中实时回填输入框,松开落字待发(不自动发送,留纠错口)
  const stt = useSpeechToText();
  const sttBaseRef = useRef('');
  function startTalk() {
    if (stt.recording) return;
    sttBaseRef.current = input.trim() ? input.trimEnd() + ' ' : '';
    stt.start();
  }
  function stopTalk() {
    if (!stt.recording) return;
    const text = stt.stop();
    if (text) setInput((sttBaseRef.current + text).trimStart());
  }
  // 录音中:实时把识别文字回填输入框(base + interim),让用户看到正在识别什么
  useEffect(() => {
    if (stt.recording) setInput((sttBaseRef.current + stt.interimText).trimStart());
  }, [stt.recording, stt.interimText]);
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
        // 技师视角:拉该客户的老客统计(老客标识)
        if (target && myId && target.therapistUserId === myId && target.customerId) {
          try {
            const stats = await apiGet<{ completedCount: number; totalCount: number; isRepeatCustomer: boolean; lastCompletedAt: string | null }>(
              `/therapists/me/customers/${target.customerId}/stats`,
            );
            setCustomerCompletedCount(stats.completedCount);
          } catch { /* 静默 */ }
        }
        // 0027 · 客户端拉技师默认法币 + currencies 字典(用于 GiftSheet 等积分→fiat 换算)
        if (target?.counterpartyTherapistId) {
          try {
            const [therapistView, curList] = await Promise.all([
              apiGet<{ defaultCurrencyCode?: string | null; basePriceJson?: unknown }>(`/therapists/${target.counterpartyTherapistId}`),
              apiGet<Array<{ code: string; symbol: string; decimals: number; pointsPerUnit: string | null }>>('/currencies'),
            ]);
            setTherapistCurrencyCode(therapistView.defaultCurrencyCode ?? null);
            setCurrencies(curList);
            // 陪聊时段:拉进行中的(倒计时)
            if (target.therapistUserId) {
              try {
                const active = await apiGet<{ expireAt: string } | null>(`/chat-pass/${target.therapistUserId}/active`);
                if (active?.expireAt) setChatSessionExpireAt(active.expireAt);
              } catch {}
            }
            // 缓存技师套餐(下单卡用)
            if (Array.isArray(therapistView.basePriceJson)) {
              setTherapistTiers(therapistView.basePriceJson as PriceTier[]);
            }
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
    // 半途反悔:用户发消息=插话,分身被打断会停下接话,立刻撤掉"正在回复"气泡(别僵到 25s 超时)。
    // 分身开始下一轮回复时会再推 typing,这里清掉是乐观、安全的。
    setPeerTyping(false);
    if (typingTimer.current) clearTimeout(typingTimer.current);
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

  /** 发图(技师发素材):type=image,content=图 url(已在 R2)。乐观渲染,同 send()。 */
  async function sendImage(url: string) {
    if (!url) return;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tempMsg: Message = {
      id: tempId,
      conversationId: id ?? '',
      senderUserId: me ?? '',
      type: 'image',
      contentOriginal: url,
      contentLanguage: null,
      isAiAlter: 0,
      isEncrypted: 0,
      sentAt: new Date().toISOString(),
      readAt: null,
      _status: 'sending',
    };
    setMessages((prev) => [...prev, tempMsg]);
    setSending(true);
    setError(null);
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    try {
      const realMsg = await apiPost<Message>(`/conversations/${id}/messages`, { text: url, type: 'image' });
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...realMsg, _status: undefined } : m)));
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, _status: 'failed' } : m)));
      if (err instanceof ApiClientError) setError(err.payload.message);
    } finally {
      setSending(false);
    }
  }

  /** 技师拉黑骚扰客户:对称 block,拉黑后退回列表(对方无法再联系) */
  async function blockCustomer() {
    setCustMenuOpen(false);
    if (!conv?.customerId) return;
    const ok = await confirm({
      title: '拉黑该客户',
      message: '拉黑后你将不再收到 TA 的消息,也不会被推荐匹配。可在隐私设置取消。',
      confirmText: '拉黑',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiPost('/me/blocks', { target_user_id: conv.customerId, reason: 'therapist_initiated' });
      await showAlert({ title: '已拉黑', message: '该客户无法再联系你' });
      router.push('/t/messages');
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  /** 技师举报骚扰客户 → 工单,客服处理 */
  async function reportCustomer() {
    setCustMenuOpen(false);
    if (!conv?.customerId) return;
    const desc = await prompt({
      title: '举报客户',
      message: '请简述原因(骚扰 / 欺诈 / 辱骂 / 其他)',
      placeholder: '至少 3 个字',
      confirmText: '提交',
    });
    if (!desc) return;
    try {
      await apiPost('/tickets', {
        target_user_id: conv.customerId,
        title: '技师举报客户',
        description: desc,
        category: 'user_report',
      });
      await showAlert({ title: '举报已提交', message: '客服将在 24h 内处理 · 多谢反馈' });
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  /** 技师发"可约时段"卡(B2):后端按真实档期生成并发送;今明全满则提示。 */
  async function sendScheduleOffer() {
    try {
      const r = await apiPost<{ sent: boolean; message?: Message }>(`/conversations/${id}/schedule-offer`, {});
      if (!r.sent || !r.message) {
        setError('今明两天暂无可约空档 · 去排班放开时段后再发');
        return;
      }
      setMessages((prev) => [...prev, { ...r.message!, _status: undefined }]);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  /** 技师"我来接管 / 交还分身":锁定后分身完全不插手,直到交还(不自动过期)。 */
  async function toggleAlterTakeover(locked: boolean) {
    try {
      const r = await apiPost<{ alterLockedAt: string | null }>(`/conversations/${id}/alter-takeover`, { locked });
      setConv((prev) => (prev ? { ...prev, alterLockedAt: r.alterLockedAt } : prev));
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.payload.message);
    }
  }

  // ──────── 快捷操作 handlers ────────

  /** 本地插一张「她发来」的卡片消息(不入库 · 即时渲染) · 下单卡 / 充值卡共用 */
  function pushLocalCard(type: 'order_offer' | 'recharge_offer', content: string) {
    const card: Message = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      conversationId: id ?? '',
      senderUserId: conv?.therapistUserId ?? '',
      type,
      contentOriginal: content,
      contentLanguage: null,
      isAiAlter: 1,
      isEncrypted: 0,
      sentAt: new Date().toISOString(),
      readAt: null,
    };
    setMessages((prev) => [...prev, card]);
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }

  /** 余额不足那一刻 · 就地插一张充值卡(不把人跳走) */
  function pushRechargeCard(shortfallLabel?: string | null) {
    pushLocalCard('recharge_offer', JSON.stringify({ shortfallLabel: shortfallLabel ?? null }));
  }

  /** 🎁 送礼物成功后 · 只管前端仪式感;礼物消息+道谢+亲密度全由后端 reactToGift 发(走 SSE) */
  function handleGiftSent(sku: { emoji: string; name: string; points: number }) {
    // 不再 setInput+send(那是 React 闭包陷阱 bug:setInput 后立即 send 读到旧空 input,
    // "送出X"文本卡输入框发不出)。客户无需手动发任何内容——
    // 后端 reactToGift 会发一条 type='gift' 礼物消息(双方可见)+分身道谢,前端只播动效。
    setGiftCeremony(sku); // 全屏仪式感动效(飞行/绽放/粒子/震动/音效·按档位分级)
  }

  /** 💝 约今晚 · 就地插一张下单卡(内联选套餐 · 不再硬跳技师页) */
  function handleBook() {
    if (!conv?.counterpartyTherapistId) {
      void showAlert({ title: '无法预约', message: '对方非技师身份' });
      return;
    }
    // 无套餐兜底:回老路径直接进下单页(别卡死)
    if (therapistTiers.length === 0) {
      router.push(`/therapist/${conv.counterpartyTherapistId}/order`);
      return;
    }
    pushLocalCard(
      'order_offer',
      JSON.stringify({
        therapistId: conv.counterpartyTherapistId,
        therapistName: conv.counterpartyDisplayName ?? null,
        tiers: therapistTiers,
      }),
    );
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
          pushRechargeCard('解锁联系还差一点点');
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
          shopEntryUrl={
            conv?.counterpartyTherapistId
              ? `/therapist/${conv.counterpartyTherapistId}/shop`
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
        typing={peerTyping}
        loading={!conv}
        onHeaderClick={
          conv?.counterpartyTherapistId
            ? () => router.push(`/therapist/${conv.counterpartyTherapistId}`)
            : me && conv && me === conv.therapistUserId && conv.customerId
              ? () => setNotesSheetOpen(true) // 技师点客户名/头像 → 直接开客户档案
              : undefined
        }
        shopEntryUrl={
          conv?.counterpartyTherapistId
            ? `/therapist/${conv.counterpartyTherapistId}/shop`
            : undefined
        }
        customerVisitCount={
          me && conv && me === conv.therapistUserId ? customerCompletedCount : undefined
        }
        rightSlot={
          me && conv && me === conv.therapistUserId ? (
            <div className="relative flex items-center gap-0.5">
              {/* 一键直达客户档案(不再埋在 ⋮ 菜单里) */}
              <button
                type="button"
                onClick={() => setNotesSheetOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[17px] active:bg-ink-100"
                aria-label="客户档案"
                title="客户档案"
              >
                📝
              </button>
              <button
                type="button"
                onClick={() => setCustMenuOpen((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-ink-500 active:bg-ink-100"
                aria-label="更多"
              >
                ⋮
              </button>
              {custMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setCustMenuOpen(false)} />
                  <div className="absolute right-0 top-10 z-20 w-36 overflow-hidden rounded-xl border border-warm-100 bg-white py-1 shadow-warm-lg">
                    {/* 客户档案已移到头部常显 📝 按钮,菜单只留风控动作 */}
                    <button
                      type="button"
                      onClick={() => void reportCustomer()}
                      className="block w-full px-4 py-2.5 text-left text-[13px] text-ink-700 active:bg-warm-50"
                    >
                      🚩 举报客户
                    </button>
                    <button
                      type="button"
                      onClick={() => void blockCustomer()}
                      className="block w-full px-4 py-2.5 text-left text-[13px] text-red-600 active:bg-warm-50"
                    >
                      🚫 拉黑客户
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : undefined
        }
      />
      <ChatSessionRibbon
        expireAt={chatSessionExpireAt}
        therapistName={conv?.counterpartyDisplayName ?? null}
        onExpire={() => setChatSessionExpireAt(null)}
      />
      {conv && id && (
        <OrderActionRibbon
          conversationId={id}
          refreshKey={orderRefreshKey}
          onActed={() => setOrderRefreshKey((n) => n + 1)}
          onOpen={(oid) => router.push(`/order/${oid}`)}
        />
      )}
      <ErrorBanner message={error} />
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="no-scrollbar flex-1 space-y-2 overflow-y-auto px-4 py-5">
          {messages.map((m, i) => {
            // 上门客户地址卡(导航前往)只发给技师导航用 · 客户侧不渲染(给自己家导航无意义,且本是技师专属)
            if (m.type === 'customer_location' && me !== conv?.therapistUserId) return null;
            const mine = m.senderUserId === me;
            // 连续同 sender 时只在最后一条显头像(iMessage 风格,减视觉噪音)
            const next = messages[i + 1];
            // 同 sender 连续不显头像 + 不显时间 (iMessage 分组风格)
            // 跨 sender · 或 5min 间隔 · 或末尾 → 显头像 + 时间
            const gapMs = next ? new Date(next.sentAt).getTime() - new Date(m.sentAt).getTime() : Infinity;
            const showAvatar = !next || next.senderUserId !== m.senderUserId || gapMs > 5 * 60 * 1000;
            const showTime = showAvatar; // 同步 · 时间戳同位置出现
            // M05 Phase 1 · 计算原文 + 翻译(明文走 server translation · 加密走 ephemeral)
            //   注:翻译只显译文,文化注解 cultureNotes 不再展示(Tony 2026-06-05)
            let original = '';
            let translation: string | null = null;
            if (m.isEncrypted === 1) {
              original = decrypted[m.id] ?? '🔐 解密中…';
              const eph = ephemeralTranslation[m.id];
              if (eph && autoTranslate && !mine) {
                translation = eph.text;
              }
            } else {
              original = m.contentOriginal ?? '';
              // 放宽:contentLanguage 缺失也尝试用 ephemeral(从 /translate 异步拉回)
              if (autoTranslate && !mine && (!m.contentLanguage || m.contentLanguage !== translateLang)) {
                // 优先用 ephemeral(按用户选的 translateLang 翻的)
                const eph = ephemeralTranslation[m.id];
                if (eph) {
                  translation = eph.text;
                } else if (m.translation && translateLang === myLocale) {
                  // fallback:用户选的是默认 locale · 用后端预存的翻译
                  translation = m.translation.translatedText;
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
            // M18 · media_locked 气泡 · contentOriginal 是 {mediaId,pricePoints,thumbnailUrl} JSON
            //   解析失败 → lockedOffer=null → fallback 走文本气泡(别崩)
            let lockedOffer: { mediaId: string; pricePoints: number; thumbnailUrl?: string | null } | null = null;
            if (m.type === 'media_locked') {
              try {
                const o = JSON.parse(original);
                if (o && typeof o.mediaId === 'string') lockedOffer = o;
              } catch { lockedOffer = null; }
            }
            // 下单卡 · contentOriginal 是 {therapistId,therapistName,tiers} JSON
            let orderOffer: OrderOffer | null = null;
            if (m.type === 'order_offer') {
              try {
                const o = JSON.parse(original);
                if (o && typeof o.therapistId === 'string' && Array.isArray(o.tiers)) orderOffer = o;
              } catch { orderOffer = null; }
            }
            // 选时段卡 · contentOriginal 是 {therapistId,date,durationMinutes,slots} JSON
            let scheduleOffer: ScheduleOffer | null = null;
            if (m.type === 'schedule_offer') {
              try {
                const o = JSON.parse(original);
                if (o && typeof o.therapistId === 'string' && Array.isArray(o.slots)) scheduleOffer = o;
              } catch { scheduleOffer = null; }
            }
            // 礼物卡 · contentOriginal 是 {therapistId,therapistName} JSON
            let giftHintName: string | null = null;
            let isGiftHint = false;
            if (m.type === 'gift_hint') {
              isGiftHint = true;
              try { giftHintName = JSON.parse(original)?.therapistName ?? null; } catch { giftHintName = null; }
            }
            // 陪聊软墙卡 · contentOriginal 是 {therapistName,options} JSON
            let chatPaywall: { therapistName: string | null; options: Array<{ minutes: number; points: number }> } | null = null;
            if (m.type === 'chat_paywall') {
              try {
                const o = JSON.parse(original);
                if (o && Array.isArray(o.options)) chatPaywall = { therapistName: o.therapistName ?? null, options: o.options };
              } catch { chatPaywall = null; }
            }
            // 充值卡 · contentOriginal 是 {shortfallLabel} JSON(可空)
            let rechargeShortfall: string | null = null;
            if (m.type === 'recharge_offer') {
              try { rechargeShortfall = JSON.parse(original)?.shortfallLabel ?? null; }
              catch { rechargeShortfall = null; }
            }
            // 到店门店信息卡 · contentOriginal 是 {orderNo,address,arrivalNote,guideMedia} JSON
            let shopInfoOffer: ShopInfoOffer | null = null;
            if (m.type === 'shop_info') {
              try {
                const o = JSON.parse(original);
                if (o && typeof o === 'object') {
                  shopInfoOffer = {
                    orderNo: o.orderNo ?? null,
                    address: o.address ?? null,
                    arrivalNote: o.arrivalNote ?? null,
                    guideMedia: Array.isArray(o.guideMedia) ? o.guideMedia : [],
                  };
                }
              } catch { shopInfoOffer = null; }
            }
            // 上门客户地址卡(发给技师)· contentOriginal 是 {orderNo,address,note,areaName,media} JSON
            let customerLocationOffer: CustomerLocationOffer | null = null;
            if (m.type === 'customer_location') {
              try {
                const o = JSON.parse(original);
                if (o && typeof o === 'object') {
                  customerLocationOffer = {
                    orderNo: o.orderNo ?? null,
                    areaName: o.areaName ?? null,
                    address: o.address ?? null,
                    note: o.note ?? null,
                    media: Array.isArray(o.media) ? o.media : [],
                    lat: o.lat ?? null,
                    lng: o.lng ?? null,
                  };
                }
              } catch { customerLocationOffer = null; }
            }
            // 订单卡 · contentOriginal 是 OrderCardData JSON(下单成功推进对话)
            let orderCardData: OrderCardData | null = null;
            if (m.type === 'order_card') {
              try {
                const o = JSON.parse(original);
                if (o && typeof o.orderId === 'string') orderCardData = o;
              } catch { orderCardData = null; }
            }
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
                  {/* 订单卡 → 下单卡 → 选时段卡 → 充值卡 → 私密图锁定卡 → image 真实图 → voice 悄悄话 → 文本气泡 */}
                  {orderCardData ? (
                    <OrderCard
                      data={orderCardData}
                      me={me}
                      therapistUserId={conv?.therapistUserId ?? null}
                      refreshKey={orderRefreshKey}
                      onActed={() => setOrderRefreshKey((n) => n + 1)}
                      onOpen={(oid, opts) => router.push(`/order/${oid}${opts?.review ? '?review=1' : ''}`)}
                    />
                  ) : customerLocationOffer ? (
                    <CustomerLocationCard offer={customerLocationOffer} />
                  ) : shopInfoOffer ? (
                    <ShopInfoCard offer={shopInfoOffer} />
                  ) : orderOffer ? (
                    <OrderOfferCard
                      offer={orderOffer}
                      currencies={currencies}
                      onPick={(tid, dur) => router.push(`/therapist/${tid}/order?duration=${dur}`)}
                    />
                  ) : scheduleOffer ? (
                    <ScheduleOfferCard
                      offer={scheduleOffer}
                      onPick={(tid, date, startAt, dur) =>
                        router.push(`/therapist/${tid}/order?date=${date}&startAt=${encodeURIComponent(startAt)}&duration=${dur}`)
                      }
                    />
                  ) : isGiftHint ? (
                    <GiftHintCard therapistName={giftHintName} onOpen={() => setGiftSheetOpen(true)} />
                  ) : chatPaywall ? (
                    <ChatPaywallCard
                      offer={chatPaywall}
                      therapistUserId={conv?.therapistUserId ?? ''}
                      onPurchased={(expireAt, minutes) => {
                        setChatSessionExpireAt(expireAt);
                        // 乐观插一条她兑现独占的消息(即时反馈,后续分身走 session 畅聊)
                        setMessages((prev) => [...prev, {
                          id: `chatpass-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                          conversationId: id ?? '',
                          senderUserId: conv?.therapistUserId ?? '',
                          type: 'text',
                          contentOriginal: `好啦~这 ${minutes} 分钟我谁的单都不接，就黏着你一个人~`,
                          contentLanguage: null,
                          isAiAlter: 1,
                          isEncrypted: 0,
                          sentAt: new Date().toISOString(),
                          readAt: null,
                        }]);
                      }}
                      onInsufficient={() => pushRechargeCard('陪聊还差一点点积分')}
                    />
                  ) : m.type === 'recharge_offer' ? (
                    <RechargeOfferCard
                      shortfallLabel={rechargeShortfall}
                      onRecharge={() => router.push('/me/recharge?from=companion')}
                    />
                  ) : lockedOffer ? (
                    <LockedMediaCard
                      offer={lockedOffer}
                      conversationId={id ?? ''}
                      onInsufficientBalance={() => pushRechargeCard('心动值差一点点')}
                      onUnlocked={(imageUrl) =>
                        // 乐观插一条 her 图气泡
                        // (senderUserId=技师 · type=image · contentOriginal=图 url · isAiAlter=1)
                        setMessages((prev) => [
                          ...prev,
                          {
                            id: `unlock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            conversationId: id ?? '',
                            senderUserId: conv?.therapistUserId ?? '',
                            type: 'image',
                            contentOriginal: imageUrl,
                            contentLanguage: null,
                            isAiAlter: 1,
                            isEncrypted: 0,
                            sentAt: new Date().toISOString(),
                            readAt: null,
                          },
                        ])
                      }
                    />
                  ) : m.type === 'voice' ? (
                    (() => {
                      // 即时乐观:original=纯文字转录 + m._audioUrl;入库后:original=JSON{text,audioUrl}
                      let vText = original;
                      let vAudio: string | null = m._audioUrl ?? null;
                      try {
                        const p = JSON.parse(original) as { text?: string; audioUrl?: string | null };
                        if (p && typeof p === 'object') {
                          if (typeof p.text === 'string') vText = p.text;
                          if ('audioUrl' in p) vAudio = p.audioUrl ?? vAudio;
                        }
                      } catch {
                        vText = original; // 旧格式:original 即纯文字转录(保持默认)
                      }
                      return <VoiceWhisperBubble transcript={vText} audioUrl={vAudio} />;
                    })()
                  ) : m.type === 'gift' ? (
                    (() => {
                      // 礼物消息:original=JSON{emoji,name,points}(后端 reactToGift 发,双方可见)
                      let g = { emoji: '💝', name: '一份心意', points: 0 };
                      try {
                        const p = JSON.parse(original) as { emoji?: string; name?: string; points?: number };
                        if (p && typeof p === 'object') {
                          g = { emoji: p.emoji ?? '💝', name: p.name ?? '一份心意', points: p.points ?? 0 };
                        }
                      } catch {
                        /* 解析失败用默认 */
                      }
                      return <GiftBubble emoji={g.emoji} name={g.name} points={g.points} />;
                    })()
                  ) : m.type === 'image' ? (
                    /* M18 · 解锁后的真实私密图气泡 */
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={original}
                      alt="她发来的照片"
                      className="max-w-full rounded-2xl rounded-bl-md object-cover shadow-warm-xs"
                      style={{ maxHeight: 360 }}
                    />
                  ) : (
                  /* 主气泡 · 永远显原文 (微信式 · 用户能看见消息真实内容) */
                  <div
                    className={`${mine ? 'msg-bubble-mine' : 'msg-bubble-other'} transition-opacity ${
                      m._status === 'sending' ? 'opacity-60' : ''
                    } ${m._status === 'failed' ? 'ring-2 ring-red-300 cursor-pointer' : ''}`}
                    onClick={m._status === 'failed' && m._origText ? () => void retry(m.id, m._origText!) : undefined}
                    title={m._status === 'failed' ? '点击重发' : undefined}
                  >
                    <div className="whitespace-pre-wrap break-words">{(original ?? '').replace(/\n{2,}/g, '\n').trim()}</div>
                    {m.isEncrypted === 1 && (
                      <div className={`mt-1.5 text-[10px] ${mine ? 'text-white/70' : 'text-warm-500'}`}>🔐 端到端加密</div>
                    )}
                    {m.redlineAction === 'rewrite' && !mine && (
                      <div className={`mt-1 text-[10px] ${mine ? 'text-white/70' : 'text-warm-600'}`}>
                        ⚠️ 系统已改写部分敏感内容
                      </div>
                    )}
                  </div>
                  )}

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
          {/* 快捷条按视角分流:客户=送礼/约钟等掏钱动作;技师=技师本人需要的(发素材等),互不串 */}
          {conv?.counterpartyTherapistId ? (
            <QuickActionsBar
              onGift={() => setGiftSheetOpen(true)}
              onBook={handleBook}
              onUnlock={() => void handleUnlock()}
            />
          ) : me && conv && me === conv.therapistUserId ? (
            <TherapistQuickBar
              onSendImage={(url) => void sendImage(url)}
              onScheduleOffer={() => sendScheduleOffer()}
              onPickReply={(text) => setInput(text)}
              alterLocked={conv.alterLockedAt != null}
              onToggleTakeover={(locked) => toggleAlterTakeover(locked)}
            />
          ) : null}
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
              placeholder={stt.recording ? '正在听… 松开发送' : e2eEnabled ? '加密发送…' : '说点什么…'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
            />
            {stt.supported && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  startTalk();
                }}
                onPointerUp={stopTalk}
                onPointerLeave={stopTalk}
                onPointerCancel={stopTalk}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition ${
                  stt.recording
                    ? 'bg-rose-500 text-white animate-pulse'
                    : 'bg-white text-ink-600 shadow-warm-xs active:bg-warm-50'
                }`}
                aria-label="按住说话"
                title="按住说话"
              >
                <Mic className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !input.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-cta text-white shadow-rose-md disabled:opacity-50"
              aria-label="发送"
            >
              ↑
            </button>
          </div>
          {stt.error && <div className="mt-1 px-3 text-[11px] text-rose-500">{stt.error}</div>}
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
            conversationId={id ?? ''}
            onClose={() => setGiftSheetOpen(false)}
            onSent={handleGiftSent}
          />
          {/* 送礼全屏仪式感动效(飞行/分档绽放/粒子/震动/音效) */}
          <GiftCeremony gift={giftCeremony} onDone={() => setGiftCeremony(null)} />
        </>
      )}

      {/* 客户档案弹层(技师视角) */}
      {me && conv && me === conv.therapistUserId && conv.customerId ? (
        <CustomerNotesSheet
          isOpen={notesSheetOpen}
          customerId={conv.customerId}
          onClose={() => setNotesSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}
