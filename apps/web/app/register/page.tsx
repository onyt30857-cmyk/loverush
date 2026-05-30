'use client';

/**
 * 注册引导 · 身份选择页
 * 客户和技师入口分开:点对应卡片跳到独立注册页
 */

import Link from 'next/link';
import { Heart, ArrowRight, Sparkles, Wallet } from 'lucide-react';

export default function RegisterChoicePage() {
  return (
    <div className="mobile-container bg-gradient-soft">
      {/* 顶部 */}
      <div className="flex items-center justify-between px-6 pt-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl heart-logo">
            <Heart className="h-4 w-4 fill-white text-white" />
          </div>
          <div className="font-serif-cn text-lg font-semibold">LoveRush</div>
        </Link>
        <Link href="/login" className="text-[11px] text-ink-500 hover:text-primary">
          已有账号 →
        </Link>
      </div>

      {/* 引导 */}
      <div className="px-6 pt-10">
        <div className="label-cormorant mb-1.5">CHOOSE YOUR ROLE</div>
        <h1 className="font-serif-cn text-[28px] font-semibold leading-tight text-ink-900">
          你是 <span className="text-primary">客户</span>,还是 <span style={{ color: '#B8398C' }}>技师</span>?
        </h1>
        <p className="mt-2 text-[12.5px] text-ink-500 leading-relaxed">
          两个角色的体验不同 · 选好身份再注册
        </p>
      </div>

      {/* 双卡片选择 */}
      <div className="mt-8 space-y-3 px-6">
        {/* 客户 */}
        <Link
          href="/register/customer"
          className="block rounded-2xl border border-warm-100 bg-white p-5 shadow-warm-sm transition active:scale-[0.99] hover:border-primary/40"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-cta">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-serif-cn text-[16px] font-bold text-ink-900">客户 · 寻找服务</h2>
                <ArrowRight className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-1 text-[11px] text-ink-500 leading-relaxed">
                AI 助理 1→3 精选 · 不刷 100 个 · 隐身够稳 · 老客户精准命中
              </p>
              <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-warm-50 px-2 py-0.5 text-[10px] font-medium text-warm-700">
                ✨ 免费用 · 30 秒注册
              </div>
            </div>
          </div>
        </Link>

        {/* 技师 */}
        <Link
          href="/register/therapist"
          className="block rounded-2xl border bg-white p-5 shadow-sm transition active:scale-[0.99]"
          style={{ borderColor: 'rgba(184,57,140,0.2)' }}
        >
          <div className="flex items-start gap-3">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
              style={{ background: 'linear-gradient(135deg, #FF6BAA, #B8398C)' }}
            >
              <Wallet className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-serif-cn text-[16px] font-bold text-ink-900">技师 · 入驻接单</h2>
                <ArrowRight className="h-4 w-4" style={{ color: '#B8398C' }} />
              </div>
              <p className="mt-1 text-[11px] text-ink-500 leading-relaxed">
                撮合不抽佣 · 收入 100% 归你 · AI 红线守卫 · 离线 AI 分身替你聊
              </p>
              <div
                className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ background: 'rgba(184,57,140,0.08)', color: '#B8398C' }}
              >
                💰 平台不抽 · 30 秒入驻
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* 底部说明 */}
      <div className="mt-8 px-6 text-center text-[10.5px] text-ink-400">
        无助记词 · 账号 + 密码登录 · 想清楚再选
      </div>
    </div>
  );
}
