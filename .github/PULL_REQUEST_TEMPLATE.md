## 改了什么

<!-- 一句话说清楚。例：M02 加技师档案的"昵称"字段；修复 M07 订单状态机 LOCKED → CANCELLED 跳过 paywall 解锁的 bug。 -->

## 为什么

<!-- 触发这次改动的原因：bug / 新需求 / 重构 / 优化 / 安全修复 -->

## 如何验证

<!-- 怎么证明这次改动是对的 -->

- [ ] 单元测试新增 / 修改
- [ ] E2E 测试通过：`pnpm --filter @loverush/api test`
- [ ] 本地端到端走一遍（说一下走了哪个流程）

## 影响范围

- [ ] 改了 schema → 配对的 `*.down.sql` 已经写好
- [ ] 改了 API 契约 → 客户端 / Admin UI 已同步
- [ ] 改了 LLM prompt → 已经测过新 prompt 在 5 个典型场景下的输出
- [ ] 触发新 feature flag → 已经设置默认关闭 + 灰度计划

## 上线 Gate Checklist

- [ ] 没引入新 P0 技术债（参考 `v1/TECH-DEBT.md`）
- [ ] 没违反 v5 ZERO AI 政策（客户端无 "AI/助理/bot" 字样 · 见 `ARCHITECTURE.md` §5.1）
- [ ] 没违反价格透明铁律（订单 LOCKED 后不能变价 · 见 `ARCHITECTURE.md` §5.2）
- [ ] 没在客户端代码里出现 `'@sentry/node'`、`postgres.js`、`stripe` 等 Node-only 包

## 关联

- Issue: #
- 模块文档：`v1/modules/M0X-*.md`
- TECH-DEBT 条目：D-XXX
