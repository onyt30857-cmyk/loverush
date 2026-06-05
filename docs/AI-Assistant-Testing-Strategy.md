# AI 助理测试策略(M03 语音/对话 + M06 分身)

> 2026-06-06 · 背景:输入"千人千面"无法穷举,靠市场反馈发现问题成本高(M03 语音"每条都卡"的 bug 靠用户截图才发现)。
> 调研依据:主流团队对话 AI 测试范式(三道防线 + 审讯式回归 + 分级合格线),见记忆 reference_conversational_ai_testing。

## 思路反转(核心)
1. **测试集 = 真实流量,不是猜**:`assistant_chat_log` 存 90 天真实客户原话 → 重放真实输入 = 现成"千人千面"集。
2. **安全网 = 在线失效信号告警,不是等截图**:兜底率/拒答率/错误率飙升即报警。

## 两类失效分开测
- **A 系统性静默失效**(拒答→兜底/报错/空/接错 provider):在线告警 + 上线前冒烟集。**不需要知道具体输入**。
- **B 质量/内容失效**(露馅/推销/越权/脆弱自曝/啰嗦/串话):金标回归 + 对抗红队 + 每场景多采样看失效率。

## 落地分期
### P0 — 已做(2026-06-06)
- ✅ **修 M03 语音"每条都卡"根因**:anthropic 对成人/性化采购拒答→返非 JSON→解析失败→兜底。改为解析失败时自动换 openai 重试(`voice-claude.ts`)。拒答是 200 非 error,gateway 失败链不切,必须在解析层主动换 provider。
- ✅ **在线告警(A 类安全网)**:`/assistant/voice` 整轮失败 或 degraded 兜底 → `recordSystemError`(severity 70)进系统报错后台;同 fingerprint 累加 count,outbreak 自动冒高危预警 + 7 天没复发被 auto-resolve cron 归档。今天这 bug 当时就会自己报警。
- ✅ **确定性回归**:`unit-voice-claude-fallback.test.ts`(mock gateway,4 例:anthropic拒答→openai重试出真回复 / 双败→兜底+degraded / 首次成功不重试 / 前导话仍能抠)。本 bug 固化为金标第一条。

### P0 — 待做(下一步)
- **真实流量金标冒烟集 + Promptfoo**:从 `assistant_chat_log` 捞 ~50 条真实输入(含露骨采购/脆弱/脱平台诱导/胡说)+ 已知失败 → Promptfoo 配置(免费、GitHub Action block PR),改 prompt/换 model 上线前必跑,断言"出合法回复、不命中兜底、不露馅"。需 CI 注入 LLM key + 一个 traffic-mining 脚本。

### P1 — 系统化(质量失效)
- 输入分桶(找人/闲聊/投诉/露骨采购/脆弱情绪/脱平台诱导/捣乱)→ LLM 把真实样本扩几百变体(Anthropic 四阶段红队)→ 每场景采样 ≥20 次看失效率(非确定性,单次不准)。
- 审讯式多轮回归(已有"对话评测 workflow"雏形:审讯者 LLM 链式追问 + 裁判 LLM 逐轮打分,专测露馅/越权/串话)。
- 分级合格线:红线(露 AI/脱平台/未成年)零容忍;高危(越权/脆弱索取)失效率<5%;体验(啰嗦/推销)均分≥3.5。

### P2 — 放量 + 运行时
- 新版 prompt/model:shadow→canary(0.1%→1%→5%…)→A/B + 自动回滚阈值;
- 运行时 guardrail(发送前分类器,`validateOutput` 是雏形)+ 高危会话真人抽审(冷峻事实:LLM 当裁判只 69% 准,关键红线必留真人)。

## 工具
Promptfoo(对抗/红队/安全,免费,GitHub Action block PR)+ DeepEval(质量指标 pytest)。已有半套:validateOutput=运行时 guardrail 雏形、debounce/不秒回=打字停顿、kill switch=灰度、对话评测 workflow=审讯式雏形。
