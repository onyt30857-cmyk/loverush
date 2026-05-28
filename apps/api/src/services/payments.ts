/**
 * 充值 · M09b · D-101 升级
 *
 * 两种路径：
 *  - channel='stub'   开发用 · 直接 credit 积分（不走支付通道，便于 e2e 测试）
 *  - channel='stripe' 真支付 · 创建 PaymentIntent，返回 client_secret；
 *                     积分入账由 /webhooks/stripe 收到 payment_intent.succeeded 触发
 *
 * 未配 STRIPE_SECRET_KEY 时 channel='stripe' 自动降级为 stub（避免本地开发卡住）。
 */

import { nanoid } from 'nanoid';
import type { Database } from '@loverush/db';
import { credit, type PointsContext } from './points';
import { createPaymentIntent, isStripeAvailable, type StripeContext } from './stripe';

export interface PaymentContext {
  db: Database;
}

export type Channel = 'stub' | 'stripe' | 'adyen' | 'alipay_hk';

export interface RechargeArgs {
  userId: string;
  amountUsdCents: number;
  channel?: Channel;
}

export interface RechargeStubResult {
  kind: 'stub';
  txnId: string;
  pointsCredited: number;
  externalRef: string;
}

export interface RechargeStripeResult {
  kind: 'stripe';
  intentId: string;
  clientSecret: string;
  amountUsdCents: number;
  pointsToCredit: number;
  publishableKey: string | null;
}

export type RechargeResult = RechargeStubResult | RechargeStripeResult;

const POINTS_PER_USD = 100;

export async function recharge(ctx: PaymentContext, args: RechargeArgs): Promise<RechargeResult> {
  const channel = args.channel ?? 'stub';

  // Stripe 路径
  if (channel === 'stripe' && isStripeAvailable()) {
    const r = await createPaymentIntent({ db: ctx.db }, {
      userId: args.userId,
      amountUsdCents: args.amountUsdCents,
    });
    return {
      kind: 'stripe',
      intentId: r.intentId,
      clientSecret: r.clientSecret,
      amountUsdCents: r.amountUsdCents,
      pointsToCredit: r.pointsToCredit,
      publishableKey: r.publishableKey,
    };
  }

  // Stub 路径（含 Stripe 不可用时降级）
  const points = Math.floor((args.amountUsdCents / 100) * POINTS_PER_USD);
  const externalRef = `stub_${nanoid(16)}`;
  const txn = await credit({ db: ctx.db }, {
    userId: args.userId,
    type: 'RECHARGE',
    amount: points,
    description: `充值 USD ${args.amountUsdCents / 100} · ${channel}${channel === 'stripe' ? ' (stub fallback)' : ''}`,
    idempotencyKey: externalRef,
    metadata: { externalRef, channel, amountUsdCents: args.amountUsdCents },
  });
  return { kind: 'stub', txnId: txn.id, pointsCredited: points, externalRef };
}
