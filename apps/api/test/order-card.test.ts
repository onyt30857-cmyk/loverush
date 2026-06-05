/**
 * 订单卡 payload 组装 · 纯函数单测(无 DB)
 * 跑：cd apps/api && pnpm exec vitest run test/order-card.test.ts
 */
import { describe, it, expect } from 'vitest';
import { buildOrderCardPayload } from '../src/services/orderCard';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mkOrder = (over: any) =>
  ({
    id: 'o1',
    status: 'PENDING_CONFIRM',
    serviceSnapshot: { skills: ['泰式按摩'], durationMin: 90, pricePoints: 0 },
    scheduledAt: new Date('2026-06-07T19:00:00Z'),
    serviceMode: null,
    customerAreaName: '素坤逸 Soi 11',
    depositPoints: 200,
    ...over,
  }) as any;
const mkTher = (over: any) =>
  ({ id: 't1', serviceMode: 'outcall', serviceArea: '通罗', serviceCity: '曼谷', avatarUrl: 'http://x/a.jpg', bio: 'hi', ...over }) as any;

describe('buildOrderCardPayload', () => {
  it('上门(outcall):area=客户区域,服务名/时长/技师/时间正确', () => {
    const p = buildOrderCardPayload(mkOrder({ serviceMode: 'outcall' }), mkTher({}), 'Nira');
    expect(p.serviceMode).toBe('outcall');
    expect(p.areaName).toBe('素坤逸 Soi 11'); // 上门=客户区域
    expect(p.serviceName).toBe('泰式按摩');
    expect(p.durationMin).toBe(90);
    expect(p.therapistName).toBe('Nira');
    expect(p.therapistAvatar).toBe('http://x/a.jpg');
    expect(p.scheduledAt).toBe('2026-06-07T19:00:00.000Z');
    expect(p.depositPoints).toBe(200);
  });

  it('到店(incall):area=门店区域', () => {
    const p = buildOrderCardPayload(mkOrder({ serviceMode: 'incall' }), mkTher({ serviceMode: 'incall' }), 'Nira');
    expect(p.serviceMode).toBe('incall');
    expect(p.areaName).toBe('通罗'); // 到店=门店区域(serviceArea)
  });

  it('订单 serviceMode=null → 回退技师;both 默认 outcall', () => {
    expect(buildOrderCardPayload(mkOrder({ serviceMode: null }), mkTher({ serviceMode: 'both' }), 'Nira').serviceMode).toBe('outcall');
    expect(buildOrderCardPayload(mkOrder({ serviceMode: null }), mkTher({ serviceMode: 'incall' }), 'Nira').serviceMode).toBe('incall');
  });

  it('serviceSnapshot 无 skills → 服务名兜底"按摩"', () => {
    const p = buildOrderCardPayload(mkOrder({ serviceSnapshot: { skills: [], durationMin: 60, pricePoints: 0 } }), mkTher({}), 'Nira');
    expect(p.serviceName).toBe('按摩');
    expect(p.durationMin).toBe(60);
  });
});
