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

const STEP_ORDER: Step[] = ['welcome', 'invite', 'name', 'choose-type', 'country', 'services'];

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
  const [userType, setUserType] = useState<'customer' | 'therapist' | null>(null);
  const [presetType, setPresetType] = useState<'customer' | 'therapist' | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  // 读 URL ?type 预设身份(从落地页「我是技师」入口进来时跳过身份选择),并替换欢迎气泡为对应文案
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('type');
    if (t === 'therapist' || t === 'customer') {
      setPresetType(t);
      if (t === 'therapist') {
        setBubbles([
          { side: 'system', text: '欢迎入驻 LoveRush', en: 'WELCOME · 技师入驻' },
          { side: 'system', text: '3 分钟完成入驻，撮合不抽佣', en: 'JOIN AS A THERAPIST' },
        ]);
      }
    }
  }, []);

  const stepIndex = STEP_ORDER.indexOf(step);
  const progress = Math.round(((stepIndex) / (STEP_ORDER.length - 1)) * 100);

  // 自动滚到底
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bubbles]);

  // 自动 advance · welcome → invite。邀请码文案按身份分(技师从平台/上级技师拿,客户从技师/朋友拿)
  useEffect(() => {
    if (step === 'welcome') {
      const t = setTimeout(() => {
        const inviteText = presetType === 'therapist'
          ? '请输入技师邀请码 ✨ 从平台或邀请你的人处获取'
          : '早期用户需要邀请码 ✨ 从技师或朋友处获取';
        setBubbles((b) => [
          ...b,
          { side: 'system', text: inviteText, en: 'INVITE CODE · 必填' },
        ]);
        setStep('invite');
      }, 700);
      return () => clearTimeout(t);
    }
  }, [step, presetType]);

  function pushBubble(b: Bubble) {
    setBubbles((arr) => [...arr, b]);
  }

  function commitInvite() {
    const v = textDraft.trim();
    // 公开邀约期 · 邀请码可选(空时直接通过,后端不再校验)
    // 仅当用户主动填了内容,长度 < 4 才报错
    if (v.length > 0 && v.length < 4) {
      setError('邀请码至少 4 位,或留空跳过');
      return;
    }
    setError(null);
    setInviteCode(v);
    pushBubble({ side: 'user', text: v || '(跳过邀请码)' });
    setTextDraft('');
    setTimeout(() => {
      pushBubble({ side: 'system', text: '收到 ✨ 我可以怎么叫你？', en: 'NICKNAME · 称呼' });
      setStep('name');
    }, 250);
  }
  // 邀约期"跳过"快捷:跟 commitInvite('') 等价
  function skipInvite() {
    setError(null);
    setInviteCode('');
    pushBubble({ side: 'user', text: '(跳过邀请码)' });
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
      if (presetType) {
        // 从「我是技师」等入口带身份进来，跳过身份选择
        startBranch(presetType, v);
      } else {
        pushBubble({ side: 'system', text: `你好 ${v} · 你想找服务还是提供服务？`, en: 'I AM A...' });
        setStep('choose-type');
      }
    }, 250);
  }

  // 身份确定后进入对应分支：都先问国家/地区（技师=服务地区，客户=常驻国家）
  function startBranch(type: 'customer' | 'therapist', name?: string) {
    setUserType(type);
    pushBubble(
      type === 'therapist'
        ? { side: 'system', text: '欢迎入驻 💝 你在哪个国家/地区提供服务？', en: 'SERVICE REGION · 服务地区' }
        : { side: 'system', text: `${name ? `你好 ${name} · ` : ''}你常在哪个国家？`, en: 'COUNTRY · 国家' },
    );
    setStep('country');
  }

  function chooseType(type: 'customer' | 'therapist') {
    pushBubble({ side: 'user', text: type === 'customer' ? '我想找服务' : '我提供服务' });
    setTimeout(() => startBranch(type), 250);
  }

  function commitCountry(c: string) {
    setCountry(c);
    pushBubble({ side: 'user', text: c });
    setTimeout(() => {
      if (userType === 'therapist') {
        // 技师不问"你喜欢什么按摩"，直接建号，进工作台后补 5 维档案/核验
        void commitRegister('therapist');
      } else {
        pushBubble({ side: 'system', text: '你喜欢什么类型的按摩？可多选', en: 'SERVICE · 服务类型' });
        setStep('services');
      }
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
    setTimeout(() => void commitRegister('customer'), 250);
  }

  async function commitRegister(type: 'customer' | 'therapist') {
    setError(null);
    setStep('submitting');
    setLoading(true);
    try {
      const data = await apiPost<RegisterResponse>('/auth/register', {
        user_type: type,
        // 空 invite_code 时不传字段(后端按可选处理)· 公开邀约期
        ...(inviteCode ? { invite_code: inviteCode } : {}),
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
      sessionStorage.setItem('pending_user_type', type);
      // Phase C · PIN 设置步骤要用:用户 id + 昵称(显示在解锁屏)
      sessionStorage.setItem('pending_user_id', data.user.id);
      sessionStorage.setItem('pending_display_name', data.user.displayName ?? '');
      router.push('/register/backup');
    } catch (err) {
      setLoading(false);
      setStep(type === 'therapist' ? 'country' : 'services'); // 回到最后一步可重试，不退回身份选择
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
            <div className="text-serif-cn text-[12px] font-medium text-ink-900">
              {presetType === 'therapist' || userType === 'therapist' ? '技师入驻' : '注册引导'}
            </div>
            <div className="font-cormorant italic text-[9px] tracking-[0.3em] text-ink-500">
              {presetType === 'therapist' || userType === 'therapist' ? 'THERAPIST ONBOARDING' : 'SMART ONBOARDING'}
            </div>
          </div>
        </div>
      </header>

      {/* === Progress · M7：上下间距收紧（pb-2 pt-1.5），不再吃聊天区空间 === */}
      <div className="px-4 pb-2 pt-1.5">
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
      {/* M7 修复 · §1/§2：聊天区 padding 紧凑（pb-2，避免大量上方留白把输入区挤到中下），
         system bubble 间距统一 space-y-2.5；最新 system bubble 高亮（border-primary/20 + shadow-rose-md），
         明确"当前活跃步骤"，避免步骤卡色阶塌成一片 */}
      <div className="flex-1 space-y-2.5 overflow-y-auto px-4 pb-2 pt-1">
        {bubbles.map((b, i) => {
          const isLast = i === bubbles.length - 1;
          const isActive = isLast && b.side === 'system' && step !== 'submitting';
          return (
            <div key={i} className={`flex ${b.side === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-6 transition-shadow ${
                  b.side === 'user'
                    ? 'rounded-br-sm bg-gradient-cta text-white shadow-warm-sm'
                    : isActive
                      ? 'rounded-bl-sm border border-primary/25 bg-white text-ink-900 shadow-rose-md'
                      : 'rounded-bl-sm bg-white text-ink-800 shadow-warm-xs'
                }`}
              >
                {b.en && b.side === 'system' && (
                  <div
                    className={`mb-1 font-cormorant italic text-[9px] tracking-[0.3em] ${
                      isActive ? 'text-primary' : 'text-warm-500'
                    }`}
                  >
                    {b.en}
                  </div>
                )}
                <div
                  className={b.side === 'system' ? 'text-serif-cn' : ''}
                  dangerouslySetInnerHTML={{ __html: b.text }}
                />
              </div>
            </div>
          );
        })}

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
              onClick={() => chooseType('customer')}
              disabled={loading}
              className="flex flex-col items-center rounded-2xl border-2 border-primary bg-white py-5 shadow-rose-md active:scale-[0.98] disabled:opacity-60"
            >
              <div className="text-3xl">🌸</div>
              <div className="mt-1.5 text-serif-cn text-base font-semibold text-ink-900">我想找服务</div>
              <div className="font-cormorant italic mt-0.5 text-[10px] tracking-[0.3em] text-primary">CUSTOMER</div>
            </button>
            <button
              type="button"
              onClick={() => chooseType('therapist')}
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
              placeholder={step === 'invite' ? '输入邀请码(可留空跳过)' : '输入昵称'}
              autoFocus
              autoCapitalize={step === 'invite' ? 'characters' : 'none'}
              className="flex-1 rounded-full bg-ink-50 px-4 py-2.5 text-sm text-ink-900 outline-none focus:bg-white focus:shadow-warm-xs"
            />
            <button
              type="button"
              onClick={step === 'invite' ? commitInvite : commitName}
              disabled={step === 'name' && textDraft.trim().length === 0}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-cta text-white shadow-warm-md disabled:opacity-30 active:scale-95"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          {step === 'invite' && (
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={skipInvite}
                className="text-[11px] text-ink-500 underline-offset-2 hover:underline"
              >
                没有邀请码 · 跳过
              </button>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-warm-100 bg-white px-4 py-2 text-center font-cormorant italic text-[9px] tracking-[0.3em] text-ink-500">
        {presetType === 'therapist' || userType === 'therapist'
          ? 'SECURE · YOUR EARNINGS BELONG TO YOU'
          : 'SECURE · YOUR ANSWERS NEVER SHARED WITH THERAPISTS'}
      </div>
    </div>
  );
}
