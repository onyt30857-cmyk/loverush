import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from 'hono/request-id';

import { errorHandler, i18nMiddleware, tracing } from './middleware';
import { onErrorHandler } from './middleware/errors';
import { initSentry } from './services/sentry';
import { authRoutes } from './routes/auth';
import { orderRoutes, adminOrderRoutes } from './routes/orders';
import { therapistRoutes } from './routes/therapists';
import { therapistScheduleRoutes } from './routes/schedule';
import { adminRoutes } from './routes/admin';
import { assistantRoutes, blockRoutes, behaviorRoutes } from './routes/assistant';
import { searchRoutes } from './routes/search';
import { matchRoutes } from './routes/match';
import { customerDispatchRoutes, therapistOfferRoutes } from './routes/dispatch';
import { chatRoutes, translateRoutes } from './routes/chat';
import { aiAlterRoutes } from './routes/ai_alter';
import {
  paymentRoutes,
  paywallRoutes,
  shopRoutes,
  tipRoutes,
  withdrawRoutes,
  adminWithdrawRoutes,
} from './routes/commerce';
import { agentRoutes, pointPurchaseRoutes, adminAgentRoutes } from './routes/agents';
import { redeemRoutes, agentRedeemRoutes, adminRedeemRoutes } from './routes/redeem';
import { adminPlatformRoutes } from './routes/platform';
import { reviewRoutes, adminReviewRoutes } from './routes/reviews';
import { eventRoutes, adminAnalyticsRoutes } from './routes/analytics';
import { inviteRoutes } from './routes/invites';
import { ticketRoutes, adminTicketRoutes } from './routes/tickets';
import { notificationRoutes } from './routes/notifications';
import { privacyRoutes } from './routes/privacy';
import { flagRoutes, adminFlagRoutes } from './routes/flags';
import { dashboardRoutes, adminDashboardRoutes } from './routes/dashboard';
import { meRolesRoutes, adminRoleRoutes } from './routes/admin-roles';
import { webhookRoutes } from './routes/webhooks';
import { telegramRoutes } from './routes/telegram';
import { meRoutes } from './routes/me';
import { adminUserRoutes } from './routes/admin-users';
import { adminAssistantSessionRoutes } from './routes/admin-assistant-sessions';
import { adminCustomerAssistantRoutes } from './routes/admin-customer-assistant';
import { adminUserMediaRoutes } from './routes/admin-user-media';
import { adminVoiceRoutes } from './routes/admin-voice';
import { voiceRoutes } from './routes/voice';
import { adminTherapistPrivateRoutes } from './routes/admin-therapist-private';
import { adminTherapistProfileRoutes } from './routes/admin-therapist-profile';
import { adminPromptsRoutes } from './routes/admin-prompts';
import { adminTherapistAiRiskRoutes } from './routes/admin-therapist-ai-risk';
import { splashRoutes, adminSplashRoutes } from './routes/splash';
import { adminResetRoutes } from './routes/admin-reset';
import { adminAuditRoutes, adminAuditCsvRoutes } from './routes/admin-audit';
import { adminSystemErrorsRoutes } from './routes/admin-system-errors';
import { adminCurrenciesRoutes, adminExchangeRatesRoutes } from './routes/admin-currencies';
import { adminDisputesRoutes } from './routes/admin-disputes';
import { publicCurrencyRoutes } from './routes/currencies';
import { meDepositsRoutes } from './routes/me-deposits';
import { adminSearchRoutes } from './routes/admin-search';
import { adminBroadcastRoutes } from './routes/admin-broadcasts';
import { geoRoutes, meLocationRoutes } from './routes/geo';
import { adminGeoRoutes } from './routes/admin-geo';
import { myEncryptionKeyRoutes, publicKeyRoutes } from './routes/encryption';
import { metricsRoutes } from './routes/metrics';
import { eventsRoutes } from './routes/events';
import { getDb } from './db';
import { startAlterReplyRetryCron } from './jobs/ai-alter-reply-retry';
import { startAlterPendingReplyCron } from './jobs/ai-alter-pending-reply';
import { startShowsStateRollupCron } from './jobs/shows-state-rollup';
import { startDepositAutoReleaseCron } from './jobs/deposit-auto-release';
import { startFxAutoSyncCron } from './jobs/fx-auto-sync';
import { startOrderPendingConfirmTimeoutCron } from './jobs/order-pending-confirm-timeout';
import { startRedeemAutoConfirmCron } from './jobs/redeem-auto-confirm';
import { startAutoResolveStaleErrorsCron } from './jobs/auto-resolve-stale-errors';
import { adminAiSystemRoutes } from './routes/admin-ai-system';
import { companionRoutes } from './routes/companion';
import { chatPassRoutes } from './routes/chatPass';
import { companionMediaRoutes } from './routes/companionMedia';
import { chatMediaAdminRoutes } from './routes/chatMediaAdmin';
import { adminMatchRoutes } from './routes/admin-match';

// 启动时异步 init Sentry（不阻塞进程，无 DSN 自动 noop）
void initSentry();

// 启动后台 job · 均为「回应客户」类(非主动外呼，经用户授权)
// —— pending tick：拟人回复调度(不秒回 + debounce)，是客户消息的正常回复路径，必须开
// —— reply-retry：>5min 仍没回的深层兜底补偿
// 主动外呼(老客唤回/服务后关怀/收藏破冰)+ M03 召回/push 暂不启动，待单独授权
// setInterval 进程内 · 仅非测试环境 · Railway 单实例假设（多实例需加分布式锁防重复）
if (process.env.NODE_ENV !== 'test') {
  try {
    startAlterPendingReplyCron({ db: getDb() });
    startAlterReplyRetryCron({ db: getDb() });
    // M04 · 节目状态自动流转(open → closed → completed)
    startShowsStateRollupCron({ db: getDb() });
    // 0027 法币模式 · 心动金兜底 release(完单 24h 自动)+ HOLDING 过 48h 告警
    startDepositAutoReleaseCron({ db: getDb() });
    // 0027 P1 · 汇率每日自动同步(open.er-api.com · USD 锚 · >5% 偏差不写转告警)
    startFxAutoSyncCron({ db: getDb() });
    // 订单待确认超时(2h)自动取消 + 退还心动金 + 通知(5min tick)
    startOrderPendingConfirmTimeoutCron({ db: getDb() });
    // M16 P1 · 回收 24h 自动确认 + created 超 7 天解冻退回
    startRedeemAutoConfirmCron({ db: getDb() });
    // 系统报错自动归档(7 天没复发 → resolution='auto_stale')· 让后台未解决列表自维护
    startAutoResolveStaleErrorsCron({ db: getDb() });
  } catch (err) {
    console.error('[jobs] failed to start ai-alter jobs', err);
  }
}

const app = new Hono();

// 全局错误处理 · 必须用 app.onError 而不是 middleware
// sub-app（app.route('/x', subApp)）的 throw 不冒泡到外层 middleware，
// 但会触发 Hono 实例的 errorHandler。`onError` 是所有 sub-app 共用的兜底。
app.onError(onErrorHandler);

// Global middlewares · 顺序敏感
app.use('*', requestId());
app.use('*', errorHandler); // 保留作为同层 middleware fallback
app.use('*', tracing());
app.use(
  '*',
  cors({
    origin: (origin) => origin,
    credentials: true,
  }),
);
app.use('*', secureHeaders());
app.use('*', i18nMiddleware);

// Health check
app.get('/ping', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
// Prometheus metrics（建议 nginx 加 IP 白名单）
app.route('/metrics', metricsRoutes);
// M05 Phase 2 · SSE 实时事件流(/events/stream)
app.route('/events', eventsRoutes);

app.get('/', (c) =>
  c.json({
    name: 'LoveRush API',
    version: '0.1.0',
    docs: '/docs',
  }),
);

// Routes
app.route('/auth', authRoutes);
app.route('/orders', orderRoutes);
// M07 · 排班 · schedule 子路由先 mount(内部各自有 requireAuth)
// availability 已 inline 进 therapistRoutes 顶部(public,无 auth)
app.route('/therapists', therapistScheduleRoutes);
app.route('/therapists', therapistRoutes);
app.route('/assistant', assistantRoutes);
app.route('/search', searchRoutes);
app.route('/match', matchRoutes);
app.route('/me/blocks', blockRoutes);
app.route('/me/behavior', behaviorRoutes);
app.route('/me/offers', therapistOfferRoutes);
app.route('/orders/:orderId/dispatch', customerDispatchRoutes);
app.route('/conversations', chatRoutes);
app.route('/translate', translateRoutes);
app.route('/therapists/me/ai-alter', aiAlterRoutes);
app.route('/payments', paymentRoutes);
app.route('/therapists', paywallRoutes);
app.route('/shop', shopRoutes);
app.route('/tips', tipRoutes);
app.route('/me/withdrawals', withdrawRoutes);
app.route('/reviews', reviewRoutes);
app.route('/events', eventRoutes);
app.route('/invites', inviteRoutes);
app.route('/tickets', ticketRoutes);
app.route('/notifications', notificationRoutes);
app.route('/privacy', privacyRoutes);
app.route('/flags', flagRoutes);
app.route('/dashboard', dashboardRoutes);
app.route('/admin', adminRoutes);
app.route('/admin/ai-system', adminAiSystemRoutes); // M06b · AI 约束透明(只读)
app.route('/admin/prompts', adminPromptsRoutes); // Prompt Registry · 提示词版本管理
app.route('/admin/match', adminMatchRoutes); // M04 · AI 智能匹配监控
app.route('/admin/voice-clones', adminVoiceRoutes); // M18 · 声音复刻管理
app.route('/voice', voiceRoutes); // M18 · 技师声音复刻自助
app.route('/admin/flags', adminFlagRoutes);
app.route('/admin/dashboard', adminDashboardRoutes);
app.route('/admin/orders', adminOrderRoutes);
app.route('/admin/withdrawals', adminWithdrawRoutes);
app.route('/admin/reviews', adminReviewRoutes);
app.route('/admin/analytics', adminAnalyticsRoutes);
app.route('/admin/tickets', adminTicketRoutes);
app.route('/me/roles', meRolesRoutes);
app.route('/me/encryption-key', myEncryptionKeyRoutes);
app.route('/users', publicKeyRoutes);
// /me 必须在所有 /me/* 之后注册，避免短路径抢匹配
app.route('/me', meRoutes);
app.route('/admin/roles', adminRoleRoutes);
app.route('/admin/users', adminUserRoutes);
app.route('/admin/assistant/sessions', adminAssistantSessionRoutes);
app.route('/admin/users', adminCustomerAssistantRoutes);
app.route('/admin/users', adminUserMediaRoutes);
app.route('/admin/users', adminTherapistPrivateRoutes);
app.route('/admin/users', adminTherapistProfileRoutes);
app.route('/admin/users', adminTherapistAiRiskRoutes);
app.route('/splash', splashRoutes);
app.route('/admin/splash', adminSplashRoutes);
app.route('/admin/_internal', adminResetRoutes);
// M16 · 积分代理分销
app.route('/agent', agentRoutes);
app.route('/point-purchases', pointPurchaseRoutes);
app.route('/admin/agents', adminAgentRoutes);
// M16 P1 · 积分回收（持有人卖回 → 代理）
app.route('/agent/redeem', agentRedeemRoutes);
app.route('/redeem', redeemRoutes);
app.route('/admin/redeem', adminRedeemRoutes);
app.route('/admin/platform-accounts', adminPlatformRoutes);
app.route('/admin/audit-log', adminAuditRoutes);
// CSV 单独挂 — Hono 子路径拼接不能在 router 内做 `.csv`，必须整条路径
app.route('/admin/audit-log.csv', adminAuditCsvRoutes);
// 系统错误监管 + 登录异常 · admin 后台监管 + 预警
app.route('/admin/system-errors', adminSystemErrorsRoutes);
// 0027 法币 + 心动金模型
app.route('/admin/currencies', adminCurrenciesRoutes);
app.route('/admin/exchange-rates', adminExchangeRatesRoutes);
app.route('/admin/disputes', adminDisputesRoutes);
app.route('/currencies', publicCurrencyRoutes);
app.route('/me/deposits', meDepositsRoutes);
// M02 Phase 4 · 搜索后台(日志/热门词/类目)
app.route('/admin/search', adminSearchRoutes);
// M13 Phase 0 · 通知群发
app.route('/admin/broadcasts', adminBroadcastRoutes);
// M02 Phase 5 · 地理字典
app.route('/geo', geoRoutes);
app.route('/me/location-preference', meLocationRoutes);
app.route('/admin/geo', adminGeoRoutes);
app.route('/webhooks', webhookRoutes);
// M17 · Telegram 渠道 webhook(inline 搜技师 / start deeplink / chosen 埋点)
app.route('/webhooks/telegram', telegramRoutes);

// M02b/M04 Phase 1 · 服务发布(shows + service_categories)
// 公开:客户拉节目流 + 字典
// 技师:发布/管理自己的节目(/shows/me 子路径,挂在 publicShowRoutes 之前匹配)
import { publicShowRoutes, myShowRoutes } from './routes/shows';
import { publicCategoryRoutes, adminCategoryRoutes } from './routes/service-categories';
app.route('/shows/me', myShowRoutes);   // 必须在 /shows 之前 · 否则被 /:id 抢匹配
app.route('/shows', publicShowRoutes);
app.route('/service-categories', publicCategoryRoutes);
app.route('/admin/service-categories', adminCategoryRoutes);
app.route('/companion', companionRoutes);
app.route('/companion-media', companionMediaRoutes);
app.route('/chat-pass', chatPassRoutes);
app.route('/chat-media', chatMediaAdminRoutes);

export default app;
