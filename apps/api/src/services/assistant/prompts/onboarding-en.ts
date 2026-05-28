/**
 * 6-step onboarding · English script
 *
 * Mirrors onboarding-zh.ts (PRD §3.0.1 F03-OB1).
 * Voice rules: peer / bro tone · no "Dear customer" · no "Sir" · self-deprecation OK.
 */

import type { OnboardingFacts } from '../onboarding-types';
import type { SwipeCard, Option } from './onboarding-zh';

/** 6 placeholder style cards (same set as zh script) */
export function styleSwipeCards(): SwipeCard[] {
  return [
    { id: 'style_tender_young_f', img_url: 'https://i.pravatar.cc/300?img=47', tags: ['gender:female', 'age:20-25', 'style:tender'] },
    { id: 'style_outgoing_young_f', img_url: 'https://i.pravatar.cc/300?img=49', tags: ['gender:female', 'age:20-25', 'style:outgoing'] },
    { id: 'style_pro_mid_f', img_url: 'https://i.pravatar.cc/300?img=44', tags: ['gender:female', 'age:26-32', 'style:professional'] },
    { id: 'style_mature_f', img_url: 'https://i.pravatar.cc/300?img=45', tags: ['gender:female', 'age:33-40', 'style:mature'] },
    { id: 'style_deep_pro_m', img_url: 'https://i.pravatar.cc/300?img=12', tags: ['gender:male', 'age:26-32', 'style:deep_tissue'] },
    { id: 'style_quiet_pro_f', img_url: 'https://i.pravatar.cc/300?img=48', tags: ['gender:female', 'age:26-32', 'style:quiet'] },
  ];
}

export function step1Reply(): string {
  return "Hey bro, I'm your little assistant. I cut through the noise and point you at the spots that actually deliver. Free, no limits. First — what city are you in right now?";
}

export function step1Options(): Option[] {
  return [
    { label: 'Bangkok', value: '曼谷' },
    { label: 'Singapore', value: '新加坡' },
    { label: 'Kuala Lumpur', value: '吉隆坡' },
    { label: 'Jakarta', value: '雅加达' },
    { label: 'Saigon', value: '西贡' },
    { label: 'Other', value: 'other' },
  ];
}

export function step2Reply(facts: OnboardingFacts): string {
  const city = String(facts.city ?? '').trim();
  const cityAck = city
    ? city === '曼谷' || city.toLowerCase() === 'bangkok'
      ? "Got it, Bangkok — I know it well."
      : city === 'other'
        ? "Niche city — let me see who covers it."
        : `Got it, I know ${city}.`
    : 'Cool, moving on.';
  return `${cityAck} What kind of night are you having? (1) Wrecked from work, need to crash (2) Want real technique to actually loosen up (3) Just feeling a change of scene. Gut pick.`;
}

export function step2Options(): Option[] {
  return [
    { label: 'Wrecked, need to crash', value: 'relax' },
    { label: 'Real technique to loosen up', value: 'deep_tissue' },
    { label: 'Change of scene', value: 'explore' },
  ];
}

export function step3Reply(facts: OnboardingFacts): string {
  const intent = String(facts.intent ?? '');
  const ack =
    intent === 'relax'
      ? "Cool — wrecked means no detours."
      : intent === 'deep_tissue'
        ? 'Got it — I\'ll bias the picks toward strong technique.'
        : intent === 'explore'
          ? "Nice — I'll show you fresh arrivals."
          : 'Cool.';
  return `${ack} Here's 6 style shots — tap if you like, swipe if not. No need to explain — your reactions tell me more than words.`;
}

export function step4Reply(facts: OnboardingFacts): string {
  const styles = Array.isArray(facts.style_pref) ? (facts.style_pref as string[]) : [];
  const styleAck = styles.length
    ? `Read you — you lean ${styles.slice(0, 2).join(' / ')}. I've got a few solid ones lined up.`
    : 'Cool — style noted, I\'ll refine as we go.';
  return `${styleAck} Two more quick things: what time works, and Chinese or English / Thai?`;
}

export function step4TimeOptions(): Option[] {
  return [
    { label: 'Around 8pm tonight', value: '20:00' },
    { label: 'After 10pm tonight', value: '22:00' },
    { label: 'Tomorrow daytime', value: 'tomorrow_day' },
    { label: 'Whenever you suggest', value: 'flexible' },
  ];
}

export function step4LangOptions(): Option[] {
  return [
    { label: 'Chinese', value: 'zh' },
    { label: 'English', value: 'en' },
    { label: 'Thai', value: 'th' },
    { label: 'Any', value: 'any' },
  ];
}

export function step5Reply(_facts: OnboardingFacts): string {
  return "Also — some bros watch the wallet or want it discreet. Got a hard budget cap, or flexible? And, prefer I use code-names instead of dollar amounts?";
}

export function step5PriceOptions(): Option[] {
  return [
    { label: 'Flexible — just pick the good ones', value: 'flexible' },
    { label: 'Budget end', value: 'low' },
    { label: 'Mid-range', value: 'mid' },
    { label: 'High-end', value: 'high' },
  ];
}

export function step5PrivacyOptions(): Option[] {
  return [
    { label: 'Code-names, please', value: 'codename' },
    { label: 'Plain amounts are fine', value: 'plain' },
  ];
}

export function step6Reply(facts: OnboardingFacts, picksCount: number): string {
  const styles = Array.isArray(facts.style_pref) ? (facts.style_pref as string[]) : [];
  const time = String(facts.time_slot ?? '');
  const tags: string[] = [];
  if (styles.length) tags.push(`${styles.slice(0, 1).join('')} style`);
  if (time && time !== 'flexible') tags.push('slot fits');
  if (facts.price_range && facts.price_range !== 'flexible') tags.push('price tier matches');
  if (facts.language && facts.language !== 'any') tags.push(`${facts.language} ok`);
  const tagsLine = tags.length ? `[${tags.join(' · ')}]` : '[tonight\'s safest]';
  if (picksCount === 0) {
    return "Done. Nothing in your range tonight that's both fresh and reviewed clean — I'll keep watching and ping when a slot opens. No rush.";
  }
  return `Done. Based on what you said, here are ${picksCount} picks I'd trust — ${tagsLine}, no review red flags today. Tap one if it fits. Not feeling them? Come back, I'll re-roll. Browsing only is fine too.`;
}

export function selfDeprecateSkip(): string {
  return "Talked too much — let me just drop 3 picks. Roast me if they're off.";
}

export function resumeAfterInterrupt(): string {
  return 'Did you check that? Let me keep tuning your picks.';
}
