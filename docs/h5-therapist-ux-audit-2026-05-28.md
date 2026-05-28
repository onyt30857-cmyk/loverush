# H5 技师端 UX 审计 · 2026-05-28

**范围**:`/t/*` 全部页面,以 `INTERACTION-STANDARDS.md` v1.0 为尺子
**方法**:Playwright 受控 Chromium,820×960,真实技师测试账号(完事即删)
**截图**:`/tmp/audit-2026-05-28/shots-t/`

## 严重度统计

| 级 | 数 |
|---|---|
| **C / Critical** | 2 |
| **H / High** | 1 |
| **M / Medium** | 3 |

---

## 🔴 Critical

### C1.T · /t/home LOADING orb 卡死(同客户 C1 模式)
- **页面**:`/t/home`(`t-01-home.png`)
- **现象**:加载 orb + "LOADING" 文字常驻,真实 dashboard 内容(在线状态/收入卡/快捷动作/30 天收入图等)始终不出
- **根因**:很可能与客户 C1 相同——`if (!data) return <Loading />` 整页阻塞;dashboard 接口慢或返空时 data 没被 set
- **修法**:对照 §4 加载规范,改渐进渲染——头像/欢迎/快捷动作立显,stat/收入未到用占位

### C2.T · /t/me/verify 404 broken link
- **页面**:`/t/me/verify`(`t-13-me-verify.png` · "This page could not be found")
- **现象**:`/t/me` 菜单里"真人核验"链接到 `/t/me/verify`,但该页根本不存在 → 404
- **修法**(任选):
  - A) 创建占位 `app/t/me/verify/page.tsx`,显示"核验流程即将开放,先完善档案"
  - B) 暂时从 `/t/me` 菜单移除该入口(留待运营上线再加)
  - **决策**:走 B(运营未开放就别引导),把 `verify` 菜单项暂时隐藏或显示"敬请期待"灰态

---

## 🟠 High

### H1.T · /t/messages 空态违反 §8 四件套 + 色硬切
- **页面**:`/t/messages`(`t-03-messages.png`)
- **现象**:① 空态只有 icon "💬" + "还没有会话",**无辅助文 / 无动作**(死巷,违反 §8);② 顶部上半暖渐变,下半粗暴接纯白,色调割裂(同 H4 模式)
- **修法**:
  - 加四件套:icon + "还没有会话" + 辅助文("客户咨询会出现在这里") + 次级动作(如"完善档案 →"跳 /t/me/profile 提示客户挑你的概率)
  - 容器统一用 `bg-gradient-soft` 整页或卡片化空态

---

## 🟡 Medium

### M1.T · /t/me/profile 底部 gradient/白硬切
- **页面**:`/t/me/profile`(`t-10-me-profile.png`)
- **现象**:档案表单很长,最下方"风格 & 边界"区暖渐变忽然接纯白,与 H4 同 pattern
- **修法**:整页 `bg-gradient-soft`,或表单分段卡片化

### M2.T · /t/me/earnings 提现记录空态太单薄
- **页面**:`/t/me/earnings`(`t-11-me-earnings.png`)
- **现象**:提现记录区只有钱袋 icon + "还没有提现记录"(无辅助文,无动作)
- **修法**:补 §8 四件套(辅助文"提现申请会显示在这里" + 跳到说明文档的链接)

### M3.T · /t/pending 顶部排版乱
- **页面**:`/t/pending`(`t-05-pending.png`)
- **现象**:顶部 cormorant "INCOMING OFFERS · 派单池"把中英文混在一行,英文+中文紧贴显得挤
- **修法**:中文标题主一行(`text-serif-cn`)+ Cormorant 英文副标另一行(label-cormorant),与 §2 Typography 阶梯对齐

---

## 用户报告对应

无新用户报告,本轮全部为 audit 自查发现。

## P3.T 修复建议批次

1 个 agent 即可包圆(6 处,scope 清晰):
- 主修:t/home(C1.T)+ t/me 移除 verify 菜单(C2.T)
- 视觉:t/messages(H1.T)+ t/me/profile(M1.T)+ t/me/earnings(M2.T)+ t/pending(M3.T)
