# LoveRush · H5 客户端交互 & 视觉规范

> **谁用**:前端 agent / 设计 / QA。新页落地前自检;现有页改造时对照。
> **范围**:`apps/web` 客户端 H5(含 /t/* 技师端但本规范优先指导 customer 侧)。
> **不替代**:`packages/db` schema、`apps/api` 业务逻辑、原生 native shell。

---

## 0. 总原则(不可妥协)

1. **进页即可见**。任何页面进入后 **200ms 内必须有有意义的像素**——不要先白后切骨架再切真实(三段闪)。
2. **加载是局部的,不是全局的**。骨架只在数据未到的局部出现,**顶部 hero / 标题 / 导航 / 输入框**这些不依赖数据的元素先到先显。
3. **品牌 token 不发明**。颜色、字体、阴影、圆角全部走 `globals.css` 已有的 token;临时凭感觉新增一个 `#XYZABC` = 立即不合规。
4. **反 AI slop**。不堆 emoji 当图标、不滥用紫渐变、不"每个标题配 icon"、不给装饰性 stats 数字。
5. **失败要"和谐失败"**。后端 500 / 401 / 网络断,UI 一律映射成中文友好态,**绝不把原始英文错误糊到界面上**。

---

## 1. 间距 Spacing

### 节奏

**Tailwind 节奏值**:`1 2 3 4 5 6 8 10 12 16 20`(= 4 8 12 16 20 24 32 40 48 64 80 px)。**禁止用 7 9 11 13 等不在节奏上的值**(`px-7`、`mt-9`)。

### 容器边距(.mobile-container 内)

| 位置 | 推荐 | Tailwind |
|---|---|---|
| 主区水平 padding | 16px / 20px(标准/宽松) | `px-4` / `px-5` |
| 顶部安全留白(无 header) | 20px | `pt-5` |
| 区块之间垂直 gap | 16px(紧)/ 24px(标准)/ 32px(章节) | `mt-4` / `mt-6` / `mt-8` |
| 卡片内边距 | 12px / 16px | `p-3` / `p-4` |
| 列表项之间 | 8px | `gap-2` / `space-y-2` |

### ✅ 做

```tsx
<section className="mt-6 px-5">    {/* 章节用 mt-6 起 */}
  <h2 className="text-serif-cn text-[18px] font-bold">标题</h2>
  <div className="mt-3 space-y-2"> {/* 列表内项 gap-2 */}
```

### ❌ 不做

```tsx
<section style={{ marginTop: 22 }}>     {/* 22 不在节奏 */}
<div className="mt-3.5 px-7">           {/* 3.5 / 7 不规范 */}
<div className="mb-1 mt-9 ml-13">       {/* 9/13 出节奏 */}
```

---

## 2. Typography

### 字族

| 用途 | 字族 | 已有类 |
|---|---|---|
| 中文标题 (h1/h2) | Noto Serif SC 600/700 | `text-serif-cn font-bold` |
| 中文正文 | Noto Sans SC 400/500 | (默认) |
| 英文副标题(标签) | Cormorant Garamond Italic | `label-cormorant` 或 `text-cormorant` |
| 数字(积分/价格) | Playfair Display + tabular | `text-display num` |

### 字号阶梯

| 角色 | px | Tailwind |
|---|---|---|
| 页面主标题 | 22-26 | `text-[22px]` / `text-[26px]` |
| 区块标题 | 17-18 | `text-[17px]` / `text-[18px]` |
| 卡片标题 | 14-15 | `text-[14px]` / `text-sm` |
| 正文 | 13-14 | `text-[13px]` / `text-sm` |
| 副标题/辅助文 | 11.5-12 | `text-[12px]` |
| Cormorant 英文副标 | 10-12,letter-spacing 0.25em+ | `label-cormorant`(10px)/`text-[12px] tracking-[0.28em]` |
| 最小可读 | 11(辅助文下限) | `text-[11px]` |

### 颜色对比

| 角色 | 颜色 | 用法 |
|---|---|---|
| 主标题 | `text-ink-900` / `text-ink-800` | 不用 ink-600 当标题(对比不足) |
| 正文 | `text-ink-700` / `text-ink-800` | |
| 辅助文 | `text-ink-500` | 不下探到 ink-300(看不清) |
| 副标题 cormorant | `text-warm-500` 或 `text-primary` | 不用 warm-200/300(几乎隐形) |

### ❌ 反例(来自 audit)

- `label-cormorant` 默认 `text-warm-500`,但 `/me/preferences` 用了更淡的色 → 副标题几乎看不见 → **统一回 text-warm-500 起步**,需要弱化才用 `/40`
- 字号忽大忽小(20/19/17/15 混搭)→ 卡死在上面阶梯之一

---

## 3. 色 Color

### Token 已存在(globals.css)

```
primary:   #FF5577 (rose 主色,gradient-cta 起点)
ink:       50-900 (中性灰阶,900 最深)
warm:      50-200 (暖底背景)
success:   #2FA36B-ish
gradient-cta:   linear from #FF7A8E to #E63E5C (CTA 渐变)
gradient-soft:  light pink → cream 的页面底色
```

### 用法

| 场景 | 用什么 |
|---|---|
| CTA 主按钮 | `bg-gradient-cta text-white shadow-rose-lg` |
| 次按钮 | `bg-white border border-warm-200 text-ink-800` |
| 文字链接 | `text-primary`(只在动作语) |
| 卡片背景 | `bg-white shadow-warm-xs/sm` |
| 页面底 | `bg-gradient-soft`(暖渐变) |
| 强提醒 | `bg-primary/5 border border-primary/30 text-primary` |

### ❌ 不做

- 凭空发明颜色(`#A1B2C3`)
- 紫色渐变(AI slop 标志)
- gradient-soft 区直接接纯白区(audit H4):用渐变或卡片化过渡
- `text-ink-300` 当主文字色

### 阴影层级(globals.css)

| Token | 用 |
|---|---|
| `shadow-warm-xs` | 卡片轻浮起(列表项) |
| `shadow-warm-sm` | 卡片中浮起(独立卡) |
| `shadow-warm-md` | 模态/重要卡 |
| `shadow-rose-md` | CTA 内嵌或 hover 加强 |
| `shadow-rose-lg` | 主 CTA 按钮 |

**全站一致**:同语义同 token,不混(audit Cos2)。

---

## 4. 加载 Loading(核心 · 修 C1/C2/H1/H2)

### 核心原则:**渐进显示,不阻塞渲染**

```
进页 0ms ───────────► UI 骨架 / 已知数据先显(标题、容器、tab、输入)
       100ms ───────► 短期数据(/me/dashboard)若回:替换
       <200ms ─────► 慢数据若仍未回,这里才显 inline skeleton
       数据回 ────► 替换,不整体闪
```

### 规则

| 场景 | 做法 |
|---|---|
| 进页瞬时数据 | 已知 / 缓存 / SSR 直出,无骨架 |
| 数据需 fetch 且预估 < 200ms | **不显骨架**;直显 UI 结构 + 空数据占位;数据到了无声替换 |
| 数据需 fetch 且预估 > 200ms | inline 局部骨架(只在数据区,不要全局白屏) |
| 骨架形状 | **与最终布局像素对齐**(高度/列数/间距一致),避免 layout shift |
| Suspense fallback (loading.tsx) | 用 SAME 形状的骨架,不要换样式 |
| 数据加载失败 | 用 friendly empty-state 替换(见 §8),不要永远转圈 |

### ✅ 标准模式(参考 assistant 修复)

```tsx
// 不阻塞 UI:进页立刻显欢迎区,greet 异步到了再加 bubble
useEffect(() => {
  setGreetingLoaded(true);                 // ① 立即解锁 UI
  void apiGet('/greet').then(g => setTurns([{role:'assistant', content:g.content}]))
                       .catch(() => {});   // ② 静默失败,UI 仍可用
}, []);

return (
  <>
    {greetingLoaded && <WelcomeHero />}    {/* 不再等 greet */}
    <Messages turns={turns} />              {/* 数据到就显 */}
    <InputBar />                            {/* 始终在 */}
  </>
);
```

### ❌ 反模式

```tsx
// 不要这样:整页等数据,数据没到一切都不显
if (!data) return <FullPageSkeleton />;
return <Page data={data} />;
```

### loading.tsx 阈值

**< 200ms 的页面切换不显骨架**。在 Next.js Suspense 下,加 200ms 防闪延迟:

```tsx
// app/me/loading.tsx
'use client';
import { useEffect, useState } from 'react';
export default function Loading() {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 200); return () => clearTimeout(t); }, []);
  return show ? <MeSkeleton /> : null;  // 200ms 内不显
}
```

---

## 5. 错误 Error

### 不外露后端原始 message

任何 catch 出来的 `ApiClientError.payload.message`,**不直接 setError**。先映射:

```tsx
function friendlyError(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.payload.code === ErrorCode.E1001_OTP_INVALID) return '登录状态已失效,请重新登录';
    return err.payload.message;   // 业务错误中文文案,可直显
  }
  return '网络好像开小差了,稍后再试';
}
```

### 显示位置

| 类型 | 显示 |
|---|---|
| 表单提交错误 | 字段下 inline `text-primary text-[12.5px]` |
| 接口失败 | 顶部 banner `bg-primary/5 border border-primary/30 text-primary px-4 py-2.5 rounded-xl` |
| 整页加载失败 | 替换内容为 empty-state(见 §8) + "重试"按钮 |

### ❌ 不做

- 在界面糊 `missing bearer token` / `HTTP 500` 等英文
- 让 toast 自动消失但用户没看到关键信息(关键失败要常驻直到用户处理)

---

## 6. 路由 & 登录 Routing(修 C3)

### 用户类型路由表

| 流程 | customer 落点 | therapist 落点 |
|---|---|---|
| `/auth/register` 完成 | `/home` | `/t/home` |
| `/auth/recover` 完成(重登) | **`/home`**(修!不是 `/discover`) | `/t/home` |
| 注销 `logout()` | `/`(landing) | `/`(landing) |
| 未登录访问需登录页 | 友好引导卡(见 assistant 模式) | 同左 |
| 未登录访问 /(landing) | 渲染 splash | 同左 |

### 实现

```tsx
// /recover 与 /register 的成功 push 路径
router.push(user.user_type === 'therapist' ? '/t/home' : '/home');
//                                                      ^^^^^ 不是 /discover
```

### "返回"

| 来源 | back 行为 |
|---|---|
| 二级页 | `router.back()` 回上一页;若 history 为空,回 `/home` 兜底 |
| 模态/抽屉 | 关闭模态,不动 url |
| 流程页(register 多步) | 上一步;首步 back = 回 `/` |

---

## 7. 动效 Animation

### 时长

| 互动 | duration | timing |
|---|---|---|
| Hover / 按下反馈 | 100-150ms | `transition` (default) |
| Tap scale | `active:scale-[0.97]` | 默认 |
| 入场淡入 | 240ms | `animate-fade-up` |
| 路由切换 | 200-300ms | 走 Next.js 内置 |
| 微旋转/脉冲 | 1.6-2.4s | 已有 `ai-ring` / `dot-pulse` |

### ❌ 不做

- 装饰性长动画(>500ms)阻塞用户操作
- 多个相邻元素错峰动画 > 3 个(分散注意力)
- 每个 button 都加 spring / scale / glow(留给真 hero 元素)

---

## 8. 空态 Empty States(修 M2)

### 结构(强制 4 件套)

```
┌─────────────────────────┐
│        [图标/插画]        │   ← gradient-orb 或 lucide 单色图标,48-72px
│                          │
│        主文(一句)        │   ← text-serif-cn font-semibold text-[15px] text-ink-800
│      辅助文(更细)        │   ← text-[12px] text-ink-500
│                          │
│      [次级动作按钮]       │   ← 跳走的链接,不是死巷
└─────────────────────────┘
```

### 例

```tsx
<div className="mt-12 flex flex-col items-center text-center px-8">
  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-warm-50 shadow-warm-sm">
    <Bell className="h-7 w-7 text-warm-400" />
  </div>
  <div className="mt-3 text-serif-cn text-[15px] font-semibold text-ink-800">还没有通知</div>
  <div className="mt-1.5 text-[12px] text-ink-500">订单/聊天/优惠会通过这里告诉你</div>
  <Link href="/me/notifications/settings" className="mt-4 rounded-full bg-warm-50 px-4 py-1.5 text-[12px] text-ink-700">
    通知偏好 →
  </Link>
</div>
```

### ❌ 不做

- 只有 icon + 一句话,没有"下一步"(死巷)
- 空态 + 大量留白延伸到底部 nav(给"加载/搜索/前往"任一动作)
- "暂无数据"四个字了事

---

## 9. 自检清单(新页 / 改页前对照)

落地前过一遍 ↓ 全 ✓ 才合规:

- [ ] 间距全部在 4/8/12/16/20/24/32 节奏上
- [ ] Typography 角色对应字号/字色阶,无超 6 个不同字号
- [ ] 颜色只用 token,无凭空 hex
- [ ] 进页 200ms 内可见有意义像素(非纯白/纯骨架)
- [ ] 数据未到时:UI 骨架先显,数据流入替换,不整体闪
- [ ] 所有 catch 用 friendlyError,无英文原始错误外露
- [ ] 路由表对齐 §6(尤其登录后落点)
- [ ] 动效时长在 100-300ms 标准带内,无装饰性长动画
- [ ] 空态四件套齐(图 / 主文 / 辅文 / 动作)
- [ ] 在 390×844 + 820×920 两种视口下都不破

---

## 附录 · 现有可复用资产清单

| 组件/类 | 文件 | 用途 |
|---|---|---|
| `AppShell` | `components/AppShell.tsx` | 客户端壳(含 CustomerTabBar);`fill` 模式给聊天 |
| `TherapistShell` | 同上 | 技师端壳 |
| `GradientOrb` | `components/ui.tsx` | 品牌徽标圆 |
| `RecCard` | 同上 | 技师卡 |
| `TypingDots` `Shimmer` `LoadingFull` | 同上 | 加载占位 |
| `EmptyState` | 同上 | 空态(已有,符合 §8 雏形,需补 action prop) |
| `ErrorBanner` | 同上 | 顶部错误条 |
| `Badge` `PointsTag` `OnlineDot` `Avatar` | 同上 | 通用小件 |
| `.label-cormorant` | `globals.css` | Cormorant 英文副标 |
| `.text-serif-cn` `.text-cormorant` `.text-display` `.num` | 同上 | 字族类 |
| `.msg-bubble-mine/other` `.chip-quick` `.score-pill` | 同上 | 消息/筹码 |
| `.mobile-container` `.gradient-orb` | 同上 | 壳/光斑 |

---

**v1.0 · 2026-05-28 · 基于 audit 19 个问题倒推。后续遇新模式补这份。**
