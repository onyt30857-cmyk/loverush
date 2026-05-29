# 技师 Admin 治理后台 · 规划 PRD v1

> 起草日:2026-05-29
> 范围:apps/admin 内技师管理面板扩展
> 视角:运营 + 内容合规 + 客服取证
> 状态:草案 · 待评审

---

## §0 现状盘点

### 后端数据(超出预期完整)

| 维度 | 状态 |
|---|---|
| 技师相关表 | 21 张(主表 + 关联表) |
| 总字段数 | 280+ |
| 可见性体系 | 3 档(`public` / `paid_unlock` / `platform_only`)已落地 |
| 媒体存储 | Cloudflare R2 + 审核队列已就绪 |
| 加密字段 | `socialContactsEncrypted` / `serviceAddressFullEncrypted` / `livenessVideoUrl`(永久加密) |

### Admin 现有覆盖度 ~70%

| 现有页面 | 能力 |
|---|---|
| `/users/therapists` | 列表 · 筛选 · 8 字段 + 积分 + activated_at toggle |
| `/users/therapists/[id]` | 7 tab:档案 / 订单 / 流水 / 评价 / 工单 / 收益+提现 / 风控 |
| `/verifications` | 真人核验队列 + liveness 视频预览 + 裁决 |
| `/withdrawals` | 提现审批全闭环 |
| `/ai/redline` | 红线 + 屡犯技师 Top 10 |
| `/ai/messages` | AI 代发审计 |

### 用户痛点对应缺口

| 用户提的 | 现状 | 缺口 |
|---|---|---|
| "声音、照片、视频" | 仅 `/verifications` 看 liveness | ❌ **无媒体库**,头像/相册/语音/短视频都看不到 |
| "公开、不公开" | 数据有 `visibility` 三档,UI 没展示 | ❌ 三档标签未可视化 |
| "个人联系方式、地址" | 加密存 DB,有解密能力 | ❌ admin 没有解密查看入口 |
| "对应信息可查看" | 仅显示 8 字段 | ❌ 实际 47 字段,缺 39 个 |

---

## §1 新增 4 个 tab(分 P0 / P1)

### 🅰️ Tab T1 · 媒体库(P0)

**位置**:技师详情页 tab 'media'

**数据源**:`media_assets WHERE owner_user_id = therapist.userId AND deletedAt IS NULL`

**功能**:
- 3 大分类卡片
  - 🌐 **公开素材**(`visibility=public`):头像 / 短视频 / 公开相册图 / 语音介绍
  - 🔓 **付费解锁**(`visibility=paid_unlock`):带价格标签 + 已被解锁次数
  - 🔒 **平台仅用**(`visibility=platform_only`):liveness 视频(高权角色才显示播放器)

- 每条媒体卡片显示:
  - 缩略图(可点开大图/启动视频/音频播放器)
  - 类型(photo / video / audio)
  - purpose(avatar / gallery / voice_intro / short_video / liveness / chat_attachment)
  - 文件大小 + 时长(音视频)
  - 上传时间
  - 审核状态(pending / approved / rejected)+ 颜色标签
  - 水印状态(已加 / 未加)
  - r2Key(只对 admin 可见,调试用)

- 操作按钮(根据审核状态分):
  - `pending` 状态:✓ 通过 / ✗ 拒绝(填原因)
  - `approved` 状态:🗑 软删除
  - `rejected` 状态:↻ 复审

**权限**:
- `admin` / `auditor`:看全部 + 操作
- `cs`:看公开 + 付费(不操作)
- `ops`:只看 metadata,不看缩略图

### 🅱️ Tab T2 · 隐私字段解密(P0)

**位置**:技师详情页 tab 'private-info'

**数据源**:therapists 加密字段

**功能**:
- 默认状态:全部隐藏,显示"⚠ 解密查看"按钮
- 点击 → 后端调 decrypt service,写 audit log(谁、何时、看了哪条)
- 解密后显示 30 秒,然后自动重新隐藏(或手动关闭)

显示字段:
- **社交账号**(`socialContactsEncrypted` 解密):
  - 微信 / Line / WhatsApp / Telegram / 其他
- **精确地址**(`serviceAddressFullEncrypted` 解密):
  - 完整门牌号 + 楼层 + 房号
- **身体数据**(明文但 platform_only):
  - 身高 / 体重 / 胸围 / 腰围 / 体脂率 / 教育背景

**审计行为**:
- 每次解密生成 `admin_audit_log` 一条:
  - `action='therapist.private_decrypt'`
  - `targetId=therapist.userId`
  - `metadata={fields:['social','address'], decryptedAt:NOW()}`

**权限**:
- `admin`:全字段可解密
- `cs`:仅 social 可解密(地址不行)
- 其他角色:看不到 tab

### 🅲 Tab T3 · 完整档案(P1)

**位置**:技师详情页 tab 'full-profile'

**数据源**:therapists 表完整字段

**功能**:
- 现有 ProfileTab 只显 8 字段(verification / score / online / 等),加新 tab 显示完整 47 字段
- 按 12 个分组组织(身份 / 媒体 URL / 地址 / 身体 / KYC / 服务能力 / 在线 / 评分 / 统计 / 档案完整度 / AI 分身 / 时间戳)
- JSON 字段(skills / preferences / basePrice / aiAlterPersonality)用 collapsible JSON viewer 展开
- 多语种 bio 用 Tab 切换不同 locale

**Inline 编辑**(可选 P2):
- admin 可直接改字段(audit log 记录 before/after)
- 现有架构后端**缺 admin 编辑 endpoint**,要新加

### 🅳 Tab T4 · AI 风控聚合(P1)

**位置**:技师详情页 tab 'ai-risk'

**数据源**:
- `ai_alter_redline_logs WHERE therapistUserId`
- `ai_alter_messages WHERE therapistUserId`

**功能**:
- 上半部分:**该技师所有红线触发**(按时间倒序,分页)
  - flag / action / stage / 原始文本 / 改写文本 / 置信度
  - 跳"全量红线监控"
- 下半部分:**该技师所有 AI 代发**(按时间倒序,分页)
  - scenario / provider / model / tokens / cost / simhash
  - 跳"全量代发审计"
- 聚合统计卡:30 天红线触发次数 / 总代发 / 总 token 成本

---

## §2 优先级实施次序

### 批次 1 · 立即(P0)

```
T1 媒体库 ← 用户最核心痛点(声音/照片/视频)
T2 隐私字段解密 ← 用户明确要求(联系方式/地址)
```

### 批次 2 · 次轮(P1)

```
T3 完整档案
T4 AI 风控聚合
```

### 批次 3 · 后续可做

- T5 技师审计日志聚合(`admin_audit_log WHERE targetId`)
- T6 技师屏蔽视图(技师屏蔽了谁 + 谁屏蔽了技师)
- T7 技师 inline 编辑(admin 改技师档案 + audit)

---

## §3 后端要补什么

| 模块 | 新 API | 后端改造 |
|---|---|---|
| T1 媒体库 | `GET /admin/users/:id/media`(分页 + 筛选 visibility / purpose) | 复用现有 `media_assets` 查询 |
| T1 媒体审核 | 复用 `POST /admin/audit/:id/approve` 和 `/reject` | 无需新加 |
| T2 隐私解密 | `POST /admin/users/:id/decrypt-private`(scope: 'social' \| 'address' \| 'body') | 复用现有 decrypt service + 加 audit |
| T3 完整档案 | 现有 `GET /admin/users/:id` 已返大部分,补缺字段 | 改返回数据形状 |
| T4 AI 聚合 | 现有 `/admin/ai/redline/logs` + `/admin/ai/messages` 加 `?therapist_user_id=X` 参数 | 加 SQL 条件 |

---

## §4 UI/UX 范式

- 复用 `AdminShell` + 现有 tab 切换组件
- 媒体库 grid 布局(`grid-cols-3 md:grid-cols-4 lg:grid-cols-5`)
- 缩略图统一 200×200,点开大图用 modal lightbox
- 视频/音频用 HTML5 `<video>` / `<audio>` + controls
- 解密字段用 monospace + 黄色背景框(明显)
- 30 秒倒计时显示 + 按钮"再延 30s"
- 操作按钮颜色对齐已有:绿通过 / 红拒绝 / 灰删除

---

## §5 关键风险

| 风险 | 等级 | 对策 |
|---|---|---|
| **liveness 视频 admin 误看泄露** | 高 | 仅 `admin` + `auditor` 角色可见 · 每次访问写 audit · 添加水印(admin id) |
| **解密 service 失败** | 中 | 显友好错误 + retry 按钮 · 不缓存解密结果 |
| **R2 签名 URL 过期** | 中 | 短期 URL(5min)· 过期自动刷新 |
| **大文件预览卡顿** | 低 | thumbnail 优先 · 原图懒加载 |
| **审计日志过载** | 低 | 解密操作单独表分流(可选) |

---

## §6 验收口径

每个 tab 上线时验:

1. **数据正确性** · admin 看到的跟 DB 直查一致
2. **权限隔离** · ops 看不到内容 / cs 不能解密地址 / 等
3. **审计完整** · 每次解密 / 操作都有 audit_log
4. **真机视口** · 1280 / 1440 / 1920 三个分辨率主流程跑通
5. **媒体加载** · 缩略图 < 500ms · 原图 < 2s

---

## §7 待办 / 未决

- [ ] 解密后显示时长(30s 自动隐藏 vs 手动关闭?)
- [ ] 媒体软删除后是否进 "🗑 回收站" tab 还是真删?
- [ ] T7 inline 编辑是否需要"修改前预览 + 确认"二次步骤?
- [ ] liveness 视频的 watermark 是否需要每次播放重生成(防截屏)?

---

## 附录 A · 事实底座

**技师相关 21 张表**(部分):

| 表名 | 路径 | 字段数 | 关键字段 |
|---|---|---|---|
| `therapists` | schema/therapists.ts | 47 | bio, gallery, score, cooling, address(enc), social(enc) |
| `media_assets` | schema/media.ts | 18 | r2Key, type, visibility, purpose, auditStatus, watermarkApplied |
| `therapist_earnings` | schema/tips.ts | 7 | availableCents, pendingCents, withdrawnCents |
| `withdrawals` | schema/tips.ts | 11 | amountCents, method, status, payoutDetails(enc) |
| `ai_alter_messages` | schema/ai_alter.ts | 13 | scenario, model, tokens, cost, simhash |
| `ai_alter_redline_logs` | schema/ai_alter.ts | 8 | flag, stage, action, confidence |
| `risk_events` | schema/risk.ts | 8 | subjectUserId, eventType, severity, resolution |
| 其他 | ... | ... | ... |

**Admin 现有路由**:
- `/users/therapists` + `[id]`(7 tab)
- `/verifications`(KYC)
- `/withdrawals`(提现审批)
- `/ai/redline`(红线监控)
- `/ai/messages`(代发审计)

---

> 起草:Claude(技师 admin 治理视角)
> 待评审:运营 / 风控 / 客服 / 合规 4 方
