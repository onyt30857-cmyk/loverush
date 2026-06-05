'use client';

/**
 * 送礼仪式感全屏动效（M18 · 纯 CSS/Web Audio，零美术资源依赖）
 *
 * 借鉴直播打赏"越贵越华丽"的分层仪式感，适配 1对1 私聊（她单独为你绽放）：
 *   - light(≤80 奶茶/玫瑰)：飘心上升 + 礼物轻弹
 *   - mid(≤300 巧克力/香水)：礼物放大 + 光环脉冲 + 半屏暖光
 *   - heavy(>300 项链/钻戒)：全屏闪光 + 巨型礼物爆发 + 粒子四射 + 强震动 + 音效高潮
 * 三件套：视觉(CSS) + 震动(navigator.vibrate) + 音效(Web Audio 合成升调和弦)。
 * 后续美术到位可整体替换为 Lottie/SVGA，调用契约不变。
 */
import { useEffect, useRef } from 'react';

export interface GiftCeremonyGift {
  emoji: string;
  name: string;
  points: number;
}
export interface GiftCeremonyProps {
  gift: GiftCeremonyGift | null;
  onDone: () => void;
}

type Tier = 'light' | 'mid' | 'heavy';
function tierOf(points: number): Tier {
  if (points <= 80) return 'light';
  if (points <= 300) return 'mid';
  return 'heavy';
}

const VIBRATE: Record<Tier, number[]> = {
  light: [40],
  mid: [60, 30, 60],
  heavy: [50, 30, 90, 30, 200],
};
const DURATION: Record<Tier, number> = { light: 1700, mid: 2300, heavy: 3200 };
const TIER_TEXT: Record<Tier, string> = { light: '送给她 💝', mid: '为你心动 ✨', heavy: '💎 专属绽放 💎' };

// Web Audio 合成升调和弦（惊喜感，无需音频文件）
function playChime(tier: Tier) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = tier === 'heavy' ? [523, 659, 784, 1047] : tier === 'mid' ? [523, 659, 784] : [659, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.32);
    });
    setTimeout(() => void ctx.close(), (notes.length * 0.12 + 0.4) * 1000);
  } catch {
    /* 音效失败不影响视觉 */
  }
}

export function GiftCeremony({ gift, onDone }: GiftCeremonyProps) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!gift) return;
    const tier = tierOf(gift.points);
    try {
      navigator.vibrate?.(VIBRATE[tier]);
    } catch {
      /* 部分浏览器无 vibrate */
    }
    playChime(tier);
    const t = window.setTimeout(() => onDoneRef.current(), DURATION[tier]);
    return () => window.clearTimeout(t);
  }, [gift]);

  if (!gift) return null;
  const tier = tierOf(gift.points);
  // heavy 粒子：心/星四散
  const particles = tier === 'heavy' ? ['💖', '✨', '💫', '💝', '⭐', '💖', '✨', '💫', '🌟', '💖', '✨', '💫'] : [];

  return (
    <div className={`gc-root gc-${tier}`} aria-hidden>
      <div className="gc-veil" />
      <div className="gc-glow" />
      <div className="gc-stage">
        <div className="gc-emoji">{gift.emoji}</div>
        <div className="gc-name">{gift.name}</div>
        <div className="gc-tag">{TIER_TEXT[tier]}</div>
      </div>
      {particles.map((p, i) => {
        const angle = (i / particles.length) * Math.PI * 2;
        const dx = Math.round(Math.cos(angle) * 42);
        const dy = Math.round(Math.sin(angle) * 42);
        return (
          <span
            key={i}
            className="gc-particle"
            style={{
              ['--dx' as string]: `${dx}vmin`,
              ['--dy' as string]: `${dy}vmin`,
              animationDelay: `${0.4 + i * 0.03}s`,
            }}
          >
            {p}
          </span>
        );
      })}

      <style jsx>{`
        .gc-root {
          position: fixed;
          inset: 0;
          z-index: 90;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          overflow: hidden;
        }
        .gc-veil {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 45%, rgba(255, 120, 160, 0.28), rgba(0, 0, 0, 0.18) 70%);
          animation: gc-veil-in 0.3s ease-out both;
        }
        .gc-heavy .gc-veil {
          background: radial-gradient(circle at 50% 45%, rgba(255, 150, 180, 0.5), rgba(120, 40, 90, 0.4) 60%, rgba(0, 0, 0, 0.5));
          animation: gc-veil-in 0.25s ease-out both, gc-flash 0.5s ease-out 0.1s 2;
        }
        .gc-glow {
          position: absolute;
          width: 60vmin;
          height: 60vmin;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255, 180, 200, 0.55), transparent 65%);
          opacity: 0;
        }
        .gc-mid .gc-glow,
        .gc-heavy .gc-glow {
          animation: gc-pulse 1.1s ease-out 0.15s 2;
        }
        .gc-heavy .gc-glow {
          width: 92vmin;
          height: 92vmin;
          background: radial-gradient(circle, rgba(255, 210, 120, 0.6), rgba(255, 120, 170, 0.3) 45%, transparent 70%);
        }
        .gc-stage {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          animation: gc-rise 0.6s cubic-bezier(0.2, 1.4, 0.4, 1) both;
        }
        .gc-emoji {
          font-size: 84px;
          line-height: 1;
          filter: drop-shadow(0 8px 20px rgba(220, 60, 110, 0.45));
          animation: gc-pop 0.6s cubic-bezier(0.2, 1.5, 0.4, 1) both;
        }
        .gc-mid .gc-emoji {
          font-size: 104px;
        }
        .gc-heavy .gc-emoji {
          font-size: 132px;
          animation: gc-pop 0.6s cubic-bezier(0.2, 1.6, 0.4, 1) both, gc-spin 3s ease-in-out 0.6s 1;
        }
        .gc-name {
          font-size: 16px;
          font-weight: 700;
          color: #fff;
          text-shadow: 0 2px 10px rgba(200, 40, 90, 0.6);
          animation: gc-fade 0.5s ease-out 0.3s both;
        }
        .gc-tag {
          font-size: 13px;
          font-weight: 600;
          color: #ffe3ef;
          letter-spacing: 1px;
          text-shadow: 0 2px 8px rgba(200, 40, 90, 0.5);
          animation: gc-fade 0.5s ease-out 0.45s both;
        }
        .gc-heavy .gc-tag {
          font-size: 16px;
          color: #fff6d8;
        }
        .gc-particle {
          position: absolute;
          top: 46%;
          left: 50%;
          font-size: 26px;
          opacity: 0;
          animation: gc-burst 1.5s ease-out 0.4s 1 both;
          transform-origin: center;
        }
        @keyframes gc-veil-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes gc-flash {
          0%,
          100% {
            filter: brightness(1);
          }
          50% {
            filter: brightness(1.8);
          }
        }
        @keyframes gc-pulse {
          0% {
            opacity: 0;
            transform: scale(0.3);
          }
          40% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: scale(1.5);
          }
        }
        @keyframes gc-rise {
          from {
            opacity: 0;
            transform: translateY(40px) scale(0.6);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes gc-pop {
          0% {
            transform: scale(0.2) rotate(-12deg);
          }
          70% {
            transform: scale(1.18) rotate(6deg);
          }
          100% {
            transform: scale(1) rotate(0);
          }
        }
        @keyframes gc-spin {
          0%,
          100% {
            transform: rotate(0);
          }
          50% {
            transform: rotate(8deg);
          }
        }
        @keyframes gc-fade {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes gc-burst {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.4);
          }
          20% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
