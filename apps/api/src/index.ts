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
import { meRoutes } from './routes/me';
import { adminUserRoutes } from './routes/admin-users';
import { adminAssistantSessionRoutes } from './routes/admin-assistant-sessions';
import { adminCustomerAssistantRoutes } from './routes/admin-customer-assistant';
import { adminUserMediaRoutes } from './routes/admin-user-media';
import { adminTherapistPrivateRoutes } from './routes/admin-therapist-private';
import { adminTherapistProfileRoutes } from './routes/admin-therapist-profile';
import { adminTherapistAiRiskRoutes } from './routes/admin-therapist-ai-risk';
import { splashRoutes, adminSplashRoutes } from './routes/splash';
import { adminResetRoutes } from './routes/admin-reset';
import { adminAuditRoutes, adminAuditCsvRoutes } from './routes/admin-audit';
import { adminSystemErrorsRoutes } from './routes/admin-system-errors';
import { adminSearchRoutes } from './routes/admin-search';
import { adminBroadcastRoutes } from './routes/admin-broadcasts';
import { geoRoutes, meLocationRoutes } from './routes/geo';
import { adminGeoRoutes } from './routes/admin-geo';
import { myEncryptionKeyRoutes, publicKeyRoutes } from './routes/encryption';
import { metricsRoutes } from './routes/metrics';
import { eventsRoutes } from './routes/events';
import { getDb } from './db';
import { startAlterReplyRetryCron } from './jobs/ai-alter-reply-retry';
import { adminAiSystemRoutes } from './routes/admin-ai-system';

// 启动时异步 init Sentry（不阻塞进程，无 DSN 自动 noop）
void initSentry();

// 启动后台 job · 仅「分身回复兜底补偿」(经用户明确授权)
// —— 只补发"客户发了但没收到回复"的消息（回应客户、非主动外呼）
// 主动外呼(老客唤回/服务后关怀/收藏破冰)+ M03 召回/push 暂不启动，待单独授权
// setInterval 进程内 · 仅非测试环境 · Railway 单实例假设（多实例需加分布式锁防重复）
if (process.env.NODE_ENV !== 'test') {
  try {
    startAlterReplyRetryCron({ db: getDb() });
  } catch (err) {
    console.error('[jobs] failed to start reply-retry job', err);
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
app.route('/admin/audit-log', adminAuditRoutes);
// CSV 单独挂 — Hono 子路径拼接不能在 router 内做 `.csv`，必须整条路径
app.route('/admin/audit-log.csv', adminAuditCsvRoutes);
// 系统错误监管 + 登录异常 · admin 后台监管 + 预警
app.route('/admin/system-errors', adminSystemErrorsRoutes);
// M02 Phase 4 · 搜索后台(日志/热门词/类目)
app.route('/admin/search', adminSearchRoutes);
// M13 Phase 0 · 通知群发
app.route('/admin/broadcasts', adminBroadcastRoutes);
// M02 Phase 5 · 地理字典
app.route('/geo', geoRoutes);
app.route('/me/location-preference', meLocationRoutes);
app.route('/admin/geo', adminGeoRoutes);
app.route('/webhooks', webhookRoutes);

// M02b/M04 Phase 1 · 服务发布(shows + service_categories)
// 公开:客户拉节目流 + 字典
// 技师:发布/管理自己的节目(/shows/me 子路径,挂在 publicShowRoutes 之前匹配)
import { publicShowRoutes, myShowRoutes } from './routes/shows';
import { publicCategoryRoutes, adminCategoryRoutes } from './routes/service-categories';
app.route('/shows/me', myShowRoutes);   // 必须在 /shows 之前 · 否则被 /:id 抢匹配
app.route('/shows', publicShowRoutes);
app.route('/service-categories', publicCategoryRoutes);
app.route('/admin/service-categories', adminCategoryRoutes);

export default app;
