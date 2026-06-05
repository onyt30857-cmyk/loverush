/**
 * 消息类型治理基座 · 纯函数单测（无 DB）
 *
 * 跑：cd apps/api && pnpm exec vitest run test/message-kind.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  classifyMessageKind,
  isNaturalLanguage,
  isActionCard,
  ACTION_CARD_TYPES,
  cardActionSummary,
} from '../src/services/messageKind';

describe('messageKind 基座', () => {
  it('自然语言: text/voice', () => {
    expect(isNaturalLanguage('text')).toBe(true);
    expect(isNaturalLanguage('voice')).toBe(true);
    expect(classifyMessageKind('text')).toBe('NATURAL_LANGUAGE');
  });

  it('动作卡片: 7 种卡都识别且非自然语言', () => {
    for (const t of [
      'order_offer',
      'schedule_offer',
      'gift_hint',
      'chat_paywall',
      'media_locked',
      'shop_info',
      'customer_location',
    ]) {
      expect(isActionCard(t)).toBe(true);
      expect(isNaturalLanguage(t)).toBe(false);
      expect(classifyMessageKind(t)).toBe('ACTION_CARD');
    }
    expect(ACTION_CARD_TYPES.has('order_offer')).toBe(true);
  });

  it('媒体/系统: 非自然语言、非卡片', () => {
    for (const t of ['image', 'photo', 'sticker']) {
      expect(classifyMessageKind(t)).toBe('MEDIA');
      expect(isNaturalLanguage(t)).toBe(false);
      expect(isActionCard(t)).toBe(false);
    }
    for (const t of ['system', 'system_error']) {
      expect(classifyMessageKind(t)).toBe('SYSTEM');
      expect(isNaturalLanguage(t)).toBe(false);
    }
  });

  it('未知 type / null / undefined 安全降级，绝不当自然语言回灌', () => {
    expect(isNaturalLanguage('weird_new_card_type')).toBe(false);
    expect(classifyMessageKind('weird_new_card_type')).toBe('SYSTEM');
    expect(isNaturalLanguage(null)).toBe(true); // null → 默认 text（兼容老消息无 type）
    expect(classifyMessageKind(undefined)).toBe('NATURAL_LANGUAGE');
  });

  it('cardActionSummary 给每种卡一句中文面包屑', () => {
    expect(cardActionSummary('order_offer')).toMatch(/下单卡/);
    expect(cardActionSummary('customer_location')).toMatch(/位置/);
    expect(cardActionSummary('unknown')).toBe('');
  });
});
