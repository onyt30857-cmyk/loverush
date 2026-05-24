/**
 * Stripe 充值 · D-101
 *
 * 流程：
 *  1. 客户端 POST /payments/recharge {channel:'stripe', amount_usd_cents}
 *     → 创建 PaymentIntent，返回 client_secret
 *  2. 客户端用 Stripe.js 完成支付（Stripe Elements / Payment Element）
 *  3. Stripe 回调 webhook → POST /webhooks/stripe（payment_intent.succeeded）
 *     → 校验签名 → idempotency 用 event.id → credit 积分
 *
 * 无 STRIPE_SECRET_KEY 时 createIntent 抛 503，路由侧降级为 stub。
 */

import Stripe from 'stripe';
import { Database } from '@loverush/db';
import { loadEnv } from '../env';
import { credit, type PointsContext } from './points';
import { logger } from './logger';

export interface StripeContext {
  db: Database;
}

const POINTS_PER_USD = 100;

let cachedClient: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (cachedClient) return cachedClient;
  const env = loadEnv();
  if (!env.STRIPE_SECRET_KEY) return null;
  cachedClient = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-09-30.acacia' as Stripe.LatestApiVersion,
    typescript: true,
  });
  return cachedClient;
}

export function isStripeAvailable(): boolean {
  return getStripe() !== null;
}

export interface CreateIntentArgs {
  userId: string;
  amountUsdCents: number;
}

export interface CreateIntentResult {
  intentId: string;
  clientSecret: string;
  amountUsdCents: number;
  pointsToCredit: number;
  publishableKey: string | null;
}

export async function createPaymentIntent(
  ctx: StripeContext,
  args: CreateIntentArgs,
): Promise<CreateIntentResult> {
  const stripe = getStripe();
  if (!stripe) throw new Error('STRIPE_SECRET_KEY not configured');

  const env = loadEnv();
  const points = Math.floor((args.amountUsdCents / 100) * POINTS_PER_USD);

  const intent = await stripe.paymentIntents.create({
    amount: args.amountUsdCents,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    metadata: {
      user_id: args.userId,
      points_to_credit: String(points),
      source: 'loverush_recharge',
    },
    // 幂等键：相同 user + 相同金额 + 当前分钟，避免连点
    // 生产可换成客户端传 idempotency key
  }, {
    idempotencyKey: `intent_${args.userId}_${args.amountUsdCents}_${Math.floor(Date.now() / 60000)}`,
  });

  return {
    intentId: intent.id,
    clientSecret: intent.client_secret ?? '',
    amountUsdCents: args.amountUsdCents,
    pointsToCredit: points,
    publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
  };
}

/** 校验 webhook 签名并解析事件 */
export async function constructEvent(rawBody: string, signature: string): Promise<Stripe.Event> {
  const stripe = getStripe();
  const env = loadEnv();
  if (!stripe) throw new Error('Stripe not configured');
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET not set');

  // Stripe SDK 默认用 Node crypto · 我们用 constructEventAsync 走 Web Crypto，兼容 edge runtime
  if (typeof stripe.webhooks.constructEventAsync === 'function') {
    return await stripe.webhooks.constructEventAsync(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  }
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

/** 处理已通过签名校验的事件（payment_intent.succeeded → credit 积分） */
export async function handleEvent(ctx: StripeContext, event: Stripe.Event): Promise<{ handled: boolean }> {
  if (event.type !== 'payment_intent.succeeded') return { handled: false };

  const pi = event.data.object as Stripe.PaymentIntent;
  const userId = pi.metadata?.user_id;
  const points = parseInt(pi.metadata?.points_to_credit ?? '0', 10);

  if (!userId || points <= 0) {
    logger.warn('stripe payment_intent.succeeded missing metadata', {
      paymentIntentId: pi.id,
      eventId: event.id,
    });
    return { handled: false };
  }

  await credit({ db: ctx.db } as PointsContext, {
    userId,
    type: 'RECHARGE',
    amount: points,
    description: `Stripe 充值 USD ${pi.amount / 100}`,
    idempotencyKey: `stripe_${event.id}`, // 用 event.id 防重，Stripe 偶尔会重投
    metadata: {
      stripeEventId: event.id,
      paymentIntentId: pi.id,
      amountUsdCents: pi.amount,
      channel: 'stripe',
    },
  });

  return { handled: true };
}
