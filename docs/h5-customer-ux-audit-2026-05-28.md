# H5 客户端 UX 审计 · 2026-05-28

**范围**:线上客户端 H5(`loverush-web-production.up.railway.app`),14 个页面 settled 截图
**方法**:Playwright 受控 Chromium,820×960 视口(触发桌面端 844 封顶,与真机+预览框等价),真实测试客户登录态(ID `cf5910d0…`,审计完即删)
**截图**:`/tmp/audit-2026-05-28/shots/`
**审计员**:agent(品味/一致性优先)

---

## 严重度统计

| 级 | 数 | 本轮处理 |
|---|---|---|
| **C / Critical** | 3 | 必修 |
| **H / High** | 5 | 必修 |
| **M / Medium** | 7 | 必修 |
| **L / Low** | 4 | backlog |
| **Cosmetic** | 3 | backlog |

---

## 🔴 Critical — 阻塞核心体验,本轮必修

### C1. `/me` 加载骨架卡死不解(用户反馈 #1 主因)
- **页面**:`/me`(`15-me.png`)
- **现象**:渲染只有灰色骨架(头像占位 + 4 stat 占位 + 5 菜单条占位),2.2s 后骨架不退,真实内容不出。我的测试账号 `/me` API 返回 200 干净,但页面 `dash` state 未 set → `<Loading />` 永持。
- **根因待精确(P3 第一步)**:页面用 `apiGet<Dashboard>` 拉某 dashboard 端点,可能:① 调错端点(404 但不抛?)② setDash 路径有 bug ③ /me/roles 异常吃了 await 链。需 P3 修时打日志精确定位。
- **影响**:所有客户进 /me 全停留在骨架。

### C2. `/me/recharge` "加载中…" 卡死
- **页面**:`/me/recharge`(`23-me-recharge.png`)
- **现象**:积分卡顶 + "加载中…" 文本,5s 后无包列表渲染。
- **根因**:套餐数据拉取未返/未 set。
- **影响**:充值入口废了。

### C3. 客户重登后跳到 `/discover` 而非首页 `/home`(用户反馈 #3)
- **页面**:`/recover` 重登流程
- **代码**:`apps/web/app/recover/page.tsx` 末段 `router.push(data.user.user_type === 'therapist' ? '/t/home' : '/discover')`
- **现象**:客户重登后落到 `/discover`(全列表二级页)而不是 `/home`(发现 tab 首页 / 客户主着陆页)。底部 nav "发现" 也指向 `/home`,所以路由不一致。
- **修法**:`/discover` → `/home`。同时检查 `/register` 完成路由是否一致。

---

## 🟠 High — 显著体验损坏,本轮必修

### H1. `/assistant` 进页空白等问候(用户反馈 #1 加载体验差的具体表现)
- **页面**:`/assistant`(`13-assistant.png`)
- **现象**:首次进页,中间聊天区**完全空白**(顶部欢迎区不显示),只剩底部输入栏 + 快捷 chip。`greetingLoaded` 未 true → welcome hero gated 隐藏。greet 接口慢/未返时,用户看着空白等好几秒。
- **应改**:首次进页**立刻显示欢迎区**(orb + 引导语 + 4 个建议 chip),问候气泡作为追加内容到达后再插入。欢迎区不该被 greet 接口阻塞。

### H2. SSR 阶段渲染裸 loading,造成"白闪 + 跳变"
- **多页通病**:`/order` `/conversations` `/me` 用了 loading.tsx,SPA 内导航时显示骨架,数据回来后跳变到真实内容。骨架闪烁 < 200ms 时反而比无骨架更难受(用户报的 "加载特别长" 在 /me 是真长卡死;在其它页是骨架短闪显得乱)。
- **应改**:① 短于阈值的加载不显示骨架(<200ms 直出);② 骨架形状要跟最终布局对齐(避免 layout shift);③ 数据流式时旧内容保留,新数据切入,不整体闪。

### H3. `/recover` 信任条文字溢出回行(用户反馈 #2 间距类)
- **页面**:`/recover`(`03-recover.png`)
- **现象**:"本地解密  助记词只在此设备校验,服务端永不接触明文" 在窄宽下回行,末尾"文"单独成行,显得断裂。
- **修法**:文案精简(改成"本地解密 · 服务端不留明文"短一行),或调整容器允许两行但有节奏。

### H4. `/me/invites` 上半暖色 + 下半纯白割裂
- **页面**:`/me/invites`(`24-me-invites.png`)
- **现象**:上半 gradient-soft 暖背景区(create new code 三按钮)→ 下半突然变纯白(MY CODES 空态) → 大片留白延伸到导航。两区颜色硬切割,过渡突兀。
- **修法**:统一容器背景,或用渐变过渡;空态卡片化(放进 hero 风的暖色卡)。

### H5. `/discover` 卡片网格大空白
- **页面**:`/discover`(`11-discover.png`)
- **现象**:3 张技师卡占左上,右下大块白屏 + 底部 nav 上方更大留白。3 卡用 2 列网格不平衡(2 + 1 + 大空白)。
- **修法**:列表少时改单列大卡 / 显示 empty-state 引导 / 加"加载更多"占位。

---

## 🟡 Medium — 不影响功能但难看,本轮必修

### M1. `/me/preferences` 顶部 cormorant 副标题灰得几乎看不见
- 页面:`20-me-preferences.png`
- 现象:"YOUR PREFERENCES · 助理会按这个推荐"副标题色淡到看不清,层级丢失。
- 修法:提高副标题对比度或字号。

### M2. `/me/notifications` 仅有"还没有通知"图标 + 文字,无 onboarding 引导
- 页面:`21-me-notifications.png`
- 现象:空态太单薄;没说"哪些事件会通知你",也没"去设置"二级动作。
- 修法:空态加一句辅助文 + 跳到通知设置的二级按钮。

### M3. `/me/privacy` PIN 设置卡视觉权重不均
- 页面:`22-me-privacy.png`
- 现象:三张设置卡(总开关 / PIN 密码 / 自动锁屏 / 通知模糊化)间距、内边距、border 视觉权重不一致;PIN 卡"未设置"+ 按钮太朴素。
- 修法:统一卡片样式 + 状态指示(已设置/未设置)清晰化。

### M4. `/conversations` 顶部搜索框与 tab 行距挤
- 页面:`12-conversations.png`
- 现象:搜索框直接顶顶部,与下面 tab(全部/有新消息)间距偏紧。
- 修法:搜索框区加更大 top padding(对齐 8/16/24 间距系统)。

### M5. `/order` 顶部 tab 与空态间距太大
- 页面:`14-order.png`
- 现象:tab(进行中/历史/全部)与"当前没有进行中订单"icon 间距太大,中部一大块空。
- 修法:垂直居中空态,或加紧间距。

### M6. 全站底部导航中央"助理"按钮在不同页 size/位置漂移
- 多页对比:`10-home.png`(orb 显眼) vs `12-conversations.png`(orb 小不起眼) vs `15-me.png`(orb 又小又灰)
- 修法:统一 CustomerTabBar 中央按钮样式(尺寸 / 阴影 / 高度抬升一致)。

### M7. `/register` 步骤卡之间间距与色阶过软,信息层次塌
- 页面:`02-register.png`
- 现象:3 张步骤卡(WELCOME / TELL ME ABOUT YOURSELF / CREATE CODE)颜色都偏淡,无激活态视觉强调;invite code 输入区被挤到屏幕中下,大量上方留白。
- 修法:激活步骤强调 + 输入框上移 / 步骤紧凑。

---

## 🔵 Low / Cosmetic — backlog

| ID | 页面 | 问题 |
|---|---|---|
| L1 | `/home`(10) | "为你心选" 标题 cormorant 副标题"PICKED FOR YOU · 65 +"语义不清,数字 65+ 含义模糊 |
| L2 | `/register`(02) | 顶部"注册引导"返回箭头 + "SMART ONBOARDING" 双重标题信息重 |
| L3 | `/landing`(01) | 主视图过滤为深色,与品牌暖粉调反差大;沉浸有余但和系统色冲突 |
| L4 | 多页 | gradient-soft 与白背景的过渡有时直接硬切(M1/H4 派生) |
| Cos1 | `/home` | tab 高亮的红色下划线偏粗 |
| Cos2 | 多页 | shadow 层级不一(warm-xs/sm/md 用法混乱) |
| Cos3 | 全站 | scroll 隐藏 vs 显示策略不统一 |

---

## 用户报告 3 bug 的对应

| 用户语 | 审计编号 |
|---|---|
| ① 二级页加载骨架闪烁、加载长 | **C1**(/me 卡死) + **C2**(/me/recharge 卡死) + **H1**(/assistant 空白) + **H2**(SSR 白闪) |
| ② 二级页间距/对称难看 | **H3 H4 M1-M7 + L4 Cos2** 多处 |
| ③ 客户重登跳到二级页 | **C3** |

---

## P2 准备:8 类规范要覆盖什么(以审计为输入)

| 规范类 | 由哪些 bug 倒推 |
|---|---|
| 间距 | M3 M4 M5 M7 H4(全站需 4/8/12/16/24 节奏 + 与 mobile-container 边距统一) |
| Typography | M1 L1 L2(副标题对比度;cormorant 字号下限) |
| 色 | H4 L3 L4 Cos2(gradient-soft → 白过渡;深色与品牌色冲突;shadow 层级) |
| 加载 | **C1 C2 H1 H2**(< 200ms 不显骨架 / 骨架与最终对齐 / "非阻塞渲染" 原则:UI 骨架 immediate,数据 stream-in) |
| 错误 | (隐性)未观察到原始错误外露,但需立规则:catch 后映射友好文 |
| 路由&登录 | **C3**(客户重登/注册完成 → `/home`;技师 → `/t/home`) |
| 动效时长 | M6(导航中央按钮尺寸 / hover 一致) + 通用 transition 时长 200-300ms |
| 空态 | M2 M5 H5(空态 ≠ 单图标 + 一句话;给次级动作 + 引导文) |

---

## P3 修复批次切分(供并行 agent 分头领)

| 簇 | 包含 | 复杂度 |
|---|---|---|
| **批 1 · 路由 & 加载阻塞** | C1 C2 C3 H1 | 中(需诊断 dashboard 端点 + 重构假阻塞渲染) |
| **批 2 · 全局视觉对齐** | H4 H5 M1 M2 M3 M6 + Cos2 | 中(改 ui.tsx + 多页样式) |
| **批 3 · 二级页文案与间距** | H3 M4 M5 M7 | 低(纯样式 + 文案) |
| **批 4 · 加载骨架去闪策略** | H2 | 中(改 loading.tsx 或引入 200ms 延迟模式) |

每批一个 agent,各持 `INTERACTION-STANDARDS.md` 当尺子,改完报 diff,主 agent 汇合 → 一次推 main。

---

**P1 完。下一步:写 P2 `INTERACTION-STANDARDS.md`。**
