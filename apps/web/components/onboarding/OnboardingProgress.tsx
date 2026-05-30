/**
 * 9 节进度条 · 对齐 0522 信息采集表 · 顶部
 *
 * 每节独立小方块,完成态填玫红渐变,当前节脉冲。
 */
'use client';

const TOTAL = 9;

interface Props {
  step: number; // 1-9
}

export function OnboardingProgress({ step }: Props) {
  return (
    <div
      className="flex items-center gap-1"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={TOTAL}
      aria-valuenow={step}
      aria-label={`Onboarding 进度 ${step}/${TOTAL}`}
    >
      {Array.from({ length: TOTAL }).map((_, i) => {
        const idx = i + 1;
        const done = idx < step;
        const active = idx === step;
        return (
          <div
            key={idx}
            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
              done ? 'bg-gradient-cta' : active ? 'bg-warm-300' : 'bg-warm-100'
            } ${active ? 'animate-pulse' : ''}`}
          />
        );
      })}
    </div>
  );
}
