# 管理后台 RBAC · 角色创建 + 菜单项级权限配置 设计

> 2026-06-10 · 状态:设计待评审 · 角色中文名 + 自定义角色 + 每角色配权限 + 不同角色看到/能用不同功能

## 1. 背景与现状

**现状(代码实证)**:
- 6 个**固定角色**(admin/auditor/finance/cs/ops/agent),存在 `user_roles` 表(role 是 text 字段,留了扩展空间),**无角色目录表、无自定义角色**。
- 权限**全硬编码**:`requireRole(['admin','cs'])` 散在 **35 文件、735 处调用**(`middleware/role.ts`)。改权限=改代码。
- 导航(AdminShell)**不按角色过滤**,所有角色看到全部 11 组菜单,点进去后端才 403(体验差)。
- 角色名**纯英文**(中文只在 `schema/roles.ts` 注释)。

**目标**:① 角色中文名 ② admin 能创建自定义角色 ③ 每角色配「能用哪些菜单/功能」④ 不同角色登录后看到+能用不同功能,且**后端真生效**(不是只过滤导航)。

**关键决策(Tony 拍板)**:权限粒度 = **菜单项级**(~50 项);后端 = **中心化网关一步到位**(不逐个改 735 处)。

## 2. 核心设计

### 2.1 权限目录(菜单项级,静态 catalog)
权限单位 = **每个菜单项**(~50,对应 AdminShell 的 NAV_GROUPS 各 item)。集中定义一份 catalog(共享代码),每个权限含:
```
{ key, label中文, group(所属菜单组), navHref(前端页), apiPrefixes[](后端网关用) }
```
- `label` 复用现成菜单中文名(订单/提现审核/技师管控…),零额外翻译。
- `apiPrefixes` 声明该权限对应的后端路径前缀(如「订单」→ `/admin/orders`),给网关用。一个权限可对多个前缀;一个前缀只属一个权限。
- catalog 是单一事实源:前端导航过滤 + 后端网关 + 权限矩阵 UI 都读它。

### 2.2 数据模型(3 张表,迁移)
- **`roles`(角色目录,新表)**:`key`(唯一,如 admin / 自定义 cs_lead)、`name_zh`、`description`、`is_system`(bool,6 个老角色=true 不可删)、`created_by`、时间戳。
- **`role_permissions`(角色-权限映射,新表)**:`role_key` × `permission_key`。
- **`user_roles`(用户-角色,现有表不动)**:用户↔角色分配。

**种子**:6 系统角色种进 `roles`(带中文名);各自权限按现有 requireRole 行为反推种进 `role_permissions`(见 §5 矩阵)→ **上线即与现状零行为差**,但从此表驱动可配。

### 2.3 后端权限执行(中心化网关,不动 735 处)
- **权限解析** `resolveUserPermissions(userId)`:查用户活跃角色 → 并集其 role_permissions → 权限 key 集合。**admin/超管 → 全部权限**(恒全权,不可锁死,防自锁)。
- **全局网关中间件**(挂在 admin 路由总入口):每个 `/admin/*` 请求 → 按 path 匹配 catalog 的 `apiPrefixes` 找到所需权限 → 用户无该权限则 403。匹配不到的路径默认放行(不破坏现有,记 warn 待补映射)。
- **现有 735 处 `requireRole` 全部保留**当防御底层(defense in depth),不删不改。网关是自定义角色生效的新的统一关口;系统角色行为不变(它们权限种得和原 requireRole 一致)。
- 性能:resolveUserPermissions 每请求查一次(角色少、可加请求级缓存),权限集内存比对,~1ms。

### 2.4 前端(导航按权限过滤 + 角色管理页)
- **`GET /admin/my-permissions`** → 当前用户权限 key 集。
- **AdminShell 导航过滤**:按权限隐藏无权菜单项;某组全无权则隐藏整组。admin 看全部。→ "不同角色看到不同功能"。
- **角色管理页重做**(`/roles`):
  - 角色列表(中文名 + 系统/自定义标)+「新建角色」(key/中文名/描述)。
  - 选角色 → **权限矩阵**(11 组 × 各菜单项的勾选树,按组折叠,可全选/反选)→ 保存(`PUT /admin/roles/:key/permissions`)。
  - 用户分配(现有按 user_id 赋/撤,保留;系统角色不可删,自定义角色可删)。
  - 全中文名。

### 2.5 后端接口(新增/改)
- `GET /admin/roles` 列角色目录(中文名/系统标/权限数)
- `POST /admin/roles` 建自定义角色 {key,name_zh,description}
- `PATCH /admin/roles/:key` 改中文名/描述(系统角色只能改名不能改 key)
- `DELETE /admin/roles/:key` 删(仅自定义且无人持有,或先校验)
- `GET /admin/roles/:key/permissions` 取某角色权限
- `PUT /admin/roles/:key/permissions` 设权限矩阵 {permission_keys[]}
- `GET /admin/permissions/catalog` 权限目录(给矩阵 UI)
- `GET /admin/my-permissions` 当前用户权限(给导航)
- 现有赋/撤用户角色接口保留
- 全部 admin 鉴权 + recordAudit(权限/角色变更必留痕)

## 3. 不做(YAGNI)
- 读/写细分(每页只看 vs 可操作)→ P2,本期权限=能否进该菜单/调该模块。
- 数据行级权限(只看自己城市的订单)→ 不做。
- 角色继承/嵌套 → 不做,扁平角色×权限。
- agent 角色不进后台 catalog(它是 C 端代理,独立 /agent/* 路由,不受影响)。

## 4. 角色中文名(系统角色)
admin=超级管理员 · auditor=审核员 · finance=财务 · cs=客服 · ops=运营 · agent=代理(C端,不列后台)。

## 5. 系统角色权限种子(按现有 requireRole 反推,上线零行为差)
- **admin**:全部权限(超管)。
- **auditor**:真人核验/技师资料/用户媒体/对话审查/匹配/系统报错。
- **finance**:资金流水/提现审核/法币字典/汇率维护/平台收款/积分回收/采购仲裁/代理商。
- **cs**:客户/订单/心动金仲裁/技师资料/用户投诉/评价审核/Prompt模板/技师管控。
- **ops**:经营总览/派单监控/群发/AI规则/健康仪表盘/地理全组/搜索全组/灰度开关/服务类型/节目监控/声音复刻/系统报错。
(精确清单实现时对照 §requireRole 矩阵逐条落,种子脚本可重跑。)

## 6. 工程组件答卷
| 题 | 答 |
|---|---|
| 权限来源 | 静态 catalog(菜单项级)+ DB role_permissions(可配) |
| admin 自锁防护 | admin/超管恒全权,网关对其直接放行;删角色/改权限不影响 admin |
| 未映射路径 | 网关默认放行 + warn(渐进补映射,不破坏现有) |
| 现有 requireRole | 全保留作防御底层,不删 |
| 缓存 | resolveUserPermissions 可加请求级 memo |
| 迁移 | roles/role_permissions 两新表 + 种子,先生产跑再 push |
| 审计 | 角色 CRUD + 权限变更 + 用户赋撤 全 recordAudit |
| 验证 | e2e:自定义角色配部分权限→网关对无权模块403/有权200;/my-permissions 正确;导航过滤 |
| 风险 | 网关误拦→默认放行未映射+admin 兜底+灰度;系统角色种子务必对齐原行为(回归测试) |

## 7. 实现顺序(分期,每期可独立上线)
- **P0** 角色中文名(catalog + 角色管理页 tab 显示中文)——最快见效,独立可上。
- **P1** 数据层:roles/role_permissions 迁移 + 权限 catalog(代码)+ 系统角色权限种子 + resolveUserPermissions + `/admin/my-permissions`。
- **P2** 导航按权限过滤(前端,自定义角色看到差异化菜单)。
- **P3** 中心化网关中间件 + 路径→权限映射(后端真拦截)+ 系统角色行为回归测试。
- **P4** 角色管理页重做:新建角色 + 权限矩阵 + 用户分配 + 全中文。
- 每期 e2e。P0-P2 见效快、低风险;P3 是后端真生效的关键,需充分回归(种子对齐原 requireRole 行为)。
