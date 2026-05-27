# 前端完成度追踪表

> 生成于 2026-05-27 · 基于代码静态调研(三路并行盘点:原型映射 / 前后端对接 / 测试现状)
> 用途:前端验收与排期的单一地图。每完成一项更新对应格子。

## 定位(重要)

- `v1/prototypes/*.html`(39 个) = **高保真设计真相源**,只读冻结为 v1 视觉基准,不连后端、不维护逻辑。
- `code/apps/web`(30 路由) = **唯一可运行/可部署前端**,负责还原原型 + 对接后端。
- "以高保真为准" = Next 与原型冲突时,**改 Next 去贴原型**;原型不再随业务逻辑改。

## 一个页面"完成"的四层标准

设计对齐 ✓ + 功能实现 ✓ + 后端闭环 ✓ + 边界态处理 ✓ + 测试通过 ✓。
四层各自独立,不可混为一谈。

## 图例

| 符号 | 含义 |
|---|---|
| ✅ | 完成 / 已闭环 / 有兜底 |
| 🟡 | 部分完成 / 占位 / 待核实 |
| 🔴 | 缺失 / 有 bug / 会白屏 |
| ➖ | 无需 |
| ▣ / ▢ | 有 / 无 原型基准 |

> **视觉对齐列**:本表尚未做像素级截图比对(那是下一步用 browse 批量截图 vs 原型),除代码注释明确 "1:1 port" 外,统一记为"待比对"。

---

## 客户端路由(19)

| 路由 | 原型基准 | 实现 | 后端对接 | 健壮性(边界态) | 测试 | 关键缺口 / 备注 |
|---|---|---|---|---|---|---|
| `/` | ▣ splash/login | ✅ | 🟡 重定向逻辑 | 🟡 待核实 | 🔴 | 启动/路由分发 |
| `/home` | ▣ index.html | ✅ | ✅ /therapists | ✅ 有 catch | 🔴 | **混 `PROTO_FALLBACK` 假技师数据**,生产需删 |
| `/discover` | ▢(疑似 therapists-all) | ✅ | ✅ | ✅ | 🔴 | 与 `/home` 功能重叠,需确认分工 |
| `/conversations` | ▣ messages.html | ✅ | ✅ | 🔴 **无 try/catch → 永久 loading** | 🔴 | nav 已修;健壮性待修 |
| `/conversations/[id]` | ▣ messages-chat | ✅ | ✅ | ✅ | 🔴 | E2E 加密消息 |
| `/assistant` | ▣ ai-assistant | ✅ | ✅ greet/chat/recommend | ✅ | 🔴 | recompute/behavior 未接(推荐质量) |
| `/order` | ▣ bookings.html | ✅ | ✅ | ✅ | 🔴 | nav 已修 |
| `/order/[id]` | ▣ price-lock | ✅ | 🟡 act 动作 | ✅ | 🔴 | pay/dispute/resolve 是否全接**待核实** |
| `/order/[id]/chain` | ▢ | ✅ | ✅ | 🔴 **Promise.all 无 catch → 永久 loading** | 🔴 | 凭证链;健壮性待修 |
| `/therapist/[id]` | ▣ therapist-profile | ✅ | ✅ | ✅ | 🔴 | **`FALLBACK_GALLERY` 假相册**,生产需删 |
| `/therapist/[id]/order` | ▢ | ✅ | ✅ /orders | ✅ | 🔴 | 下单 CTA nav 已修(原 pb-32) |
| `/me` | ▣ profile-me | ✅ | ✅ dashboard | ✅ | 🔴 | |
| `/me/preferences` | ▣ my-preferences | ✅ | 🟡 待核实 | ✅ | 🔴 | |
| `/me/privacy` | ▣ privacy-setup | ✅ | ✅ /privacy | ✅ | 🔴 | |
| `/me/notifications` | ▣ notifications | ✅ | ✅ | 🔴 **无 catch → 永久 loading** | 🔴 | 健壮性待修 |
| `/me/invites` | ▢ | ✅ | ✅ 有 catch | ✅ | 🔴 | 邀请/分销,无原型 |
| `/register` | ▣ register-customer | ✅ | ✅ /auth/register | 🟡 待核实 | 🔴 | 示例邀请码写死 |
| `/register/backup` | ▢ | ✅ | 🟡 待核实 | 🟡 | 🔴 | 助记词备份,无原型 |
| `/recover` | ▢ | ✅ | ✅ /auth/recover | 🟡 | 🔴 | 钱包恢复=登录(register 建号 / recover 登录 / refresh 续期),无 `/auth/login` 系设计如此 |

## 技师端路由(10)

| 路由 | 原型基准 | 实现 | 后端对接 | 健壮性 | 测试 | 关键缺口 / 备注 |
|---|---|---|---|---|---|---|
| `/t/home` | ▣ technician-home | ✅ | ✅ | ✅ 有 catch | 🔴 | 派单区为占位,待接 dispatch_offers |
| `/t/orders` | ▣ technician-orders | ✅ | ✅ | ✅ | 🔴 | nav 已修 |
| `/t/orders/[id]` | ▢ | ✅ | ✅ | ✅ | 🔴 | |
| `/t/pending` | ▣ technician-pending | 🟡 占位 | 🔴 /me/offers **无 catch + 8s 轮询** | 🔴 | 🔴 | 派单中:占位+健壮性最差,失败每 8s 抛异常 |
| `/t/messages` | ▣ technician-messages | ✅ | ✅ | 🔴 **无 try/catch → 永久 loading** | 🔴 | 健壮性待修 |
| `/t/messages/[id]` | ▣ technician-messages-chat | ✅ | ✅ | ✅ | 🔴 | |
| `/t/me` | ▣ technician-me | ✅ | ✅ | ✅ | 🔴 | |
| `/t/me/profile` | ▣ technician-profile | ✅ | ✅ /therapists/me | ✅ | 🔴 | |
| `/t/me/ai-alter` | ▣ technician-voice-clone | ✅ | ✅ ai-alter/configure | ✅ | 🔴 | |
| `/t/me/earnings` | ▢(home 衍生) | ✅ | ✅ /withdrawals | ✅ | 🔴 | 收益与提现 |

---

## 待实现清单(有原型,无 Next 实现 · 11)

| 原型 | 端 | 功能 | 优先级 |
|---|---|---|---|
| technician-pricing.html | 技师 | 定价管理列表 | **P0** |
| technician-pricing-new.html | 技师 | 定价新建 | **P0** |
| technician-schedule.html | 技师 | 档期管理 | **P0**(后端亦无 schedule API,需先补后端) |
| technician-service-area.html | 技师 | 服务区域 | **P0** |
| technician-verify.html | 技师 | 真人核验 | **P0**(/t/me 已有入口链接,但无页面) |
| technician-media-library.html | 技师 | 媒体库 | P1 |
| bookings-calendar.html | 客户 | 约会日历视图 | P1 |
| booking-extend.html | 客户 | 加钟申请 | P1 |
| calculator.html | 客户 | 定价计算器 | P1 |
| relation-profile.html | 客户 | 关系档案/私人笔记 | P1 |
| language.html | 客户 | 语言选择 | P2(可能并入设置) |

## 业务闭环缺口(后端已就绪,前端未接 · 按业务流程)

| 流程 | 状态 | 缺口 |
|---|---|---|
| ⑤ 支付/积分/钱包 | 🔴 **严重不闭环** | 充值 `/payments/recharge`、商城 `/shop/*`、解锁 `/therapists/:id/unlock`、小费 `/tips` 前端**全部未调用**。用户花不了钱。 |
| ① 登录 | ✅ 已澄清 | web3 钱包模式:register=建号、recover=助记词登录、refresh=自动续期。无 `/auth/login` 系设计如此,非 bug。仅需确认引导页有清晰"恢复账户"入口。 |
| ⑥ 技师日程 | 🔴 后端缺 | 无 schedule 相关 API,技师"档期"功能后端缺失。 |
| ④ 客户主动派单 | 🟡 | `/orders/:id/dispatch` 未接(当前是定向下单)。 |
| ⑦ 小费/评价申诉 | 🟡 | `/tips`、`/reviews/:id/appeal`、`/reviews/therapist/:id` 未接。 |
| ⑧ 推荐质量 | 🟡 | `/assistant/recompute`、`/me/blocks`、`/me/behavior` 未接。 |
| 后台 admin / 工单 | ➖ | 整套 `/admin/*`、`/tickets` 无前端(admin 是独立 app,另算)。 |

---

## P0 必修清单(止血,优先级最高)

1. ✅ **已修** — 6 个页面 API 失败永久 loading(白屏):`conversations`、`t/messages`、`order/[id]/chain`、`me/notifications`、`t/pending`(commit 27932a0)+ `me`(空 catch,本地 QA 抓到,commit aa9dc67)。
2. ⬜ **支付/积分/钱包前端入口** — 接通充值/商城/解锁/小费(后端已就绪)。
3. ✅ **已澄清** — 登录是 web3 钱包模式(register/recover/refresh),非 bug。
4. ✅ **已修(2 轮)** — commit a9a2003 删了 home 假技师卡 + 技师详情 `FALLBACK_GALLERY`,但**残留** `PROTO_FALLBACK` 常量 + 头像无图时仍兜底假 proto 图(2026-05-27 审计抓到)。第二轮(见下)已彻底删除常量,无图改渐变首字占位。

## 本地全栈 QA 结论(2026-05-27 · 真实后端实测)

环境:pg(54399)+ redis + api(8787)+ web(4321),注册客户/技师账户走真实数据。

- ✅ **后端对接闭环通**:`/conversations`、`/therapists`、`/dashboard/customer/me`、`/me` 全部 HTTP 200;CORS preflight(OPTIONS)204 正常。
- ✅ **注册/登录闭环**:register 生成助记词 + JWT,refresh 自动续期。
- ✅ **nav 修复真实态确认**:私聊/预约/我的 在真实数据下 nav 距底 0px 贴底。
- ✅ **me 真实渲染**:积分卡/订单/收藏/菜单正常。
- ⚠️ access token TTL 1h,过期靠 refresh 续期;me 之前空 catch 吞了 401 才永久 loading(已修)。
- 🔴 home 假数据问题已实证(见上 P0-4)。

## 测试现状(全前端 🔴)

- `apps/web` / `apps/admin` **零测试**(声明 vitest 但无配置无用例)。
- 无 Playwright E2E,无视觉回归,无"对齐原型"的自动校验。
- 后端测试较好(11 文件 1684 行,单元 + e2e)。
- CI:typecheck 强制、后端测试强制、web build 验证;但 lint `continue-on-error`、前端无 test、无覆盖率门禁、无分支保护。

## 下一步检验动作(把🟡/待核实变确定)

1. **视觉对齐**:用 browse 对每个已实现路由截图,与对应原型 HTML 并排比对,填"视觉对齐"列。
2. **对接闭环**:本地起 api + postgres,用 `/qa` 端到端实测每个核心流程,核实🟡格子(尤其 ⑤ 支付链路、订单动作)。
3. **边界态**:每页测空/加载/错误/断网,确认不白屏(当前 5 页会白屏)。

---

## 2026-05-27 第二轮 · 三路并行审计 + 7 个 P0 修复(带浏览器证据)

三路并行审计(运行时健壮性 / 接口契约 / 技术债)发现并修复 7 个 P0,均经本地全栈(pg 54399 + api 8787 + web 4321)+ `/browse` 移动端截图验证:

| # | 文件 | bug | 修法 | 证据 |
|---|---|---|---|---|
| 1 | `home/page.tsx` | **信封双重解包**:`apiGet` 已解 `{data}` 返回数组,前端又读 `res.data`(恒 undefined)→ 首页技师列表恒空 | 改 `apiGet<ApiTherapist[]>` 直用数组 | HTTP:`/therapists` 返回 `data:[]`+meta;截图:首页渲染真实「测试技师2」 |
| 2 | `home/page.tsx` | `PROTO_FALLBACK` 常量未删 + 无头像兜底假 proto 图(P0-4 残留) | 删常量,无图改 `bg-gradient-cta`+首字占位 | 截图:首页无薇薇/娜娜,头像处渐变「测」非假人像 |
| 3 | `discover/page.tsx` | `top_n:30` 超后端 `RecommendQuery max(20)` → 发现页 400 | 30→20 | HTTP:30→400 / 20→200;截图:discover「TOTAL 1」正常 |
| 4 | `t/home/page.tsx` | dashboard 调用在 try 外 → API 失败技师首屏永久白屏 | 包 try/catch,失败 setData(EMPTY_DASHBOARD) | 截图:渲染 $0.00 空骨架不白屏 |
| 5 | `t/me/earnings/page.tsx` | `Promise.all` 首调用无 catch → 收益页白屏 | 首调用补 `.catch(()=>({earnings:null}))` | 截图:渲染「收益与提现」 |
| 6 | `me/privacy/page.tsx` | catch 不 setState + ErrorBanner 藏 loading 分支后 → 白屏且错误不可见 | catch 必 setError;loading 守卫 `error?ErrorBanner:LoadingFull` | 截图:渲染隐私开关 |
| 7 | `register/page.tsx` | placeholder 硬编码真实种子码 `ADMIN-SEED-CUSTOMER-001` | 改「输入 4-8 位邀请码」 | 截图:placeholder 无种子码 |

> 验证级别:`pnpm --filter @loverush/web typecheck` 通过 + HTTP 契约实测 + 6 张移动端截图。
> 注:第 1 项更正了「本地 QA 结论」里 home 假数据的判断——真正根因是信封解包 bug(假数据删后列表恒空),非仅假数据。
> 注:lint 跑不了(环境缺 `typescript-eslint` 包,与改动无关,需 `pnpm install`)。

### 仍未做(本轮不碰)
- **P0-2 支付/积分/钱包前端入口**(充值/解锁/橱窗/小费)仍是最大业务闭环缺口,后端已就绪,前端零调用。
- P1:`t/me/profile`/`t/orders/[id]` 同类白屏、4 页 `serviceSnapshot` 空值解引用、**订单状态 `STATUS_TEXT` 4 份漂移副本(会坑支付)**、提现明细明文传输、conversations 轮询重复解密。
- P2:零测试(`test` 脚本无 config = 空炮)、共享组件空壳 + 三套导航重复、165 处硬编码色、无路由常量表、死链 `/me/orders`·`/me/recharge`·`/t/me/verify`。
