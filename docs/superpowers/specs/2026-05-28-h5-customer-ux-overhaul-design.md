# Design · LoveRush H5 客户端 UX 大修

**日期**:2026-05-28
**触发**:用户反馈 H5 客户端体验差(加载闪烁慢 / 二级页间距乱 / 重登跳错页),要求做整套体验校验 + 立主流设计规范。
**授权**:用户全权授权 agent 自主决策与操作,关键节点报告。

---

## 范围

- **入** · 客户端 H5:`/` `/home` `/discover` `/conversations` `/conversations/[id]` `/assistant` `/order` `/order/[id]` `/order/[id]/chain` `/me` + `/me/*` 子页 + `/therapist/[id]` 详情/下单 + `/register` `/recover` 流程
- **出** · 暂不含技师端 `/t/*`、admin、原生壳

## 目标

1. 把"加载/间距/路由"等系统性体验问题**定位**(P1)
2. 沉淀**主流交互+视觉设计规范** `INTERACTION-STANDARDS.md`(P2)
3. 按规范**修**(P3),线上验证

## 3 阶段

| Phase | 我做什么 | 交付 |
|---|---|---|
| **P1 · QA 审计** | 真人 + browse 扫所有客户端页;每条 bug 带截图 + 严重度 | `docs/h5-customer-ux-audit-2026-05-28.md` |
| **P2 · 规范定稿** | 写 8 类规则:间距 / typography / 色 / 加载 / 错误 / 路由&登录 / 动效时长 / 空态;每条带"做/不做"+ token 映射 | `docs/INTERACTION-STANDARDS.md` |
| **P3 · 并行修复** | 派多个 agent 按规范修 C/H/M 严重度;推 main;线上截图复核 | git 提交 + audit 文档标"已修" |

## 执行模式 · C

- **审计 + 规范**:agent 亲做,品味/一致性不外包
- **修复**:多 agent 并行,各领 bug 簇 + 规范;agent 主控收口
- **gate**:用户授权自主推进,**仅在出现重大方向分歧或破坏性操作前停下**

## 严重度门槛

| 级 | 描述 | 本轮处理 |
|---|---|---|
| **C / Critical** | 阻塞核心流程(如登录后跳错) | 必修 |
| **H / High** | 显著体验损坏(加载闪 / 排版错位) | 必修 |
| **M / Medium** | 不影响功能但难看 | 必修 |
| **L / Low** | 边缘细节(微动效/hover) | backlog |
| **Cosmetic** | 锦上添花 | backlog |

## 用户已报告 bug(P1 必收 + P3 必修)

1. **C/H** · 二级页加载骨架闪烁、加载时间长 — 应秒进
2. **M** · 二级页间距/对称不齐
3. **C** · 客户重新登录后跳到二级页(应跳首页)

## 风险与回滚

- 多 agent 并行改前端 → 用 git worktree 隔离 + agent 主控合并
- 推 main 触发 Railway 自动部署 → 推前必跑 `pnpm typecheck && pnpm build`,出错不推
- 改动跨 7+ 文件以上的批次,各 agent 用 PR 风格 diff 报回,我审后合
- 任何破坏性 prod DB 操作前停下问用户(已建立的红线)

## 完成定义(Done)

- 用户报的 3 bug 在线上消失(截图对比)
- C/H/M 全部修完
- `INTERACTION-STANDARDS.md` 成为后续新页面的"自检清单"
- audit 文档归档,L/Cosmetic 转入 backlog
