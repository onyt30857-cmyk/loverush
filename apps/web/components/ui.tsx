/**
 * 通用 UI primitives · 暖色系
 *
 * 设计语言对齐 prototypes/* · 详见 ARCHITECTURE.md §5
 */
'use client';

import Link from 'next/link';
import { type ReactNode } from 'react';

// ──────────────── Buttons ────────────────

export function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`btn-primary ${className}`}
    >
      {loading ? '处理中…' : children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} className={`btn-ghost ${className}`}>
      {children}
    </button>
  );
}

// ──────────────── Cards ────────────────

export function Card({
  children,
  className = '',
  elevated,
  href,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const cls = `${elevated ? 'card-warm-elevated' : 'card-warm'} ${className}`;
  if (href) {
    return (
      <Link href={href} className={`${cls} block transition active:scale-[0.99]`}>
        {children}
      </Link>
    );
  }
  return (
    <div className={cls} onClick={onClick}>
      {children}
    </div>
  );
}

// ──────────────── Empty / Loading / Error ────────────────

export function EmptyState({ title, hint, icon = '✨' }: { title: string; hint?: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="text-5xl">{icon}</div>
      <div className="mt-4 text-base font-medium text-ink-800 text-serif-cn">{title}</div>
      {hint && <div className="mt-1 text-sm text-ink-600">{hint}</div>}
    </div>
  );
}

export function LoadingFull() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="gradient-orb h-12 w-12" />
        <div className="label-cormorant">LOADING</div>
      </div>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mx-5 my-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
      {message}
    </div>
  );
}

// ──────────────── Chips / Badges ────────────────

export function PointsTag({ points }: { points: number }) {
  return (
    <span className="btn-pill">
      <span>💰</span>
      <span className="num">{points.toLocaleString()}</span>
    </span>
  );
}

export function Badge({ children, color = 'warm' }: { children: ReactNode; color?: 'warm' | 'success' | 'danger' }) {
  const colors = {
    warm: 'bg-warm-100 text-warm-700',
    success: 'bg-success-500/10 text-success-500',
    danger: 'bg-danger-500/10 text-danger-500',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

export function OnlineDot() {
  return <span className="online-dot" />;
}

// ──────────────── Avatar ────────────────

export function Avatar({ src, size = 48, fallback = '🙂' }: { src?: string | null; size?: number; fallback?: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover ring-2 ring-warm-100"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-full bg-warm-100 text-warm-500 ring-2 ring-warm-50"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {fallback}
    </div>
  );
}

// ──────────────── Section ────────────────

export function Section({
  title,
  subtitle,
  children,
  right,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`px-5 py-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink-800 text-serif-cn">{title}</h2>
          {subtitle && <div className="label-cormorant mt-0.5">{subtitle}</div>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

// ──────────────── 推荐技师卡（横滑） ────────────────

export interface RecCardProps {
  href: string;
  avatarUrl?: string | null;
  displayName: string;
  serviceCity?: string | null;
  scoreService: number;
  pricePoints?: number;
  isHot?: boolean;
}

export function RecCard({ href, avatarUrl, displayName, serviceCity, scoreService, pricePoints, isHot }: RecCardProps) {
  return (
    <Link
      href={href}
      className="block w-[150px] flex-shrink-0 overflow-hidden rounded-2xl border border-warm-100 bg-white shadow-warm-md transition active:scale-[0.98]"
    >
      <div className="relative h-[170px] overflow-hidden bg-warm-50">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" style={{ objectPosition: 'center 25%' }} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-5xl">🙂</div>
        )}
        {isHot && (
          <div className="absolute left-2 top-2 rounded bg-gradient-warm-rose px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white">
            🔥 HOT
          </div>
        )}
        <div className="score-pill absolute right-2 top-2">
          ★ {(scoreService / 10).toFixed(1)}
        </div>
      </div>
      <div className="px-2.5 py-2">
        <div className="truncate text-serif-cn text-[13px] font-semibold text-ink-800">{displayName}</div>
        {serviceCity && <div className="label-cormorant mt-0.5 text-[10px]">{serviceCity}</div>}
        {pricePoints != null && (
          <div className="text-display mt-1 text-[14px] font-bold text-primary num">{pricePoints}</div>
        )}
      </div>
    </Link>
  );
}

// ──────────────── 渐变 Logo Orb（用作助理图标 · 不带 "AI" 字样 · v5 政策） ────────────────

export function GradientOrb({ size = 32, icon }: { size?: number; icon?: ReactNode }) {
  return (
    <div className="gradient-orb" style={{ width: size, height: size, fontSize: size * 0.45 }}>
      <span className="text-white">{icon ?? '✨'}</span>
    </div>
  );
}

// ──────────────── Typing 指示器 ────────────────

export function TypingDots() {
  return (
    <div className="flex gap-1 px-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-warm-500"
          style={{ animation: 'typing 1.4s ease-in-out infinite', animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </div>
  );
}
