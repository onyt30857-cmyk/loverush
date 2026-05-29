# M03 AI 助理治理后台 · 规划 PRD v1

> 起草日:2026-05-29
> 范围:apps/admin 内针对客户 AI 助理(M03)的管理面板
> 视角:AI 产品运营专家 + AI 工程视角
> 状态:草案 · 待评审

---

## §0 背景与现状盘点

| 维度 | 已有 | 缺口 |
|---|---|---|
| 后端能力 | 11 endpoint(`/assistant/*`)+ 13 张 AI 相关表 + 5 层记忆(L1-L5)+ 4 个定时 job + Voice/Few-shot 全套 + 3 家 LLM provider 路由 + token 计费 | 内省 API 不够:prompt 历史、会话回放、单客户 memory 编辑、Bad case 收集 |
| Admin 已有 AI 页面 | `/ai/redline`(红线)、`/ai/cost`(成本)、`/ai/messages`(分身审计)、`/ai/assistant-profiles`(客户画像) | 4 个页面**偏重 AI 分身(M06)**,客户助理(M03)只有"画像"一页 |
| PRD 覆盖度 | M03 PRD 35 模块 + 5 政策红线 + 8 核心 KPI 已写完整 | 后台看不到这 35 模块每一个的健康度,运营只能凭感觉 |

**一句话定性**:有完整的 AI 引擎,**没有 AI 运营驾驶舱**。后台缺的不是"AI 治理"——是**针对客户助理(M03)的产品 + 运营 + AI 工程的全栈管理面板**。

---

## §1 运营场景倒推 · 6 个真实痛点

| 场景 | 当前怎么处理 | 应该怎么处理 |
|---|---|---|
| **A. 客户投诉"助理回答烂"** | 客服请研发查 DB / grep 日志 | 后台输入客户 ID → 一键看最近 N 轮对话(含 prompt、模型、Voice、玩笑度、filter 重 sample 次数) |
| **B. 上线 Voice 改动** | 改代码 → push → 全量生效,有问题回滚要再 deploy | 后台**新建 Voice 版本** → 灰度 1% → 看 KPI 变化 → 渐进放量,不行一键 rollback(无需 deploy) |
| **C. 反 AI slop 黑名单又漏一句** | 改 filter.ts → push → 等部署 | 后台编辑黑名单词典 → 立刻热生效 |
| **D. 某客户记忆错了 / 有泄漏** | 直连 DB 改表 | 客户详情页 → L1-L5 记忆可视化 → 手动编辑/删除某条 → 审计日志 |
| **E. 月底成本飙升** | 查 ai_alter_messages 算 SUM | Cost 大盘按 **模型/场景/客户/技师/Voice 版本** 多维下钻,自动告警 |
| **F. Few-shot 改了不知道有没有效果** | 凭感觉 | 后台 **A/B 实验**:对照组用旧 fewshot,实验组用新,看推荐转化率/满意度差异 |

---

## §2 AI 工程师视角 · 5 个内部需求

| 需求 | 描述 |
|---|---|
| **G. Prompt 版本与回滚** | system-prompt / fewshot / onboarding 每改一次都有版本号 + git-like diff + 当前生效版本 + 一键回滚 |
| **H. Provider/Model 路由策略** | Anthropic/OpenAI/Gemini 三家 weighted 路由、按 tier(haiku/sonnet/opus)分场景、单家全挂时降级开关 |
| **I. Filter 误杀 + Bad case 集** | filter 重 sample ≥3 次仍未通过的 case → 自动入 Bad case 集 → 人工标注 → 反哺 fewshot |
| **J. Memory 完整性巡检** | RLS 隔离每周自动跑 10K 抽样 SQL,确保跨客户 0 泄漏(PRD 要求 100%) |
| **K. Job 健康度** | 4 个 cron(归档/聚类/召回/push)的执行历史、耗时、错误率,异常告警 |

---

## §3 模块清单 · 11 新增 + 1 升级 · 分 4 大类

### 🅰️ 对话与质量

| # | 模块名 | 路径建议 | 核心能力 | 数据依赖 |
|---|---|---|---|---|
| **A1** | **会话回放** | `/ai/assistant/sessions` | 客户 ID/会话 ID 搜索 · 完整 turn-by-turn 回看:user input → 注入的 memory/voice/fewshot → LLM raw output → filter 重 sample 历史 → 最终展示给客户的文本 | `customer_assistant_sessions` + 新增 `assistant_chat_log` 表(prompt + model + attempts) |
| **A2** | **Bad case 集** | `/ai/assistant/badcases` | 自动收集 filter ≥3 次重 sample / 客户负反馈 / 一键真人接力触发的对话 · 人工标注 fix 方案 · 反哺 fewshot | 新增 `assistant_bad_case` 表 |
| **A3** | **Filter 误杀回看** | `/ai/assistant/filter-misses` | 黑名单/软规则命中明细 · 假阳性人工标注 · 编辑黑名单词典(热生效) | 新增 `assistant_filter_hit` 表 + 黑名单 KV 表 |

### 🅱️ Prompt 与 Voice 管理

| # | 模块名 | 路径建议 | 核心能力 | 数据依赖 |
|---|---|---|---|---|
| **B1** | **系统提示词版本** | `/ai/assistant/prompts` | system-prompt-zh/en/泰/越 等 + 6 步 onboarding + greeting 的版本管理 · diff 对比 · 当前生效 · 一键回滚 · 灰度发布关联 feature flag | 新增 `assistant_prompt_version` 表 |
| **B2** | **Few-shot 样本库** | `/ai/assistant/fewshot` | 按 scenario × locale 分类 · CRUD + 标注 + 效果归因(用过的会话满意度) | 新增 `assistant_fewshot_sample` 表 |
| **B3** | **Voice 配置** | `/ai/assistant/voice` | 5 个场景 × 4 档玩笑度 × 多 locale 矩阵 · 反 slop 黑名单 · 词典热生效 | 已有 `voice.ts` 抽到 DB:`assistant_voice_config` |

### 🅲 记忆与画像

| # | 模块名 | 路径建议 | 核心能力 | 数据依赖 |
|---|---|---|---|---|
| **C1** | **客户记忆面板**(升级现有 `/ai/assistant-profiles`) | `/ai/assistant-profiles/[id]` | L1+L2 saved memory 可视化编辑 · L3-L5 reference 只读 + 删除 · 5 簇兴趣可视化 · 一键擦除审计 · session preferences 可看可清 | 已有完整后端 |
| **C2** | **跨客户隔离巡检** | `/ai/assistant/isolation-check` | 每周自动抽样 10K 查询验证 RLS · 任何泄漏即 P0 告警 · 历史 100% 正确率证明给监管看 | 新增定时 job + 报告表 |

### 🅳 模型 / 成本 / KPI

| # | 模块名 | 路径建议 | 核心能力 | 数据依赖 |
|---|---|---|---|---|
| **D1** | **KPI 大盘** | `/ai/assistant/kpi` | PRD 8 KPI 实时:首单转化 / 满意度 / NPS / 沉默召回 CTR / 首条延迟 / L5 计算延迟 / 隔离正确率 / slop 命中率 · WoW 对比 · 漏斗下钻 | 已有大部分,要补埋点 |
| **D2** | **LLM 路由配置** | `/ai/assistant/routing` | 主链路 provider/model 权重 · tier 路由(haiku/sonnet/opus 按场景)· 单家 provider 故障 fallback 开关 | 新增 `llm_routing_policy` 表 |
| **D3** | **A/B 实验** | `/ai/assistant/experiments` | 对 prompt / voice / fewshot / routing 做组实验 · 按 customer_id hash 分流 · 自动归因 KPI 差异 | 复用 feature flags + 新增 `assistant_experiment` 表 |

### 🅴 运维与健康

| # | 模块名 | 路径建议 | 核心能力 | 数据依赖 |
|---|---|---|---|---|
| **E1** | **Job 健康度** | `/ai/assistant/jobs` | 4 个 cron(archive / cluster / recall / push)执行历史 + 耗时 + 错误 + 手动触发 + 暂停开关 | 新增 `job_run_log` 表 |

---

## §4 优先级分批

### 批次 1 · 必做 MVP(6 个模块 · 客服 + AI 工程师立刻受益)

```
A1 会话回放        ← 客服查问题第一现场
A2 Bad case 集     ← 不收集就没改进闭环
B1 系统提示词版本   ← 不能再 deploy 改 voice
B3 Voice 配置      ← 黑名单热生效救命
C1 客户记忆面板    ← 隐私契约要求(已有底子,扩功能)
D1 KPI 大盘        ← PRD 8 KPI 一个都看不见
```

### 批次 2 · 紧接补强(3 个模块 · 完整治理闭环)

```
A3 Filter 误杀回看
B2 Few-shot 库管理
D2 LLM 路由配置
```

### 批次 3 · 后续完善(3 个模块 · 高阶能力)

```
C2 跨客户隔离巡检
D3 A/B 实验
E1 Job 健康度
```

---

## §5 后端需要补的能力

| 模块 | 新增 API endpoint | 新增 / 改造表 |
|---|---|---|
| A1 会话回放 | `GET /admin/assistant/sessions/:id/replay` | `assistant_chat_log` (chat_id, prompt, model, raw_output, attempts, scenario, joke_level, voice_version, fewshot_ids) |
| A2 Bad case | `GET/POST /admin/assistant/badcases` | `assistant_bad_case` (chat_id, reason, fix_note, status) |
| A3 Filter 命中 | `GET /admin/assistant/filter-hits` + `POST /admin/assistant/blacklist` | `assistant_filter_hit` + `assistant_blacklist_term` |
| B1 Prompt 版本 | `GET/POST /admin/assistant/prompts/versions` + `POST /activate` | `assistant_prompt_version` (locale, scope, content, active, rollout_pct, created_by) |
| B2 Few-shot | `GET/POST /admin/assistant/fewshot` | `assistant_fewshot_sample` (scenario, locale, prompt, response, weight, active) |
| B3 Voice 配置 | `GET/POST /admin/assistant/voice` | `assistant_voice_config` (scenario, joke_level, locale, blacklist_terms) |
| C1 记忆面板 | `GET /admin/customers/:id/memory` + `PATCH /memory/:layer` | 复用已有 5 表 |
| C2 隔离巡检 | `POST /admin/assistant/isolation-check/run` + `GET /reports` | `isolation_check_report` + 定时 job |
| D1 KPI | `GET /admin/assistant/kpi?range=7d&breakdown=...` | 复用现有事件表 + 补埋点 |
| D2 路由 | `GET/POST /admin/assistant/routing` | `llm_routing_policy` |
| D3 实验 | `GET/POST /admin/assistant/experiments` + 归因 | `assistant_experiment` |
| E1 Job | `GET /admin/jobs` + `POST /trigger` + `POST /pause` | `job_run_log` |

**总计**:约 25 个新 endpoint,12 张新表(含改造)。

---

## §6 UI/UX 范式 · 对齐已有 admin

**导航位置**:在已有 `AI 治理` 分组(🤖)下,把 4 个现有页 + 11 个新模块组织为 **5 个二级分组**:

```
🤖 AI 治理
├─ 📊 大盘
│   ├─ KPI 大盘 ★新                 ─ D1
│   ├─ 红线监控                     ─ 已有
│   └─ 成本看板                     ─ 已有
├─ 🎙 助理对话
│   ├─ 会话回放 ★新                 ─ A1
│   ├─ Bad case 集 ★新              ─ A2
│   ├─ Filter 误杀 ★新              ─ A3
│   └─ AI 代发审计                  ─ 已有(/ai/messages 偏 M06)
├─ 🧠 助理智能
│   ├─ 系统提示词版本 ★新           ─ B1
│   ├─ Few-shot 库 ★新              ─ B2
│   └─ Voice 配置 ★新               ─ B3
├─ 👤 客户记忆
│   ├─ 客户记忆面板(升级)         ─ C1
│   └─ 隔离巡检 ★新                 ─ C2
└─ ⚙️ 引擎运维
    ├─ LLM 路由 ★新                 ─ D2
    ├─ A/B 实验 ★新                 ─ D3
    └─ Job 健康 ★新                 ─ E1
```

**页面范式**:严格复用 `AdminShell` + 头部筛选/搜索 + `.card` + `.table` + 侧滑 modal,**不引入新 UI 库**。

**图表**:暂不引入 chart 库,KPI 大盘用纯 CSS 进度条 + 数字大字 + WoW 红绿箭头(跟现有 `/dashboard` 一致)。如果 D1/D2 需要更复杂图表,只引入 `recharts`(tree-shake 后约 2KB)。

---

## §7 关键风险与对策

| 风险 | 影响等级 | 对策 |
|---|---|---|
| **Prompt 改错导致全量客户体验崩** | P0 | B1 强制灰度:新版本 1% → 监控 KPI → 渐进放量,任何指标恶化自动回滚 |
| **A1 会话回放暴露客户记忆** | 合规 | admin 角色细粒度:只有 cs + auditor 能看 chat 内容,ops 只能看 metadata,所有访问入审计日志 |
| **A3 黑名单编辑误杀** | 体验 | 任何编辑触发 dry-run:用最近 1000 条对话回放看会拦多少,人工确认才热生效 |
| **C1 修改客户记忆** | 隐私 | 仅 cs / admin 可改,改后**通知客户 + 留 30 天撤回窗** |
| **D2 切 provider 全挂** | 业务中断 | 强制双 provider always-on,健康检查 fail 自动切;手动切 provider 时强制有 fallback |
| **D3 实验长尾污染** | 数据 | 单实验最长 30 天自动结束,结果归档,实验组样本量不足时自动停 |

---

## §8 与现有页面的关系

| 现有页面 | 处理 |
|---|---|
| `/ai/redline` | **保留** · M06 治理的核心,不动 |
| `/ai/cost` | **保留 + 增强** · D1 KPI 大盘的"成本"维度从这里上钻进入 |
| `/ai/messages` | **保留** · M06 AI 分身代发审计专属 |
| `/ai/assistant-profiles` | **升级为 C1** · 增加 L1-L5 编辑、会话偏好可清、审计 |
| `/dashboard` | **保留** · 全站总览,D1 是其下的 AI 子集 |

---

## §9 落地次序(逻辑依赖)

```
            ┌─ A1 (会话回放)            必做先做
            │   ↓ 依赖 chat_log 表
            ├─ A2 (Bad case)            紧接 A1
            │   ↓ 依赖 A1 数据
            ├─ A3 (Filter 误杀)          依赖 A1
            │
            ├─ B1 (Prompt 版本)         独立可做,推荐优先
            │   ↓ 跟 B3 同期
            ├─ B3 (Voice 配置)          独立可做
            │   ↓ B1+B3 完成后
            ├─ D3 (A/B 实验)            依赖 B1+B3 的版本化
            │
            ├─ C1 (客户记忆面板)         独立,后端已就绪可立即做
            │   ↓ 跟 C2 同期
            ├─ C2 (隔离巡检)            独立
            │
            ├─ D1 (KPI 大盘)            依赖埋点齐
            ├─ D2 (LLM 路由)            独立可做
            └─ E1 (Job 健康)            独立可做
```

**逻辑上必须有的依赖**:A2/A3 依赖 A1 先有日志;D3 依赖 B1+B3 先有版本化。其余各模块独立,可任意顺序推进。

---

## §10 验收口径

每个模块上线时验:

1. **功能完备性** · 所列核心能力全部可操作
2. **数据正确性** · 后台显示的数字跟 DB 直查一致(随机抽 5 条)
3. **权限隔离** · admin / cs / auditor / ops 各自只能看到允许的内容
4. **审计日志** · 任何写操作都进 `admin_audit_log`
5. **真机视口** · 1280 / 1440 / 1920 三个分辨率主流程跑通

---

## §11 待办 / 未决

- [ ] 多 locale 提示词管理:中/英/泰/越/印尼/马来 6 种,版本化是不是按 locale 独立?
- [ ] B2 Few-shot 权重是手动设还是按效果自动调?
- [ ] D3 A/B 实验的统计学:用 chi-square 还是 bayesian?
- [ ] C1 客户记忆编辑是否需要客户 in-app 确认(避免 admin 单方面改)?
- [ ] 审计日志保留多久?跟 GDPR 退订要求一起对齐

---

## 附录 A · 事实底座

**已有后端能力**(基于代码扫描):

- API:11 个 `/assistant/*` endpoint + 7 个 `/conversations/*` + 5 个 `/me/blocks` 相关
- DB 表:13 张 AI 相关(customer_assistant_profile / customer_saved_memory / customer_reference_memory / customer_interest_clusters / customer_outreach_state / customer_assistant_sessions / customer_session_preferences / customer_behavior_profile / messages / message_translations / translation_cache / ai_alter_messages / ai_alter_redline_logs)
- 记忆 5 层:L1 facts / L2 stable_prefs / L3 rotating(7-30 天归档) / L4 relations / L5 diff
- Cron:4 个(archive 24h / cluster 24h / silent_recall 24h / proactive_push 1h)
- LLM:Anthropic Claude + OpenAI GPT + Google Gemini 三家 weighted gateway,Haiku 用于异步 NER
- 计费:`ai_alter_messages.costUsdMicros` 已记账,缺 M03 主链路计费

**PRD 已写完**(M03-AI-Assistant-PRD.md):

- 35 功能模块(F03-Home1 / F03-OB1-5 / F03-M1-4 / F03-D1-14 / F03-C1-4 / F03-A1-5 / F03-P1-8 / F03-32-35)
- 5 政策红线(客户端 ZERO AI 标识 / 与 M06 政策对立 / 零评判契约 / 反 slop 黑名单 / 跨次记忆 RLS 硬隔离)
- 8 核心 KPI(首单转化≥25% / 满意度≥85% / NPS≥70 / 沉默召回 CTR≥8% / 首条延迟≤2s / L5 计算≤100ms / 隔离 100% / slop 命中<0.5%)

---

> 起草:Claude(AI 资深运营专家视角)
> 待评审:产品 / 架构 / 风控 / 客服 4 方
