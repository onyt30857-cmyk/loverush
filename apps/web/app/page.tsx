import Link from 'next/link';

export default function Landing() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-gradient-soft">
      {/* 装饰 blob */}
      <div
        className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full opacity-50 blur-3xl"
        style={{ background: 'radial-gradient(circle, #FFC9BF 0%, transparent 70%)' }}
      />
      <div
        className="pointer-events-none absolute -bottom-20 -right-16 h-80 w-80 rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, #FFE0E7 0%, transparent 70%)' }}
      />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-8 py-12 text-center">
        {/* Logo */}
        <div className="gradient-orb h-20 w-20 text-3xl">💝</div>

        {/* Brand */}
        <h1 className="mt-6 text-serif-cn text-[40px] font-bold leading-tight tracking-tight text-ink-800">
          LoveRush
        </h1>
        <div className="label-cormorant mt-2 text-[11px]">FIND THE RIGHT ONE</div>

        {/* Slogan */}
        <p className="mt-10 text-serif-cn text-[19px] font-medium leading-relaxed text-ink-800">
          真人 · 真美 · 真私密
        </p>
        <p className="mt-3 text-[12px] leading-7 text-ink-600">
          匿名身份 · 24 词助记词即一切
          <br />
          不留手机号 · 不留邮箱
        </p>
      </div>

      {/* CTA */}
      <div className="relative z-10 flex flex-col gap-3 px-8 pb-10">
        <Link href="/register" className="btn-primary">
          开始注册
        </Link>
        <Link href="/recover" className="btn-ghost">
          助记词找回
        </Link>
        <p className="mt-2 text-center text-[10px] text-ink-500">
          继续即代表同意《用户协议》与《隐私政策》
        </p>
      </div>
    </main>
  );
}
