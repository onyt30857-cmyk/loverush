# D-Day Hour-by-Hour Playbook

> LoveRush v1 灰度上线逐小时操作清单
> 适用：曼谷 Asok 单城 5% → 25% → 50% → 100% 灰度
> 责任人：Tony（主操）+ 1 名值班同事（备）
> 配套：`LAUNCH.md §7 D-Day 流程`（高层）/ 本文档（按小时执行）

---

## 0. 上线前 7 天 · D-7

```
- [ ] 跑凭证自检
      ENV_FILE=.env.production bash scripts/launch-readiness-check.sh
      期望：PASS ≥ 18 / WARN ≤ 1 / FAIL = 0 / READY=GO

- [ ] 跑本地演练（docker 模拟全闭环）
      bash scripts/dry-run-launch.sh
      期望：演练全部通过 · E2E 40/40 · 单测 90/90

- [ ] 内测用户名单确定（5 人）
      记录每个人的 user_id（用 wrangler secret list 或事先注册好）

- [ ] 应急联系矩阵（贴墙 / 钉在 Slack）
      技术 oncall：Tony 手机 +86 xxxxxxx
      Sentry alerts → Slack #loverush-incidents
      Anthropic / Stripe / Cloudflare 客服电话（截图存 1Password）

- [ ] Grafana / Prometheus 接通验证
      手动触发一次错误（curl /admin/dashboard 不带 token）→ Sentry 5 分钟内收到事件
      手动 ban 一个 admin 看 Grafana audit-anomaly 行有 spike

- [ ] DNS TTL 降到 60s（方便回滚切流）
      Cloudflare → loverush.com → DNS → A/CNAME 记录 TTL 改 1 分钟

- [ ] 数据备份验证
      pg_dump $DATABASE_URL > backups/d-7-baseline.sql.gz
      pg_restore --list backups/d-7-baseline.sql.gz | head -20    # 确认可读

- [ ] 公告内测用户（5 人）
      "D-Day 当天 09:00 Bangkok 我们会开放系统，请按 https://loverush.com 注册"
```

---

## 1. D-3 · 生产环境准备

```
- [ ] 09:00  备份当前生产 DB（双备份）
      pg_dump $DATABASE_URL | gzip > backups/$(date +%Y%m%d-%H%M)-d-3.sql.gz
      aws s3 cp backups/*.sql.gz s3://loverush-db-backups/migrations/ --endpoint-url ...

- [ ] 10:00  推 schema 到生产
      pnpm --filter @loverush/db migrate
      期望输出：成功 apply 0001-0004 所有 migration

- [ ] 10:30  手动应用合规 migration（drizzle-kit migrate 已包含，但二次确认）
      psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_admin_audit_block%'"
      期望 = 2（append-only 触发器存在）

- [ ] 11:00  验证表数
      psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'"
      期望 ≥ 50（实测 57）

- [ ] 11:30  seed 起步邀请码 + admin 账号
      pnpm --filter @loverush/db seed
      psql "$DATABASE_URL" -c "INSERT INTO invite_codes (code, kind, target_user_type, max_uses) VALUES ('ADMIN-OPS-001', 'O', NULL, 100) ON CONFLICT DO NOTHING;"

      # 创建首个 admin（手动）
      ./scripts/create-admin.sh tony@loverush.com    # 或手动调 /auth/register + INSERT user_roles

- [ ] 14:00  部署 API 到 Cloudflare Workers
      bash scripts/deploy-production.sh --target api
      验证：curl https://api.loverush.com/ping → 200

- [ ] 15:00  部署 web + admin 到 Cloudflare Pages
      bash scripts/deploy-production.sh --target web
      bash scripts/deploy-production.sh --target admin

- [ ] 16:00  烟测生产 endpoints
      curl https://api.loverush.com/ping → 200
      curl https://api.loverush.com/metrics → 13 个 loverush_* 指标
      浏览器打开 https://loverush.com 加载 OK
      浏览器打开 https://admin.loverush.com 登录页加载 OK
```

---

## 2. D-1 · 上线日前夜

```
- [ ] 20:00  最终凭证自检
      ENV_FILE=.env.production API=https://api.loverush.com bash scripts/launch-readiness-check.sh
      必须：READY=GO

- [ ] 21:00  Sentry / Grafana 接通最终验证
      手动触发：curl https://api.loverush.com/admin/dashboard（无 token）
      检查：Sentry 收到 5 分钟内 / Grafana 看到 401 spike

- [ ] 22:00  内测用户 5 人 flag override 设置（仍是 0% 实际灰度）
      for UID in <5 个 user_id>; do
        curl -X POST $API/admin/flags/launch_canary/overrides \
          -H "Authorization: Bearer $ADMIN_TOKEN" \
          -d "{\"user_id\":\"$UID\",\"enabled\":true,\"reason\":\"D-1 内测\"}"
      done

- [ ] 23:00  通知内测用户
      Slack DM：「明天 09:00 Bangkok 时间正式开放，先用你的账号试一遍核心 user journey：
      注册 → 看推荐 → 下单 → 模拟支付 → 评价。有任何 bug 截图发 #loverush-incidents」

- [ ] 23:30  休息（如果还有精力）· 不要再做技术变更
```

---

## 3. D-Day · 09:00 Bangkok（GMT+7）灰度启动

### 3.1 09:00 - 09:30 · 5% 灰度推上去

```
- [ ] 09:00  确认 API 在线
      curl https://api.loverush.com/ping → 200
      kubectl/wrangler logs：无 5xx errors in last 10 min

- [ ] 09:05  推 5% flag（仅 Bangkok）
      curl -X PUT $API/admin/flags/launch_canary \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -d '{
          "description": "D-Day 5% 灰度",
          "default_enabled": false,
          "rollout_bps": 500,
          "target_cities": ["Bangkok"],
          "enabled": true
        }'

- [ ] 09:10  记录 baseline 指标
      ADMIN_TOKEN=<...> API=https://api.loverush.com \
        bash scripts/daily-canary-watch.sh > reports/canary-d-day-09h.md

      记录初始值（应该全 0 或 baseline）：
      - API p99: ___ ms
      - 5xx ratio: ___ %
      - LLM fail: ___ %
      - Refund: 0

- [ ] 09:15  公告
      Slack #loverush-launch："5% 灰度已推 · 仅 Bangkok 用户 · 接下来 24h 严密观察"

- [ ] 09:30  第一次健康检查
      bash scripts/daily-canary-watch.sh
      期望：4 个 backlog 全 PASS（risk/audit/tickets/withdrawals 都 0）
```

### 3.2 12:00 · 三小时门槛

```
- [ ] 12:00  跑 canary watch
      bash scripts/daily-canary-watch.sh > reports/canary-d-day-12h.md

- [ ] 决策门槛（任一 FAIL → 暂停推进）
      ✓ API p99 < 800ms
      ✓ 5xx ratio < 0.5%
      ✓ LLM fail < 3%
      ✓ PAID→COMPLETED > 90%（或 N/A 如果暂无订单）
      ✓ refund rate < 3%

- [ ] 看 Sentry events count
      期望：< 10 events / hour（基本只有用户报错 not crash）

- [ ] 抽 3 个内测用户 DM
      "用得怎么样？有任何卡顿/报错？"
```

### 3.3 15:00 · 中午门槛

```
- [ ] 15:00  跑 canary watch
      bash scripts/daily-canary-watch.sh > reports/canary-d-day-15h.md

- [ ] 决策（同 12:00）
- [ ] 看 Grafana audit-anomaly 行
      预期：所有 4 个 audit 指标 = 0（无异常 admin / 串谋目标）
```

### 3.4 18:00 · 黄昏门槛

```
- [ ] 18:00  跑 canary watch
      bash scripts/daily-canary-watch.sh > reports/canary-d-day-18h.md

- [ ] 看一日订单完整闭环
      psql $DATABASE_URL -c "SELECT status, count(*) FROM orders GROUP BY status;"
      期望：有至少 1 笔 REVIEWED 状态（说明全链路跑通）
```

### 3.5 22:00 · 日总结

```
- [ ] 22:00  日报
      cat << EOF > reports/d-day-summary.md
      ## D-Day 总结（2026-05-XX）

      ### 凭证指标
      - 注册数：___
      - 订单数：___
      - 完成订单：___
      - GMV（积分）：___
      - DAU：___

      ### 健康指标（00:00-22:00 平均）
      - API p99：___ ms
      - 5xx ratio：___ %
      - LLM fail：___ %
      - Refund rate：___ %

      ### Incidents
      - P0：___ 次
      - P1：___ 次
      - P2：___ 次

      ### 决策
      [ ] 继续推进（D+3 升 25%）
      [ ] 保持 5%（再观察 1-2 天）
      [ ] 暂停（关 flag，修 bug，明天再推）
      [ ] 紧急回滚（按 LAUNCH §4 P0 处理）
      EOF

- [ ] 23:00  备份 DB
      pg_dump $DATABASE_URL | gzip > backups/d-day-end.sql.gz
```

---

## 4. D+1, D+2 · 持续观察

```
每天的固定动作（任选时间但建议固定）：

- [ ] 10:00  跑 canary watch
- [ ] 14:00  跑 canary watch
- [ ] 18:00  跑 canary watch
- [ ] 22:00  日报 + 决策

通过条件（连续 3 天）：
- 4 项核心指标全 PASS
- Sentry 无新 P0 事件
- 用户申诉 ≤ 2 例

不通过 → 不进 D+3 门槛 · 修完再推
```

---

## 5. D+3 · 升 25%

```
- [ ] 09:00  跑 readiness check（确保凭证没过期）
      bash scripts/launch-readiness-check.sh → READY=GO

- [ ] 09:30  推 25% flag
      curl -X PUT $API/admin/flags/launch_canary \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -d '{
          "rollout_bps": 2500,
          "target_cities": ["Bangkok", "Kuala Lumpur"]
        }'

- [ ] 公告：种子城从 Bangkok 扩到 KL
- [ ] canary watch 每 3 小时一次（同 D-Day 节奏，但门槛放宽）

D+3 通过条件（连续 5 天）：
- 同 D+0 指标
- 复购率 > 8%（说明产品 PMF 初步验证）
```

---

## 6. D+8 · 升 50%

```
- [ ] 09:00  readiness check
- [ ] 09:30  推 50% flag
      curl -X PUT $API/admin/flags/launch_canary \
        -d '{"rollout_bps": 5000, "target_cities": ["Bangkok", "Kuala Lumpur", "Shenzhen"]}'

- [ ] 公告：加入深圳 / 上海
- [ ] 数据复盘：D+0 → D+8 漏斗变化
```

---

## 7. D+15 · 升 100%

```
- [ ] 09:00  readiness check
- [ ] 09:30  推 100%
      curl -X PUT $API/admin/flags/launch_canary -d '{"rollout_bps": 10000}'

- [ ] 全平台开放（删除 target_cities · 让全部城市可访问）
- [ ] 公告：v1 正式 GA
```

---

## 8. D+22 · 清理 flag

```
- [ ] 看连续 7 天 100% 稳定
- [ ] 删 flag（防止技术债累积）
      curl -X DELETE $API/admin/flags/launch_canary

- [ ] 删 launch_canary 相关 dead code（搜索 grep -rn "launch_canary" src/）

- [ ] 关闭 D-Day playbook · 项目进入常态运营
```

---

## 9. 故障回滚剧本（参考 LAUNCH.md §4）

### 9.1 P0 全站故障（API 5xx > 50% / DB 不可达）

**5 分钟内动作**：

```
1. Cloudflare DNS → loverush.com 改 CNAME 到静态维护页
   或：手动 wrangler delete-route 让 Workers 不接流量

2. 看 Sentry 错误聚合 → 定位最近一次部署

3. wrangler rollback --env production
   或：bash scripts/rollback-production.sh --target api

4. 验证：curl https://api.loverush.com/ping → 200

5. 重新接 DNS → 流量回归

6. Slack #loverush-incidents 公告事故经过 + 复盘 issue
```

### 9.2 P1 单功能故障（某 flag 后果不达预期）

**1 分钟内动作**：

```
1. 关 flag：
   curl -X PUT $API/admin/flags/<key> -d '{"enabled": false}'

2. 不需要部署回滚 · flag 是软开关

3. Slack #loverush-incidents 记 incident
```

### 9.3 P2 数据异常（积分错账 / 评分跳变）

**不需要立刻动 · 走核账流程**：

```
1. 跑核账 SQL：docs/sql/audit/*.sql

2. 必要时 ADJUSTMENT 类型记账：
   POST /admin/points/adjustment {user_id, delta, reason: "P2 incident adjustment"}

3. 周末复盘 incident 写 retro
```

### 9.4 P3 LLM 提供商挂掉

**自动降级 · 无需手动**：

```
1. LLM gateway 自动 Anthropic → OpenAI → Gemini fallback
2. 看 metric loverush_llm_provider_fallback_total 是否 spike
3. 全挂 → 业务返回 E5050/E5040 + 本来就有客户端兜底

紧急切主 provider（详 packages/llm/README.md §"紧急运营操作"）：
   curl -X PUT $API/admin/flags/llm_force_openai -d '{"enabled":true,"rollout_bps":10000}'
```

---

## 10. 应急联系矩阵

| 角色 | 联系方式 | 备注 |
|---|---|---|
| 技术 oncall | Tony · +86 xxxxx | 主操 |
| 备用 oncall | <同事> | 周末 / Tony 不在 |
| Sentry alerts | Slack #loverush-incidents | 5xx > 5% / DB error spike |
| Grafana alerts | Slack #loverush-alerts | 4 业务指标 warning |
| PagerDuty | <如果配了> | critical only |
| Anthropic 客服 | https://support.anthropic.com | 模型挂 / rate limit |
| Stripe Support | https://support.stripe.com | webhook / 支付失败 |
| Cloudflare | https://dash.cloudflare.com/?to=/:account/support | Workers / Pages 故障 |
| Supabase | https://supabase.com/dashboard/support/new | DB 连接 / 性能 |

---

## 11. 数据日报模板（每天 22:00 填）

```markdown
## Daily Report · D+X · 2026-05-XX

### 凭证扩张
- 当前 rollout_bps: ___
- 当前 target_cities: [___]
- 累计注册：___ (+ __ vs 昨日)
- 累计技师：___ passed verification
- 累计客户：___

### 业务
- 当日订单：___ 创建 / ___ 完成 / ___ 取消
- GMV：___ 积分 / ___ 美元等值
- 复购率：__ %
- AI 助理对话数：___

### 健康
- API p99 (P50/P99)：___ / ___ ms
- 5xx ratio：__ %
- LLM call success：__ %
- LLM 成本：$___（按 tag 拆分）
- Refund rate：__ %

### Incidents
- P0：___ 次（详记）
- P1：___ 次
- P2：___ 次

### 决策
- [ ] 推进下一档（D+3 / D+8 / D+15）
- [ ] 保持当前 rollout（再观察）
- [ ] 回滚 / 暂停（详 LAUNCH §4）
```

---

## 12. 配对文档

| 文档 | 用途 |
|---|---|
| 本文档 | D-Day 逐小时执行清单 |
| `LAUNCH.md §3` | 监控阈值表（决策门槛）|
| `LAUNCH.md §4` | 回滚预案（事故应急）|
| `LAUNCH.md §7` | D-Day 流程高层节奏 |
| `LAUNCH.md §9` | 上线后第一周必做 |
| `scripts/launch-readiness-check.sh` | 凭证 / DB / API 自检 |
| `scripts/daily-canary-watch.sh` | 4 endpoint 阈值判定 |
| `scripts/dry-run-launch.sh` | 本地 docker 演练 |
| `docs/runbooks/credential-setup.md` | 上线前凭证申请 |
| `docs/runbooks/db-migration.md` | DB 变更 SOP |
| `packages/llm/README.md` | LLM 紧急切 provider |

---

**最后更新**：2026-05-22（Phase 35）
**首次使用**：D-Day 实施时 · 跟着勾选清单走
