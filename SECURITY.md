# SECURITY.md · 安全漏洞报告流程

## 支持的版本

| 版本 | 安全更新 |
|------|---------|
| v1.x (current) | ✅ 全力修 |
| v0.x (pre-release) | ⚠️ 仅 P0 |

## 如何报告

**请不要公开 issue 报告利用型漏洞**（可导致数据泄露 / 资金损失 / 账户接管 / 服务瘫痪）。

私下报告流程：
1. **邮件**：security@loverush.com（PGP 公钥见下）
2. 标题：`[SECURITY] <一句话描述>`
3. 包含：
   - 漏洞类型（SQL 注入 / 鉴权绕过 / IDOR / SSRF / XSS / 加密弱点 / ...）
   - 影响范围（哪个端点 / 哪个模块）
   - 复现步骤（PoC）
   - 建议修复方向

我们承诺：
- **24h** 确认收到
- **3 工作日** 给出严重程度评估
- **7 工作日** 给出修复时间表
- **30 天** 发布修复（P0 立即 hotfix）

## 致谢

修复发布后会在 `CHANGELOG.md` 致谢报告者（如本人同意）。

## 范围

**在范围**：
- API / Web / Admin 端鉴权、授权、数据隔离
- 加密算法 / 密钥管理（端到端、JWT、PIN）
- 支付流转（充值、提现、付费墙）
- LLM prompt 注入 / 越狱
- Webhook 签名校验
- SQL / NoSQL 注入
- SSRF / XXE / XSS

**不在范围**：
- 已知 P3 限制（见 `v1/TECH-DEBT.md`）
- 第三方服务（Cloudflare / Supabase / Stripe / R2 / Sentry）的漏洞 → 请直接报对方
- 社会工程 / 物理攻击
- DDoS（已由 Cloudflare 防护）
- 仅文档错别字

## 漏洞严重程度

按 OWASP Risk Rating 评估：

| 等级 | 例子 | SLA |
|------|------|-----|
| 🔴 严重（Critical） | 鉴权完全绕过 / 任意 SQL / 任意账户接管 / 资金任意调拨 | 24h hotfix |
| 🟠 高（High） | IDOR / SSRF / 跨用户数据泄露 / 密钥派生算法弱 | 7d |
| 🟡 中（Medium） | 限流绕过 / 信息泄露（不含敏感） / XSS（认证后）| 14d |
| 🟢 低（Low） | 拒绝服务（单点 IP）/ 配置疏漏 | 30d |

## 已知设计权衡

下面这些**不是漏洞**，是产品决策上的权衡（详见 `ARCHITECTURE.md` §5）：

1. **加密消息不做服务端红线检测**：服务端拿不到明文。靠客户端本地检测 + 用户主动 toggle。
2. **加密消息不做翻译**：同上。e2e toggle 启用后 UI 提示"关闭翻译"。
3. **AI 红线检测有 5% 假阴率**：靠 simhash 反重复 + 人工兜底，不是 100% 防线。
4. **设备指纹易绕过**：靠多个 fingerprint 组合 + IP 黑名单 + 行为模式联合判断。
5. **客户端 ZERO AI 标识**：早期阶段策略，违反时报漏洞会被关闭为 "by design"。

## 安全设计参考

- **JWT**：HS256 + 32+ 字符 secret + 1h access TTL + 30d refresh TTL + session 表撤销
- **PIN**：PBKDF2-SHA256 + 200k iter + 16B salt + 指数退避锁定
- **端到端**：BIP-39 → HKDF → X25519 + ephemeral key（PFS） + AES-256-GCM
- **Webhook**：Stripe 签名校验 + idempotency 用 event.id 防重投
- **凭证链**：sha256(prev + payload + seq + type)，append-only
- **角色矩阵**：5 种角色 + requireRole 中间件，第一个 admin 用 SQL 直接 INSERT
- **CSP / Headers**：Hono `secureHeaders()` 默认开启

详见 `ARCHITECTURE.md` §5 关键设计决策。

## PGP 公钥

（占位 · 实际部署前生成 GPG 密钥替换）

```
-----BEGIN PGP PUBLIC KEY BLOCK-----
TODO: 部署前生成 GPG key
-----END PGP PUBLIC KEY BLOCK-----
```
