import { describe, it, expect } from 'vitest';
import { notifyBodyForType } from '../src/services/chat';

describe('notifyBodyForType · M19 通知文案不泄露 JSON', () => {
  it('纯文本消息截断展示', () => {
    expect(notifyBodyForType('text', '今晚有空吗', false)).toBe('今晚有空吗');
    expect(notifyBodyForType(undefined, '一二三四五六七八九十'.repeat(10), false)).toHaveLength(80);
  });

  it('加密消息固定文案,不看内容', () => {
    expect(notifyBodyForType('text', '{"secret":1}', true)).toBe('🔐 加密消息');
  });

  it('卡片类消息给人话,绝不泄露 JSON', () => {
    expect(notifyBodyForType('order_offer', '{"orderNo":"LR2026","price":500}', false)).toBe('给你发来一个下单邀请');
    expect(notifyBodyForType('order_card', '{"orderId":"x"}', false)).toBe('给你发来一个下单邀请');
    expect(notifyBodyForType('schedule_offer', '{"slots":[]}', false)).toBe('发来可约时段,看看?');
    expect(notifyBodyForType('gift', '{"giftId":"rose"}', false)).toBe('给你发来一个小心意~');
    expect(notifyBodyForType('image', '{"url":"x"}', false)).toBe('[图片]');
    expect(notifyBodyForType('voice', '{"text":"hi","audioUrl":"x"}', false)).toBe('[语音]');
  });

  it('未识别的结构化类型一律通用文案(防新 type 泄 JSON)', () => {
    expect(notifyBodyForType('customer_location', '{"address":"Yg","lat":1}', false)).toBe('发来一条新消息');
    expect(notifyBodyForType('shop_info', '{"address":"店铺"}', false)).toBe('发来一条新消息');
    expect(notifyBodyForType('some_future_card', '{"x":1}', false)).toBe('发来一条新消息');
  });

  it('任何分支返回值都不以 { 开头(JSON 泄露守门)', () => {
    for (const t of ['order_offer', 'schedule_offer', 'gift', 'image', 'voice', 'customer_location', 'shop_info', 'unknown']) {
      expect(notifyBodyForType(t, '{"leak":true}', false).startsWith('{')).toBe(false);
    }
  });
});
