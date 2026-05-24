# @loverush/llm · LLM 网关

> 多 provider 容错 + Tier 路由 + 流式 + 成本记账
> 业务侧只关心 `tier: T1/T2/T3`，不关心 provider 和 model

---

## 快速开始

```typescript
import { createLLMGateway, AnthropicProvider, OpenAIProvider, GeminiProvider } from '@loverush/llm';

const gateway = createLLMGateway({
  providers: {
    anthropic: new AnthropicProvider(env.ANTHROPIC_API_KEY),
    openai: new OpenAIProvider(env.OPENAI_API_KEY),
    gemini: new GeminiProvider(env.GOOGLE_GEMINI_API_KEY),
  },
  onMetric: (m) => metricsClient.report(m),  // 上报 Prometheus
});

// 普通调用
const res = await gateway.complete({
  tier: 'T2',
  system: '你是 LoveRush 的贴心助理...',
  messages: [{ role: 'user', content: '你好' }],
  userId: 'u_123',
  traceId: 't_abc',
  tag: 'chat:greeting',  // cost 归因标签
});

// 流式（SSE 透传）
for await (const chunk of gateway.stream({ tier: 'T1', messages: [...] })) {
  if (chunk.done) break;
  res.write(`data: ${JSON.stringify({ text: chunk.delta })}\n\n`);
}
```

---

## Tier 路由（默认 `TIER_ROUTE`）

业务调用时只传 `tier`，网关按下表挑 provider：

| Tier | 用途 | 主 provider | 降级链 | 主 model |
|---|---|---|---|---|
| **T1** | 主对话（高质量）| anthropic | → openai | Claude Sonnet 4.5 |
| **T2** | 高频轻量任务（翻译/红线/分类）| anthropic | → gemini | Claude Haiku 4.5 |
| **T3** | 复杂推理（仲裁/AI 分身高阶场景）| anthropic | → openai | Claude Opus 4.7 |

各 provider 在各 tier 上的具体 model 见 `src/providers/{anthropic,openai,gemini}.ts` 顶部 `MODELS` 常量。

### AI 调用决策表（PRD §4.3.6 实施位置）

| 业务场景 | tier | 典型 system prompt | 实施位置 |
|---|---|---|---|
| 注册流式对话 | T2 | 引导式聊天 | `apps/api/src/services/register-chat.ts` |
| 跨语言私聊翻译 | T2 | 单次翻译 | `apps/api/src/services/chat-translate.ts` |
| 客户偏好抽取 | T2 | 结构化输出 + responseSchema | `apps/api/src/services/preferences.ts` |
| 客户 AI 助理对话（M03）| T1 | 长 system + memory | `apps/api/src/services/customer-assistant.ts` |
| AI 分身六类基础场景（M06）| T1 | 6 大话术 DNA system | `apps/api/src/services/ai-clone.ts` |
| AI 分身高阶场景（仲裁/8 类高阶） | T3 | 长 system + 多轮推理 | `apps/api/src/services/ai-clone.ts` |
| 客服仲裁分类（M12）| T3 | 凭证链 + 规则推理 | `apps/api/src/services/arbitration.ts` |
| 红线检测（5 红线）| T2 | 短分类 | `apps/api/src/services/redline.ts` |

---

## 容错链工作方式

`src/gateway.ts` 实现：

1. 按 `tier` 拿到 provider 优先级列表
2. 逐个调用，遇 retryable 错误 → 自动 fallback 到下一个
3. 全失败 → 抛 `LLMError('ALL_PROVIDERS_FAILED', ...)`
4. 每次调用（成功或失败）都触发 `onMetric` 回调

### 错误码与降级判定

| LLMError code | retryable | 行为 |
|---|---|---|
| `RATE_LIMIT` | ✅ | 自动 fallback |
| `TIMEOUT` (默认 30s) | ✅ | 自动 fallback |
| `PROVIDER_ERROR` (5xx) | ✅ | 自动 fallback |
| `AUTH_FAILED` (401/403) | ❌ | 立即抛错（凭证错配 → 告警）|
| `INVALID_REQUEST` (400) | ❌ | 立即抛错（业务侧 prompt 写错）|
| `CONTENT_FILTER` | ❌ | 立即抛错（内容审核命中）|
| `ALL_PROVIDERS_FAILED` | — | 终态，业务侧兜底（如返回固定文案 + 客服 ticket）|

业务侧建议：`try { await gateway.complete(...) } catch (e) { if (e.code === 'ALL_PROVIDERS_FAILED') { /* fallback 文案 + 记 incident */ } }`

---

## 环境变量

```bash
# 主 provider（必填）
ANTHROPIC_API_KEY=sk-ant-xxx

# 降级 provider（建议至少配一个，否则单点风险）
OPENAI_API_KEY=sk-xxx           # T1/T3 降级备
GOOGLE_GEMINI_API_KEY=xxx       # T2 降级备
```

构建 gateway 时只传被设置的 provider，未配置的会在路由阶段被自然跳过（参考 `gateway.ts` `resolveProviders()`）。

可选调优：

```bash
LLM_TIMEOUT_MS=30000   # 单 provider 超时（默认 30s）
LLM_MAX_TOKENS_T1=1024 # 各 tier 默认 maxTokens（在业务层 request 里覆盖）
```

---

## Metric 与告警

每次调用通过 `onMetric` 回调上报：

```typescript
interface LLMMetric {
  tier: string;                  // T1/T2/T3
  provider: 'anthropic'|'openai'|'gemini';
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;               // 估算（COST_PER_MTOK 表）
  latencyMs: number;
  success: boolean;
  errorCode?: string;            // 失败时填 LLMError.code
  traceId?: string;
  userId?: string;
  tag?: string;                  // 业务归因
}
```

### 对应 Prometheus 指标

`apps/api/src/services/metrics.ts` 把 `onMetric` 翻译成 9+ 个核心指标：

| Metric | type | 阈值（参 `infra/prometheus/rules.yml`）|
|---|---|---|
| `loverush_llm_calls_total{tier,provider,success}` | counter | failure ratio > 10% → warning |
| `loverush_llm_tokens_total{tier,provider,kind}` | counter | 周环比 > 200% → 成本异常 |
| `loverush_llm_cost_usd_total{tier,provider,tag}` | counter | 单日 > $50 → warning · > $200 → critical |
| `loverush_llm_latency_ms{tier,provider}` | histogram | p99 > 5000ms → warning |
| `loverush_llm_provider_fallback_total{from,to}` | counter | 单日 > 50 → P1 告警 |

Grafana 面板：`infra/grafana/loverush-dashboard.json`（LLM 行 5 panel）

---

## 紧急运营操作

### 1. 紧急切主 provider（如 Anthropic 全网挂）

**方式 A**：改环境变量 + 重启（影响所有调用）

```bash
# Vultr API server
sudo vi /etc/loverush/api.env
# 把 ANTHROPIC_API_KEY 改成空 / 错误值 → 自动降级到 OpenAI
sudo systemctl restart loverush-api

# 或注释掉，但还是需要 OPENAI_API_KEY 已配
```

**方式 B**：业务侧 `forceProvider`（细粒度，不重启）

```typescript
// 临时强制走 OpenAI
const res = await gateway.complete({
  tier: 'T1',
  forceProvider: 'openai',
  messages: [...],
});
```

**方式 C**（推荐）：feature flag 控制

```bash
# 创建 flag
curl -X PUT $API/admin/flags/llm_force_openai \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"enabled":true,"default_enabled":true,"rollout_bps":10000}'

# 业务侧读 flag 后再决定要不要传 forceProvider
```

灰度 + 即时回退兼得，建议常态走方式 C。

### 2. 调高超时（个别 provider 抖动）

`LLM_TIMEOUT_MS` 改大并重启。或者业务侧针对场景重新构建 gateway 实例（不推荐，会破坏 metric 一致性）。

### 3. 成本失控（单日 > $200）

1. 看 Grafana `loverush_llm_cost_usd_total{tag=*}` 找到爆炸的 tag
2. 在调用源头加限流（`apps/api/src/middleware/rate-limit.ts` 已有限流模板）
3. 必要时把对应业务的 tier 从 T1 降到 T2（接受质量损失换成本）
4. 永久方案：调 `routeOverride`，让该 tag 走更便宜的 provider

参考：`LAUNCH.md §3` 业务核心指标、`OPERATIONS.md §10` LLM 异常 runbook

---

## 测试

```bash
pnpm --filter @loverush/llm test
```

测试约定：

- Provider 单测：mock SDK，测 `mapError()` / `mapStopReason()` / 成本计算
- Gateway 单测：mock provider 实例，测降级链 / `fallbackChain` 记录 / `onMetric` 触发时机
- E2E：在 `apps/api/test/` 里有走真实 gateway 的 path

---

## 配对文档

| 文档 | 用途 |
|---|---|
| 本 README | gateway 用法 + 容错 + 紧急操作 |
| `PRD-为爱冲锋-v1.0.md §4.3.6` | AI 调用决策表（业务原话） |
| `PRD-为爱冲锋-v1.0.md §10.13` | LLM 多 provider 容错规范 |
| `v1/modules/M03-客户偏好与AI助理.md` | 客户助理对话流程 |
| `v1/modules/M06-AI代聊与声音复刻.md` | AI 分身六大话术 DNA |
| `infra/prometheus/rules.yml` | LLM 告警规则 |
| `OPERATIONS.md §10` | LLM 异常 runbook |

---

**最后更新**：2026-05-22（Phase 30 · 上线 SOP 自动化收尾）
