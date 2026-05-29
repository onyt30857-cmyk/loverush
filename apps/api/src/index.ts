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
import { adminRoutes } from './routes/admin';
import { assistantRoutes, blockRoutes, behaviorRoutes } from './routes/assistant';
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
import { adminAuditRoutes, adminAuditCsvRoutes } from './routes/admin-audit';
import { myEncryptionKeyRoutes, publicKeyRoutes } from './routes/encryption';
import { metricsRoutes } from './routes/metrics';

// 启动时异步 init Sentry（不阻塞进程，无 DSN 自动 noop）
void initSentry();

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
app.route('/therapists', therapistRoutes);
app.route('/assistant', assistantRoutes);
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
// M16 · 积分代理分销
app.route('/agent', agentRoutes);
app.route('/point-purchases', pointPurchaseRoutes);
app.route('/admin/agents', adminAgentRoutes);
app.route('/admin/audit-log', adminAuditRoutes);
// CSV 单独挂 — Hono 子路径拼接不能在 router 内做 `.csv`，必须整条路径
app.route('/admin/audit-log.csv', adminAuditCsvRoutes);
app.route('/webhooks', webhookRoutes);

export default app;
