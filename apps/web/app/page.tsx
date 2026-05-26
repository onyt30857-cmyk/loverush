import Link from 'next/link';
import { Sparkles, ArrowRight, Heart, ShieldCheck, Languages } from 'lucide-react';

export default function Landing() {
  return (
    <main className="mobile-container flex flex-col">
      {/* === 装饰光晕 === */}
      <div
        className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full opacity-50 blur-3xl"
        style={{ background: 'radial-gradient(circle, #FFC9BF 0%, transparent 70%)' }}
      />
      <div
        className="pointer-events-none absolute -bottom-20 -right-16 h-80 w-80 rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, #FFE0E7 0%, transparent 70%)' }}
      />

      {/* === 闪光装饰 (twinkle) === */}
      <div className="absolute right-12 top-32 animate-pulse opacity-70">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M12 0L13.5 10.5L24 12L13.5 13.5L12 24L10.5 13.5L0 12L10.5 10.5L12 0Z" fill="#FFB5A8" />
        </svg>
      </div>
      <div className="absolute bottom-[280px] left-10 animate-pulse opacity-60" style={{ animationDelay: '1.5s' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path d="M12 0L13.5 10.5L24 12L13.5 13.5L12 24L10.5 13.5L0 12L10.5 10.5L12 0Z" fill="#FF5577" />
        </svg>
      </div>

      {/* === 顶部品牌区 === */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-8 py-12 text-center">
        {/* Logo · 渐变心 */}
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-cta shadow-warm-lg">
          <Heart className="h-9 w-9 fill-white text-white" />
        </div>

        {/* Brand */}
        <h1 className="mt-6 text-serif-cn text-[40px] font-bold leading-tight tracking-tight text-ink-900">
          LoveRush
        </h1>
        <div className="mt-2 font-cormorant italic text-[11px] tracking-[0.4em] text-primary">FIND THE RIGHT ONE</div>

        {/* Brand tagline · "Find Her Tonight" */}
        <div className="mt-10 font-cormorant italic text-xs font-semibold uppercase tracking-[0.4em] text-primary">
          Find Her Tonight
        </div>
        <h2 className="mt-4 text-serif-cn text-[28px] font-semibold leading-tight text-ink-900">
          今晚，<br />
          遇见<span className="bg-gradient-cta bg-clip-text text-transparent">对的那个她</span>
        </h2>

        {/* 引用块 */}
        <blockquote className="mt-6 border-l-2 border-primary/60 py-1.5 pl-4 text-left">
          <p className="text-serif-cn italic text-[13px] leading-7 text-ink-500">
            不再大海捞针，不再货不对版。<br />
            你的那个，就在这里等着被找到。
          </p>
        </blockquote>

        {/* 承诺卡 · 3 项 */}
        <div className="mt-6 w-full space-y-2">
          <PromiseRow icon={ShieldCheck} color="text-warm-400" title="隐私守护" sub="计算器伪装模式" />
          <PromiseRow icon={Languages} color="text-primary" title="跨语言私聊" sub="中 · 英 · 泰 · 越 · 马来 · 印尼" />
          <PromiseRow icon={ShieldCheck} color="text-emerald-500" title="真实真人核验认证" sub="不再货不对版" />
        </div>
      </div>

      {/* === CTA 区 === */}
      <div className="relative z-10 px-8 pb-10">
        <Link
          href="/register"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-cta py-3.5 text-white shadow-warm-md transition active:scale-[0.98]"
        >
          <Sparkles className="h-4 w-4 fill-white" />
          <span className="text-serif-cn text-sm font-medium tracking-wider">立即注册 · 智能匹配</span>
          <ArrowRight className="h-4 w-4" />
        </Link>

        <div className="mt-3 text-center">
          <Link href="/recover" className="text-[12.5px] font-semibold tracking-wider text-primary">
            已有账号 · 助记词登录 →
          </Link>
        </div>

        <p className="mt-4 text-center text-[10px] tracking-wider text-ink-500">
          继续即代表同意《用户协议》与《隐私政策》
        </p>
      </div>
    </main>
  );
}

function PromiseRow({
  icon: Icon,
  color,
  title,
  sub,
}: {
  icon: typeof Sparkles;
  color: string;
  title: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-warm-100/60 bg-white/80 p-3 backdrop-blur">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-warm-100/50 to-warm-200/30">
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className="flex-1 text-left text-[12.5px] leading-snug">
        <span className="font-semibold text-ink-900">{title}</span>
        <span className="ml-1 text-ink-500/80">{sub}</span>
      </div>
    </div>
  );
}
