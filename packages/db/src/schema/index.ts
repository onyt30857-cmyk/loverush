/**
 * Drizzle Schema 汇总入口
 *
 * Phase 1.2 第一批核心表（按 STARTUP-GUIDE §1.2）
 * - enums                                   PostgreSQL 枚举
 * - users / sessions / device_fingerprints  用户主表 + 多设备会话
 * - invite_codes / invite_code_usage / encryption_keys
 *                                           邀请码 + 端到端密钥
 * - customer_preferences / customer_master_preferences
 *                                           客户偏好（会话级 + 长期）
 * - customer_assistant_profile / customer_session_preferences /
 *   customer_behavior_profile               AI 分身画像 + 行为模式
 * - therapists                              技师扩展信息（骨架）
 * - points_account / points_transaction     积分账户与流水
 * - orders / order_chain                    订单 + 凭证链
 * - customer_relationship_profile           M06 客户-技师关系画像
 *
 * 使用方式：
 *   import { db, schema } from '@loverush/db'
 *   const users = await db.select().from(schema.users)
 */

export * from './enums';
export * from './users';
export * from './auth';
export * from './preferences';
export * from './assistant';
// M03 · 客户 AI 助理长期记忆(L1-L5)
export * from './assistant_memory';
// M03 v2 · 助理 home 仪表盘对话会话表
export * from './assistant_session';
// M03 Admin A1 · 助理对话日志(admin 会话回放专用)
export * from './assistant_chat_log';
export * from './therapists';
export * from './points';
export * from './orders';
export * from './relationship';
// Phase 2.1 · M02 + M11 schema 第二批
export * from './media';
export * from './moderation';
export * from './risk';
// Phase 3.1 · M03 + M04 + M05 schema 第三批
export * from './dispatch';
export * from './chat';
export * from './block';
// Phase 4.1 · M06 + M08 + M09 + M14 schema 第四批
export * from './shop';
export * from './tips';
export * from './reviews';
export * from './analytics';
export * from './ai_alter';
// Phase 5.1 · M10 + M12 + M13 + M15 schema 第五批
export * from './invites';
export * from './tickets';
export * from './notifications';
export * from './privacy';
// Phase 6.1 · Feature Flag
export * from './flags';
// Phase 9.1 · Roles + Phase 24 · admin 操作审计
export * from './roles';
export * from './audit';
// M16 · 积分代理分销
export * from './agents';
// M02 Phase 4 · 搜索后台(日志/热门词/类目)
export * from './search';
// M13 Phase 0 · 通知群发(批次/投递)
export * from './broadcasts';
// M02 Phase 5 · 地理字典(城市/区域/用户偏好)
export * from './geo';
// M05 Phase 1 · 私聊 per-user 已读位置
export * from './conversation_read';
