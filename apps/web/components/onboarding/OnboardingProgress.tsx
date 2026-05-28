/**
 * 6 节进度条 · M03 F03-OB1 顶部
 *
 * 每节独立小方块,完成态填玫红渐变,当前节脉冲。
 */
'use client';

interface Props {
  step: number; // 1-6
}

export function OnboardingProgress({ step }: Props) {
  return (
    <div
      className="flex items-center gap-1"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={6}
      aria-valuenow={step}
      aria-label={`Onboarding 进度 ${step}/6`}
    >
      {Array.from({ length: 6 }).map((_, i) => {
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
