# LAUNCH.md · 上线运行手册

> Phase 6 上线 SOP · 2026-05-21
> 适用：曼谷单城 MVP 灰度（5% → 50% → 100%）

---

## 0. 上线前必备凭证清单

按下表逐项准备，每行打勾再继续。

| 凭证 | 用途 | 准备命令 / 来源 |
|------|------|---------------|
| `DATABASE_URL` | Supabase PostgreSQL (Singapore) | Supabase Dashboard → Project → Settings → Database |
| `JWT_SECRET` | JWT 签名（≥ 32 字符） | `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | Claude 主对话 / 翻译 / 红线 / 仲裁分类 | console.anthropic.com |
| `OPENAI_API_KEY` | LLM 降级备 + 后续 ASR | platform.openai.com |
| `GOOGLE_GEMINI_API_KEY` | T2 备路径 | ai.google.dev |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push | `npx web-push generate-vapid-keys` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | 前端订阅时用的公钥 | 同上 |
| `UPSTASH_REDIS_REST_URL` + `TOKEN` | 限流 / 幂等缓存 | console.upstash.com |
| `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` | 媒体存储 | Cloudflare R2 |
| `STRIPE_SECRET_KEY` / `ADYEN_API_KEY` | 充值通道（任一即可） | dashboard.stripe.com / ca-live.adyen.com |
| `SENTRY_DSN` | 错误监控 | sentry.io |

> `VAPID_*` / `R2_*` / `Stripe` 未配置时，相关功能自动降级到 stub（仅 console.log），不影响主流程上线。

---

## 1. 数据库 ready check

```bash
# 1. 生成迁移
pnpm --filter @loverush/db generate

# 2. 推送到 DB（生产用 migrate）
pnpm --filter @loverush/db migrate

# 3. seed 起步邀请码
pnpm --filter @loverush/db seed

# 4. 验证 16 张核心表 + 各 Phase 扩展表共约 57 张
psql $DATABASE_URL -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'"   # 期望 ≥ 50
```

ready check 通过 ≠ 数据迁移结束。生产 schema 变更必须先 dump 一份备份：
```bash
pg_dump $DATABASE_URL > backups/$(date +%Y%m%d-%H%M)-pre-migration.sql
```

---

## 2. Feature Flag 灰度策略

所有新功能挂 flag。灰度顺序：

| Phase | rolloutBps | 目标用户 | 持续 | 通过标准 |
|-------|-----------|---------|------|---------|
| 内测 | 0 | 仅 override 名单 5 人 | 3 天 | 关键路径全跑通 |
| 5% | 500 | 城市 = Bangkok | 3 天 | E9999 < 0.5% / 申诉率 < 2% |
| 25% | 2500 | Bangkok + Kuala Lumpur | 5 天 | 同上 + 复购率 > 8% |
| 50% | 5000 | + Shenzhen | 7 天 | 同上 |
| 100% | 10000 | 全部 | — | 持续监控 |

**操作命令**：
```bash
# 设 flag 为 5% 灰度（仅曼谷）
curl -X PUT $API/admin/flags/new_feature \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"default_enabled": false, "rollout_bps": 500, "target_cities": ["Bangkok"]}'

# 加内测用户 override
curl -X POST $API/admin/flags/new_feature/overrides \
  -d '{"user_id":"<uuid>","enabled":true,"reason":"内测"}'

# 紧急关闭
curl -X PUT $API/admin/flags/new_feature -d '{"enabled": false}'
```

---

## 3. 监控指标 + 告警阈值

### 业务核心指标（必须看）

| 指标 | 来源 | 健康阈值 | 告警阈值 |
|------|------|---------|---------|
| API p99 latency | tracing 中间件 | < 800ms | > 2000ms |
| API 5xx ratio | tracing 中间件 | < 0.5% | > 2% |
| LLM 调用失败率 | LLM gateway metric | < 3% | > 10% |
| 注册转化率 | analytics_events | > 80% | < 60% |
| 订单 PAID → COMPLETED 率 | dashboard.adminDashboard | > 90% | < 80% |
| 申诉率 | tickets 数 / 订单数 | < 2% | > 5% |
| 退款率 | refund_dispute.refunded / completed | < 3% | > 8% |
| AI 红线命中率 | redline_logs | < 1% | > 5% |
| 设备多账户告警 | risk_events | 单日 < 10 | > 30 |

### 监控查询（运营每日跑一次）

```bash
# 大盘
curl $API/admin/dashboard?range_days=1 -H "Authorization: Bearer $ADMIN_TOKEN"

# 风控
curl $API/admin/risk/events?unresolved_only=true

# 审核积压
curl $API/admin/audit/queue?status=pending

# 工单队列
curl $API/admin/tickets?status=open
```

---

## 4. 回滚预案

按事件类型分级：

### P0 全站故障（API 5xx > 50% / DB 不可达）
1. 立即在 Cloudflare DNS 切到 maintenance 静态页
2. 检查 Sentry 错误 → 定位最近一次部署
3. `git revert <bad-sha>` → 触发部署回滚
4. DB schema 变更回滚：
   ```bash
   # 先备份
   pg_dump $DATABASE_URL > backups/$(date +%Y%m%d-%H%M)-pre-rollback.sql
   # 列出最近 N 个迁移
   pnpm --filter @loverush/db rollback -- --list
   # 回滚最近 1 个
   pnpm --filter @loverush/db rollback
   ```
   必须有配对的 `*.down.sql`（见 `packages/db/migrations/README.md`）；没有则用 backup 还原（数据丢失窗口 ≤ 6h，对齐 §6 凭证轮换备份周期）

### P1 单功能故障（某 flag 后果不达预期）
1. 关 flag：`PUT /admin/flags/<key> {"enabled": false}` → 1 秒生效
2. 不需要部署回滚
3. 记 incident 进 retro

### P2 数据异常（积分错账 / 评分跳变）
1. 不关 flag
2. 跑核账 SQL（在 `docs/sql/audit/*` 目录）→ 找差异源
3. 必要时手动 ADJUSTMENT 类型记账（`points.credit/debit` with type=ADJUSTMENT）

### P3 LLM 提供商挂掉
- LLM gateway 自动降级（Anthropic → OpenAI → Gemini）
- 全挂 → relevant API 返回 E5050 / E5040，业务侧本来就有兜底
- 不阻断核心交易（注册 / 订单 / 支付 不依赖 LLM）

---

## 5. 灰度发布 Checklist（每个新功能上线必过）

- [ ] 创建对应 feature_flag（`PUT /admin/flags/<key>`，default_enabled=false）
- [ ] 关键路径加 `analytics_events` 埋点
- [ ] 加 5 个内测用户 override，验证端到端
- [ ] 准备回滚 SQL（如需）+ down migration（如有 schema 变更）
- [ ] Sentry 监控 dashboard 加新错误码过滤
- [ ] 把"灰度通过标准"写入 PR 描述（拒绝凭感觉判断）
- [ ] 灰度过程中每天看 4 项核心指标
- [ ] 通过阈值 → rolloutBps 翻倍
- [ ] 100% 满 7 天稳定 → 删 flag 并删 dead code（防止技术债累积）

---

## 6. 凭证轮换周期

| 凭证 | 周期 | 备注 |
|------|------|------|
| `JWT_SECRET` | 90 天 | 轮换前预留 7 天双 secret 并行期 |
| `VAPID_*` | 365 天 | 客户端订阅会自动重新订阅 |
| `R2_ACCESS_KEY*` | 180 天 | Cloudflare R2 控制台双 key 并行 |
| LLM API keys | 180 天 | 全部使用 Cloudflare Worker secret 不入 git |
| `STRIPE_*` | 不主动轮换，仅泄露时立即 | Stripe webhook secret 单独管理 |

---

## 7. 上线日 D-Day 流程

```
D-7  → 内测开启（5 人）+ 灰度文档定稿
D-3  → 生产 DB 迁移 + seed
D-1  → 全部凭证就位 + Sentry / Grafana 接入 / DNS 预热
D    → 09:00 Bangkok rolloutBps=500 (5%)
       12:00 看 4 项指标
       15:00 看 4 项指标
       18:00 看 4 项指标
       22:00 决策：通过/暂停/回滚
D+3  → 通过 → rolloutBps=2500 (25%)
D+8  → 通过 → 5000 (50%)
D+15 → 通过 → 10000 (100%)
D+22 → 删 flag（如无问题）
```

---

## 8. 必读 runbook

- **凭证申请**：[`docs/runbooks/credential-setup.md`](./docs/runbooks/credential-setup.md) ✅（Phase 35）
- **D-Day 逐小时清单**：[`docs/runbooks/d-day-playbook.md`](./docs/runbooks/d-day-playbook.md) ✅（Phase 35）
- 数据迁移：[`docs/runbooks/db-migration.md`](./docs/runbooks/db-migration.md) ✅
- LLM 切换降级：[`packages/llm/README.md`](./packages/llm/README.md) ✅
- 工单 SLA：`v1/modules/M12-客服与仲裁.md` §SLA
- 隐私模式 / GDPR：`v1/modules/M15-隐私模式.md`

### 上线自动化脚本

| 时机 | 脚本 | 用途 |
|---|---|---|
| D-7 ～ D-1 | [`scripts/launch-readiness-check.sh`](./scripts/launch-readiness-check.sh) | 一键自检 §0 凭证 + §1 DB + §3 端点 · 输出 `READY=GO\|NO-GO` |
| D-3 | [`scripts/dry-run-launch.sh`](./scripts/dry-run-launch.sh) | 本地 docker 演练完整闭环 |
| D-3 | [`scripts/deploy-production.sh`](./scripts/deploy-production.sh) ✅（Phase 35）| 一键部署 API + web + admin · 含 DB 备份/迁移/烟测 |
| 应急 | [`scripts/rollback-production.sh`](./scripts/rollback-production.sh) ✅（Phase 35）| 三档回滚：API / pages / DB |
| D-Day → D+22 | [`scripts/daily-canary-watch.sh`](./scripts/daily-canary-watch.sh) | 拉 §9 四个 endpoint · 按 §3 阈值自动判定 · cron 可调用 |
| 每月 | [`scripts/audit-archive.sh`](./scripts/audit-archive.sh) | admin_audit_log 上月归档到 R2 |
| 每天 | [`scripts/backup-cron.sh`](./scripts/backup-cron.sh) | DB 备份 |

### 部署命令速查

```bash
# 全栈部署（API + web + admin · 含 DB 迁移）
bash scripts/deploy-production.sh

# 单组件部署
bash scripts/deploy-production.sh --target api
bash scripts/deploy-production.sh --target web
bash scripts/deploy-production.sh --target admin

# 跳过 DB 迁移（仅代码变更）
bash scripts/deploy-production.sh --skip-migrate

# 回滚
bash scripts/rollback-production.sh --target api               # API only
bash scripts/rollback-production.sh                            # 全栈
bash scripts/rollback-production.sh --target db --backup F.gz  # DB 还原（危险）
```

---

## 9. 上线后第一周必做

- 每天看 `admin/dashboard?range_days=1` 一次（含 GMV / DAU / 漏斗 / refund 率）
- 每天看 `admin/risk/events?unresolved_only=true`（异常行为兜底）
- 每天看 `admin/audit/queue?status=pending`（审核积压）
- 用户邀请码消耗速度 → 决定是否补发 A / O 类官方码
