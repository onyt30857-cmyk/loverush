'use client';

import Link from 'next/link';
import { ArrowLeft, Sparkles, ShieldCheck, Coins, Bot } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function TherapistSplashPage() {
  const router = useRouter();

  return (
    <div className="mobile-container bg-gradient-soft">
      {/* 顶栏 · 返回客户版 */}
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between bg-white/80 px-4 backdrop-blur">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-700 active:bg-ink-100"
          aria-label="返回"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Link href="/" className="text-[11px] font-medium tracking-wider text-ink-500">
          前往客户版 →
        </Link>
      </header>

      {/* Hero */}
      <section className="px-6 pb-2 pt-8 text-center animate-fade-up">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-cta shadow-rose-lg">
          <Sparkles className="h-7 w-7 text-white" />
        </div>
        <div className="font-cormorant italic text-[11px] tracking-[0.3em] text-primary">FOR THERAPISTS</div>
        <h1 className="mt-2 text-serif-cn text-[26px] font-bold leading-tight text-ink-900">
          让认真的你，<br />
          被<span className="text-primary">认真地看见</span>
        </h1>
        <p className="mx-auto mt-3 max-w-[280px] text-[13px] leading-7 text-ink-600">
          撮合不抽佣 · 你赚的每一笔，都该真正属于你。
        </p>
      </section>

      {/* 痛点 */}
      <section className="mt-6 px-5 animate-fade-up" style={{ animationDelay: '120ms' }}>
        <div className="label-cormorant mb-2 text-center">YOUR PAIN POINTS</div>
        <ul className="space-y-2 rounded-2xl border border-warm-100 bg-white p-4 shadow-warm-xs">
          {[
            '客源不稳，今天爆单明天饿肚子',
            '平台抽成 50%–80%，做得越多被压得越多',
            '被无礼客户骚扰，平台不替你说话',
          ].map((t) => (
            <li key={t} className="flex items-start gap-2 text-[13px] leading-6 text-ink-700">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-300" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 我们的承诺 */}
      <section className="mt-4 px-5 animate-fade-up" style={{ animationDelay: '220ms' }}>
        <div className="label-cormorant mb-2 text-center">OUR PROMISE</div>
        <div className="grid grid-cols-3 gap-2">
          <Promise icon={<Coins className="h-4 w-4 text-primary" />} title="0 抽佣" sub="撮合不收佣" />
          <Promise icon={<ShieldCheck className="h-4 w-4 text-primary" />} title="凭证保护" sub="价格锁+留证" />
          <Promise icon={<Bot className="h-4 w-4 text-primary" />} title="AI 分身" sub="代你回客户" />
        </div>
      </section>

      {/* CTA */}
      <section className="mt-7 px-5 pb-8 animate-fade-up" style={{ animationDelay: '320ms' }}>
        <Link
          href="/register?type=therapist"
          className="btn-primary"
          style={{ textDecoration: 'none' }}
        >
          <Sparkles className="mr-1.5 h-4 w-4" />
          立即入驻 · 0 抽佣
        </Link>
        <div className="mt-3 text-center">
          <Link href="/recover" className="text-[12px] font-medium text-primary tracking-wider">
            已是技师 · 助记词登录 →
          </Link>
        </div>
        <p className="mt-4 text-center font-cormorant italic text-[9px] tracking-[0.3em] text-ink-400">
          SECURE · PRIVATE · YOU OWN YOUR WORK
        </p>
      </section>
    </div>
  );
}

function Promise({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-warm-100 bg-white px-2 py-3 text-center shadow-warm-xs">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">{icon}</div>
      <div className="mt-1.5 text-serif-cn text-[12.5px] font-semibold text-ink-900">{title}</div>
      <div className="mt-0.5 text-[10px] text-ink-500">{sub}</div>
    </div>
  );
}
