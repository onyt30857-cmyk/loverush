-- ═══════════════════════════════════════════════
-- LoveRush · 初始 SEED 数据
-- 执行：psql $DATABASE_URL -f seed/0001_initial.sql
-- ═══════════════════════════════════════════════

-- 起步邀请码（管理员手动派发给首批客户/技师）
-- A 类：管理员发放
INSERT INTO invite_codes (code, kind, target_user_type, max_uses, used_count, issuer_note)
VALUES
  ('ADMIN-SEED-CUSTOMER-001', 'A', 'customer', 100, 0, '管理员首批客户种子'),
  ('ADMIN-SEED-THERAPIST-001', 'A', 'therapist', 50, 0, '管理员首批技师种子'),
  ('ADMIN-OPS-001', 'O', NULL, 10, 0, '运营测试通用')
ON CONFLICT (code) DO NOTHING;
