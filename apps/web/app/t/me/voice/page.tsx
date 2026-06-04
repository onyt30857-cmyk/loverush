'use client';

/**
 * 技师 · 声音复刻独立页（菜单「🎙️ 声音复刻」直达）
 * 内容复用 VoiceCloneCard，与分身设置页共用同一组件。
 */

import { TherapistShell } from '@/components/AppShell';
import { GradientOrb } from '@/components/ui';
import { VoiceCloneCard } from '@/components/VoiceCloneCard';

export default function TherapistVoicePage() {
  return (
    <TherapistShell>
      <div className="bg-gradient-soft px-5 pb-3 pt-4 animate-fade-up">
        <div className="flex items-start gap-3">
          <GradientOrb size={44} icon="🎙️" />
          <div className="flex-1">
            <div className="text-serif-cn text-base font-bold text-ink-800">声音复刻</div>
            <div className="label-cormorant mt-1">VOICE CLONE</div>
            <p className="mt-2 text-[12px] leading-6 text-ink-600">
              传一段你的语音介绍，分身陪客户时就用<strong className="text-ink-800">你自己的声音</strong>说话。
              越清晰、越自然，复刻越像你。
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 py-5">
        <VoiceCloneCard />
      </div>
    </TherapistShell>
  );
}
