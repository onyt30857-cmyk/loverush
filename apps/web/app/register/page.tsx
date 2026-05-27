'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Sparkles, Check } from 'lucide-react';
import { ApiClientError, apiPost, saveTokens } from '@/lib/api';
import { deriveStaticKeyPair, storeKeyPair } from '@/lib/crypto';

interface RegisterResponse {
  user: { id: string; userType: 'customer' | 'therapist'; displayName: string | null };
  mnemonic: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

type Step = 'welcome' | 'invite' | 'name' | 'country' | 'services' | 'choose-type' | 'submitting';

interface Bubble {
  side: 'system' | 'user';
  text: string;
  en?: string;
}

const COUNTRIES = ['🇹🇭 泰国', '🇸🇬 新加坡', '🇲🇾 马来西亚', '🇮🇩 印尼', '🇻🇳 越南', '🇵🇭 菲律宾'];
const SERVICES = ['泰式经典', '深度油压', 'SPA 套餐', '中医推拿', '足疗', '芳疗'];

const STEP_ORDER: Step[] = ['welcome', 'invite', 'name', 'country', 'services', 'choose-type'];

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('welcome');
  const [bubbles, setBubbles] = useState<Bubble[]>([
    { side: 'system', text: '欢迎来到 LoveRush', en: 'WELCOME' },
    { side: 'system', text: '3 分钟让我们更懂你的偏好', en: 'TELL ME ABOUT YOURSELF' },
  ]);
  const [inviteCode, setInviteCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [country, setCountry] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [textDraft, setTextDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const stepIndex = STEP_ORDER.indexOf(step);
  const progress = Math.round(((stepIndex) / (STEP_ORDER.length - 1)) * 100);

  // 自动滚到底
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bubbles]);

  // 自动 advance · welcome → invite（首屏延后 600ms 让用户感受 chat 体验）
  useEffect(() => {
    if (step === 'welcome') {
      const t = setTimeout(() => {
        setBubbles((b) => [
          ...b,
          { side: 'system', text: '早期用户需要邀请码 ✨ 从技师或朋友处获取', en: 'INVITE CODE · 必填' },
        ]);
        setStep('invite');
      }, 700);
      return () => clearTimeout(t);
    }
  }, [step]);

  function pushBubble(b: Bubble) {
    setBubbles((arr) => [...arr, b]);
  }

  function commitInvite() {
    const v = textDraft.trim();
    if (v.length < 4) {
      setError('邀请码至少 4 位');
      return;
    }
    setError(null);
    setInviteCode(v);
    pushBubble({ side: 'user', text: v });
    setTextDraft('');
    setTimeout(() => {
      pushBubble({ side: 'system', text: '收到 ✨ 我可以怎么叫你？', en: 'NICKNAME · 称呼' });
      setStep('name');
    }, 250);
  }

  function commitName() {
    const v = textDraft.trim();
    if (v.length === 0) {
      setError('请输入一个昵称');
      return;
    }
    setError(null);
    setNickname(v);
    pushBubble({ side: 'user', text: v });
    setTextDraft('');
    setTimeout(() => {
      pushBubble({ side: 'system', text: `你好 ${v} · 你常在哪个国家？`, en: 'COUNTRY · 国家' });
      setStep('country');
    }, 250);
  }

  function commitCountry(c: string) {
    setCountry(c);
    pushBubble({ side: 'user', text: c });
    setTimeout(() => {
      pushBubble({ side: 'system', text: '你喜欢什么类型的按摩？可多选', en: 'SERVICE · 服务类型' });
      setStep('services');
    }, 250);
  }

  function toggleService(s: string) {
    setServices((curr) => (curr.includes(s) ? curr.filter((x) => x !== s) : [...curr, s]));
  }

  function commitServices() {
    if (services.length === 0) {
      setError('至少选一项');
      return;
    }
    setError(null);
    pushBubble({ side: 'user', text: services.join(' · ') });
    setTimeout(() => {
      pushBubble({ side: 'system', text: '最后一步 · 你想找服务还是提供服务？', en: 'I AM A...' });
      setStep('choose-type');
    }, 250);
  }

  async function commitRegister(userType: 'customer' | 'therapist') {
    setError(null);
    pushBubble({ side: 'user', text: userType === 'customer' ? '我想找服务' : '我提供服务' });
    setStep('submitting');
    setLoading(true);
    try {
      const data = await apiPost<RegisterResponse>('/auth/register', {
        user_type: userType,
        invite_code: inviteCode,
        display_name: nickname,
        locale: 'zh',
      });
      saveTokens(data.access_token, data.refresh_token);

      // D-204 · 派生 X25519 静态密钥对
      try {
        const kp = await deriveStaticKeyPair(data.mnemonic);
        await storeKeyPair(kp);
        await apiPost('/me/encryption-key', {
          algorithm: 'x25519',
          public_key: kp.publicKeyB64,
        });
      } catch (e) {
        console.warn('[crypto] key derivation failed:', e);
      }

      // 偏好信息暂存 · v1.1 提交 /me/preferences
      try {
        sessionStorage.setItem(
          'pending_preferences',
          JSON.stringify({ country, services }),
        );
      } catch {
        // ignore
      }

      sessionStorage.setItem('pending_mnemonic', data.mnemonic);
      sessionStorage.setItem('pending_user_type', userType);
      router.push('/register/backup');
    } catch (err) {
      setLoading(false);
      setStep('choose-type');
      if (err instanceof ApiClientError) {
        setError(`${err.payload.code} · ${err.payload.message}`);
      } else {
        setError(String((err as Error).message));
      }
    }
  }

  return (
    <div className="mobile-container flex flex-col">
      {/* === Top Nav · 注册引导 (无 AI 字样 · v5 政策) === */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 bg-white/85 px-4 backdrop-blur-md">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-ink-700 shadow-warm-xs active:scale-95"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex flex-1 items-center gap-2.5 rounded-full bg-white px-3 py-1.5 shadow-warm-xs">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-cta">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <div className="text-serif-cn text-[12px] font-medium text-ink-900">注册引导</div>
            <div className="font-cormorant italic text-[9px] tracking-[0.3em] text-ink-500">SMART ONBOARDING</div>
          </div>
        </div>
      </header>

      {/* === Progress === */}
      <div className="px-4 pb-3 pt-2">
        <div className="flex items-center gap-2">
          <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full bg-gradient-cta transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="font-cormorant italic text-[10px] tracking-wider text-ink-500">
            {stepIndex}/{STEP_ORDER.length - 1}
          </span>
        </div>
      </div>

      {/* === Chat area === */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {bubbles.map((b, i) => (
          <div key={i} className={`flex ${b.side === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-6 ${
                b.side === 'user'
                  ? 'rounded-br-sm bg-gradient-cta text-white shadow-warm-sm'
                  : 'rounded-bl-sm bg-white text-ink-800 shadow-warm-xs'
              }`}
            >
              {b.en && b.side === 'system' && (
                <div className="mb-1 font-cormorant italic text-[9px] tracking-[0.3em] text-primary">{b.en}</div>
              )}
              <div className={b.side === 'system' ? 'text-serif-cn' : ''} dangerouslySetInnerHTML={{ __html: b.text }} />
            </div>
          </div>
        ))}

        {/* 选项区 · 根据当前 step 决定 */}
        {step === 'country' && (
          <div className="ml-1 mt-2 flex flex-wrap gap-2">
            {COUNTRIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => commitCountry(c)}
                className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-800 shadow-warm-xs active:scale-95 hover:bg-warm-50"
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {step === 'services' && (
          <>
            <div className="ml-1 mt-2 flex flex-wrap gap-2">
              {SERVICES.map((s) => {
                const on = services.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleService(s)}
                    className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] active:scale-95 ${
                      on
                        ? 'bg-gradient-cta text-white shadow-warm-sm'
                        : 'bg-white text-ink-800 shadow-warm-xs hover:bg-warm-50'
                    }`}
                  >
                    {on && <Check className="h-3 w-3" />}
                    {s}
                  </button>
                );
              })}
            </div>
            {services.length > 0 && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={commitServices}
                  className="rounded-full bg-gradient-cta px-5 py-2 text-[12px] font-medium text-white shadow-warm-md active:scale-95"
                >
                  确认 · {services.length} 项
                </button>
              </div>
            )}
          </>
        )}

        {step === 'choose-type' && (
          <div className="ml-1 mt-3 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => commitRegister('customer')}
              disabled={loading}
              className="flex flex-col items-center rounded-2xl border-2 border-primary bg-white py-5 shadow-rose-md active:scale-[0.98] disabled:opacity-60"
            >
              <div className="text-3xl">🌸</div>
              <div className="mt-1.5 text-serif-cn text-base font-semibold text-ink-900">我想找服务</div>
              <div className="font-cormorant italic mt-0.5 text-[10px] tracking-[0.3em] text-primary">CUSTOMER</div>
            </button>
            <button
              type="button"
              onClick={() => commitRegister('therapist')}
              disabled={loading}
              className="flex flex-col items-center rounded-2xl border-2 border-warm-100 bg-white py-5 shadow-warm-xs active:scale-[0.98] disabled:opacity-60"
            >
              <div className="text-3xl">💝</div>
              <div className="mt-1.5 text-serif-cn text-base font-semibold text-ink-900">我提供服务</div>
              <div className="font-cormorant italic mt-0.5 text-[10px] tracking-[0.3em] text-ink-500">THERAPIST</div>
            </button>
          </div>
        )}

        {step === 'submitting' && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-warm-xs">
              <span className="h-2 w-2 rounded-full bg-primary/40 animate-typing" />
              <span className="h-2 w-2 rounded-full bg-primary/40 animate-typing" style={{ animationDelay: '0.15s' }} />
              <span className="h-2 w-2 rounded-full bg-primary/40 animate-typing" style={{ animationDelay: '0.3s' }} />
            </div>
          </div>
        )}

        {error && (
          <div className="mx-1 mt-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
            {error}
          </div>
        )}

        <div ref={chatEnd} />
      </div>

      {/* === Input area · 仅 text question 显示 === */}
      {(step === 'invite' || step === 'name') && (
        <div className="border-t border-warm-100 bg-white px-3 py-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  step === 'invite' ? commitInvite() : commitName();
                }
              }}
              placeholder={step === 'invite' ? '输入 4-8 位邀请码' : '输入昵称'}
              autoFocus
              autoCapitalize={step === 'invite' ? 'characters' : 'none'}
              className="flex-1 rounded-full bg-ink-50 px-4 py-2.5 text-sm text-ink-900 outline-none focus:bg-white focus:shadow-warm-xs"
            />
            <button
              type="button"
              onClick={step === 'invite' ? commitInvite : commitName}
              disabled={textDraft.trim().length === 0}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-cta text-white shadow-warm-md disabled:opacity-30 active:scale-95"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-warm-100 bg-white px-4 py-2 text-center font-cormorant italic text-[9px] tracking-[0.3em] text-ink-500">
        SECURE · YOUR ANSWERS NEVER SHARED WITH THERAPISTS
      </div>
    </div>
  );
}
