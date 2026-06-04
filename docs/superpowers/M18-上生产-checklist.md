# M18 上生产 · Checklist + 收口方案

> 2026-06-05 盘点。`feat/m18-companion-chat` 领先 main **50 commit**，含三大 M18 功能 + 并发会话的 M04/M06，**一行未上生产**。本文给安全上线的顺序、门、回滚、风险。

## 一、这条分支上有什么（盘点）

**我的 M18（~34 commit，三块功能，全可跑、e2e 绿）**
| 功能 | 状态 | 迁移 |
|---|---|---|
| 陪聊付费（心动陪伴）| P1+P2 实现，e2e 16 绿 | 0030 companion_actions + intimacy |
| 声音复刻（双通道）| OpenAI 通道 prod 实测发声，e2e 2 绿 | 0031 therapists.eleven_voice_id |
| 撩拨发图 | P1→P3→2.1 全实现，e2e 多绿 | 0032 chat_media + chat_media_sends |

**混入的并发会话工作（M04 对话匹配 / M06 facts 等）**——不是我建的，但和 M18 在同一分支、同步部署。

## 二、部署门（硬卡点·不做必炸）

**Railway 部署 = push main 自动部署**（[[loverush_railway_deploy]]）。feat/m18 合 main → **整条分支（M18+M04+M06）一起上**，没法只挑 M18。所以：

### 门 1 · 迁移必须先于代码上生产
代码部署后会立刻查新表/新列；表/列不存在 → 42703 / 全站 500。**上代码前先把以下迁移手动应用到生产库**（[[feedback_railway_run_prod_migration.md]] / [[feedback_schema_migration_gap]]）：
- `0030_m18_companion.sql`（companion_actions + intimacy）
- `0031_m18_voice_clone.sql`（therapists.eleven_voice_id）
- `0032_m18_chat_media.sql`（chat_media + chat_media_sends）

### 门 2 · M04 的 match_persona 缺口（⚠️ 非我的活但同样卡）
M04 把 `therapists.matchPersona` 加进了 drizzle schema，**但没有对应迁移文件**（迁移只到 0029 m04_match_profile，那建的是别的表）。生产 therapists 缺 `match_persona` 列 → 部署后任何选全表的 therapists 查询 42703。
**这是 M04 会话的责任**，但它卡整条分支上线。两条路：
- (a) 找 M04 会话补一个 `ALTER TABLE therapists ADD COLUMN IF NOT EXISTS match_persona jsonb;` 迁移；
- (b) 部署前对生产手动加这列（我可代跑，但属于别人功能的 schema，建议先确认）。
> 我的 M18 代码已全用窄 select 免疫此漂移，但 M04/M06 的代码不一定。

## 三、上线步骤（建议顺序）

0. **决策**：整条分支上 vs 只挑 M18（见五·风险）。下面按"整条上"写。
1. **核对生产 schema 现状**（只读，需授权 railway run）：
   ```bash
   railway run -s loverush -- bash -c 'psql "$DATABASE_URL" -c "\d therapists" -c "\dt companion_actions" -c "\dt chat_media"'
   ```
   确认：therapists 有无 eleven_voice_id / match_persona；companion_actions/intimacy/chat_media/chat_media_sends 是否已存在。
2. **应用迁移到生产**（按序，幂等 IF NOT EXISTS 安全可重跑）：
   ```bash
   for m in 0030_m18_companion 0031_m18_voice_clone 0032_m18_chat_media; do
     railway run -s loverush -- bash -c "psql \"\$DATABASE_URL\" -f packages/db/migrations/$m.sql"
   done
   # + 门2 的 match_persona(若生产缺)
   railway run -s loverush -- bash -c 'psql "$DATABASE_URL" -c "ALTER TABLE therapists ADD COLUMN IF NOT EXISTS match_persona jsonb;"'
   ```
3. **seed 基础数据**：
   - companion_actions：`railway run -s loverush -- bun apps/api/scripts/seed-companion-actions.mts`（5 个动作；定价是示例，待你拍）。
   - chat_media / 技师素材：技师自己在 `t/me/chat-media` 传；无需 seed。
4. **确认 env**（生产）：OPENAI_API_KEY 已有(声音复刻通道B已验)；ELEVENLABS_API_KEY 可选(配了才走真克隆)。
5. **合并部署**：feat/m18-companion-chat → main → push → Railway 自动部署（约 6min）。
6. **冒烟验证**（部署后）：
   - `/health`/`/ping` 200；
   - 登录态走一遍：首页技师列表(therapists 查询不 500)、开会话、发起 companion 动作、技师 t/me/chat-media、声音复刻 /voice/me。
   - 看 Railway log 有无 42703 / 500 飙升([[feedback_deploy_failure_triage]])。

## 四、回滚预案
- 迁移全是**加表/加列**(IF NOT EXISTS)，对老代码无破坏 → 迁移本身不需回滚。
- 代码出问题 → Railway 一键 rollback 到上个部署(或 revert 合并 commit 重 push)。
- 新表/列即使代码回滚也留着无害(下次再上)。

## 五、风险 + 待你拍板
1. **整条分支 vs 只挑 M18**：分支混了 M04/M06。整条上=连别人的活一起(它们若没测/没迁移会拖累)；只挑 M18=要 cherry-pick 34 commit 到干净分支(工作量+可能漏依赖)。**建议先确认 M04/M06 那些会话的活是否就绪可上**，就绪则整条上最省。
2. **match_persona 缺口**：上线前必须补(门2)，否则全站 500。
3. **数值未定**：companion 动作定价/分成、撩拨发图免费额度/冷却/付费图价/亲密度门槛——可先用代码默认上线再调(配置驱动)，但定价 0 或不合理会影响变现。
4. **声音复刻**：OpenAI 通用女声即开即用；本人克隆等 ELEVENLABS key。
5. **意图判定**：撩拨发图用关键词(免费可靠)，上线即用。
6. **并发污染复查**：上线前 `git worktree list` + `git log` 确认没有别的会话的半成品混入要上的 commit([[feedback_parallel_session_worktree_isolation]])。

## 六、我的建议
- **不要整条盲目上**——先和你确认 M04/M06 会话的活是否就绪(它们没迁移/没测会把全站拖垮)。
- M18 三块功能本身就绪、e2e 绿、迁移幂等安全。
- 最稳：①核对生产 schema ②补齐所有迁移(含 match_persona) ③seed ④小流量/低峰部署 ⑤冒烟。
- 数值可先默认上、再按转化数据调([[loverush_conversion_strategy]] 死盯首充破冰率)。
