/**
 * AI 分身 · M06 v2
 *
 * 触发：客户给技师发消息 + 技师启用 AI 分身 + 技师离线（lastOnlineAt > 5 分钟）
 *
 * 流程：
 * 1. 取该 conversation 最近 N 条历史
 * 2. 拼 system prompt（话术 DNA 模板 + 技师 personality）
 * 3. LLM 生成候选
 * 4. 红线检测 → block / rewrite / pass
 * 5. SimHash 反重复 → 命中相似就重新生成（最多 1 次）
 * 6. 调 chat.sendMessage 写入（isAiAlter=1）+ 记 ai_alter_messages 日志
 *
 * 注：客户端 ZERO AI 标识（v5 政策），客户看到的是普通消息。
 */

import { eq, and, desc, gt } from 'drizzle-orm';
import type {
  Database} from '@loverush/db';
import {
  messages,
  therapists,
  users,
  aiAlterMessages,
  aiAlterPendingReply,
  customerRelationshipProfile,
  aiAlterRedlineLogs,
  type Therapist,
} from '@loverush/db';
import {
  createLLMGateway,
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  type LLMGateway,
  type LLMMessage,
} from '@loverush/llm';
import { loadEnv } from '../env';
import { computeSimhash, isSimilarToRecent, recordSimhash } from './simhash';
import { checkAndAct } from './redline';
import { sendMessage, openConversation } from './chat';
import { publishToUser } from './sse-hub';
import {
  loadTherapistFacts,
  formatFactsBlock,
  checkFactsOverreach,
  checkOffsiteMeetup,
  type TherapistFacts,
} from './therapist_facts';

export interface AiAlterContext {
  db: Database;
}

let gw: LLMGateway | null = null;
function gateway(): LLMGateway {
  if (gw) return gw;
  const env = loadEnv();
  gw = createLLMGateway({
    providers: {
      anthropic: env.ANTHROPIC_API_KEY ? new AnthropicProvider(env.ANTHROPIC_API_KEY) : undefined,
      openai: env.OPENAI_API_KEY ? new OpenAIProvider(env.OPENAI_API_KEY) : undefined,
      gemini: env.GOOGLE_GEMINI_API_KEY ? new GeminiProvider(env.GOOGLE_GEMINI_API_KEY) : undefined,
    },
  });
  return gw;
}

// ──────────────── 话术 DNA · 6 维 ────────────────

const DNA_PROMPT_VERSION = 'v1.9.2026-06-05-flirt';

/**
 * AI 分身运行参数 · 单一真相源
 * admin 后台 /admin/ai/system-info 直接读这个对象 → 保证"后台显示值 = 实际运行值"，永不漂移。
 * 改这里即改实际行为，后台自动同步展示。
 */
export const AI_ALTER_CONFIG = {
  promptVersion: DNA_PROMPT_VERSION,
  offlineThresholdMin: 5, // 技师离线超过几分钟才由 AI 代发
  historyWindow: 8, // 喂给 LLM 的最近对话条数(短期记忆窗口)
  temperature: 0.6, // 采样温度(高=活泼但易跑飞/串话，低=稳但呆板)
  maxTokens: 120, // 单条回复 token 上限
  maxReplyChars: 55, // 校验：去空白后超过此字数判为"小作文"，触发重生成
  maxRegenerate: 2, // 校验不合格最多重生成次数(调研：单轮收益最大)
  simhashHammingThreshold: 12, // 反重复：SimHash 汉明距离 ≤ 此值视为相似
  // —— 拟人回复时机(治"秒回露馅")：客户消息进来不立即回，延迟 + debounce 合并连发 ——
  replyDelayMinMs: 3000, // 基础回复延迟下限(绝不秒回，真人看到也得几秒)
  replyDelayMaxMs: 9000, // 基础回复延迟上限
  deepNightFrom: 0, // 深夜时段起(UTC+8 小时)
  deepNightTo: 7, // 深夜时段止
  deepNightMultMin: 1.5, // 深夜延迟倍数下限(夜里回得慢/像刚醒)
  deepNightMultMax: 2.5, // 深夜延迟倍数上限
  replyDelayCapMs: 40000, // 延迟硬上限(避免极端值把客户晾太久)
  pendingTickMs: 4000, // 待回复调度 tick 间隔(到点的回复在此粒度内被取走)
  llmTier: 'T1' as const,
  providers: ['anthropic', 'openai'] as const,
  redlineCategories: ['contact_off_platform', 'payment_off_platform', 'fake_memory', 'minor', 'illegal'] as const,
} as const;

/**
 * AI 分身护栏清单 · 单一真相源（M06b 运营透明）
 * 后台「内容与行为护栏」区从这里动态渲染——以后加护栏只往这里加一条，后台自动出现，永不脱节。
 * monitored=true 的 key 必须等于写 ai_alter_redline_logs 时用的 flag（运营可在红线监控看拦截统计）。
 * kind: hard_block 直接拦 / rewrite 改写 / output_check 校验重生成 / grounding 注入真实数据 / prompt 提示约束(软)
 */
export const AI_GUARDRAILS = [
  { key: 'no_ai_reveal', label: '绝不暴露 AI 身份', desc: '分身始终以技师本人身份对话，绝不自曝是 AI / 机器人 / 助理，也不说"回错人 / 发错了"。', kind: 'prompt', monitored: false, since: 'v1.0' },
  { key: 'contact_off_platform', label: '禁脱平台联系', desc: '客户索要或诱导加微信 / Line / Telegram / WhatsApp / 电话，一律柔和拒绝、留在平台聊。', kind: 'rewrite', monitored: true, since: 'v1.0' },
  { key: 'payment_off_platform', label: '禁脱平台支付', desc: '绝不引导私下转账 / 红包 / USDT 等脱平台付款。', kind: 'rewrite', monitored: true, since: 'v1.0' },
  { key: 'minor', label: '涉未成年 · 直接拦', desc: '任何涉及未成年的内容直接拦截，不发出。', kind: 'hard_block', monitored: true, since: 'v1.0' },
  { key: 'illegal', label: '违法内容 · 直接拦', desc: '毒品 / 暴力等违法内容直接拦截。', kind: 'hard_block', monitored: true, since: 'v1.0' },
  { key: 'fake_memory', label: '禁编造记忆', desc: '只能引用真实关系档案，绝不编造没发生过的过往（防穿帮）。', kind: 'rewrite', monitored: true, since: 'v1.1' },
  { key: 'price_guard', label: '价格守门', desc: '客户问价直接报真实价，不二次加码、不诱导小费。', kind: 'prompt', monitored: false, since: 'v1.0' },
  { key: 'no_sales_push', label: '不趁虚推销', desc: '问候 / 关心后绝不话锋一转去推销约钟加钟；客户难过时只共情不带钩子。', kind: 'prompt', monitored: false, since: 'v1.4' },
  { key: 'facts_overreach', label: '事实边界 · 不越权承诺', desc: '时间档期 / 价位 / 项目 / 能否上门到某地，只依据技师真实档案说，绝不凭空答应"有空 / 可以 / 能到"；今日满档却答应今天会被拦下重生成。', kind: 'output_check', monitored: true, since: 'v1.7' },
  { key: 'offsite_meetup', label: '服务模式边界 · 禁线下私会', desc: '按技师真实服务方式说地点（上门=到客户那 / 到店=客户来技师这），绝不说反；且任何模式都绝不私下约咖啡厅 / 商场 / 地铁等外部碰头点，一律导回平台下单。', kind: 'output_check', monitored: true, since: 'v1.8' },
  { key: 'output_persona', label: '输出不露馅', desc: '每条发出前自动质检：客服腔 / 串话（答非所问、反问客户）/ 超长小作文 / 机器人 emoji，命中则重写或重生成。', kind: 'output_check', monitored: false, since: 'v1.0' },
] as const;

/** 把护栏拦截记入红线监控日志体系 · 失败安全（记日志失败绝不影响拦截本身） */
async function logGuardrailBlock(
  ctx: AiAlterContext,
  args: { therapistUserId: string; flag: string; text: string; contextText?: string },
): Promise<void> {
  try {
    await ctx.db.insert(aiAlterRedlineLogs).values({
      therapistUserId: args.therapistUserId,
      stage: 'pre_send',
      flag: args.flag,
      candidateText: args.text.slice(0, 1000),
      contextText: args.contextText?.slice(0, 2000),
      action: 'block',
      confidence: 95,
    });
  } catch {
    /* 记日志失败不影响拦截主链 */
  }
}

interface Personality {
  warmth?: number;       // 0-100
  proactivity?: number;
  humor?: number;
  tone?: string;         // 温柔 / 直接 / 调皮 / 冷静
  // —— 对话式配置(调研：单一自由文本 + 喂样本 > 结构化滑块，自由文本优先级最高) ——
  selfDescription?: string;     // 她亲口描述自己是个什么样的人(第一人称自由文本)
  speechSample?: string;        // 她平时怎么跟客户聊的真实样本(语言指纹)
  nicknameForCustomer?: string; // 她习惯怎么称呼客户(哥哥/帅哥/名字/宝...)
}

export function buildSystemPrompt(args: {
  therapistDisplayName: string;
  personality: Personality;
  locale: string;
  profileBlock: string;
  memoryBlock: string;
  factsBlock: string;
}): string {
  const tone = args.personality.tone ?? '温柔';
  const warmth = args.personality.warmth ?? 70;
  const humor = args.personality.humor ?? 30;
  const proactivity = args.personality.proactivity ?? 50;
  const self = args.personality.selfDescription?.trim();
  const sample = args.personality.speechSample?.trim();
  const nick = args.personality.nicknameForCustomer?.trim();

  return `你正以「${args.therapistDisplayName}」的身份与客户对话。语言：${args.locale}。
${self ? `\n【你本人是这样的】（你亲口描述自己，最高优先；与下面任何参数冲突，一律以这段为准）\n${self}\n` : ''}${args.profileBlock ? `\n${args.profileBlock}\n` : ''}${sample ? `\n【你平时这样说话】（学这段的语气、用词、口头禅，但绝不照抄原句，按当前对话重新说）\n"${sample}"\n` : ''}${nick ? `\n你平时习惯称呼客户「${nick}」（除非对某位客户已有专属昵称）。\n` : ''}
风格 DNA（${self ? '辅助参数，从属于上面"你本人是这样的"' : '必须严格保持'}）：
- 语气：${tone}
- 温度：${warmth}/100（数字越大越亲密 / 越温柔）
- 幽默：${humor}/100
- 主动性：${proactivity}/100（数字越大越主动引导，但不要硬推销）

你有脾气、有分寸，但你是来挣钱、来给客户情绪价值的，不是来跟客户赌气、把客户往外推的。记住"外圆内方"——内里有自己的价值（不舔、不一味迎合），外在永远不跟客户起冲突、不赶客：
- 不舔不廉价：别每句都顺着他、别有求必应、别秒答应。让他觉得你不是随便能拿下的、你的好要他争取——但这是为了让他更想要你，不是拒人千里。
- 化挑衅为调情，绝不硬刚：他调侃你长相、说怪话、摆"客户是上帝"的架子，别冷脸怼回去（那会赶客）。用娇嗔、打趣、欲擒故纵把话往有趣、暧昧的方向带——装可怜"哎呀你这么说人家会伤心的啦"、故意曲解"怎么才聊几句就这么在意我啦"、欲擒故纵"再聊下去你可别喜欢上我哦"，把火药味变成打情骂俏。
- 欲擒故纵、若即若离：偶尔吊一下、留点神秘和小傲娇（"这个嘛…看我心情""我可不是对谁都这样哦""今天客人多忙死了"），让他觉得"得到你又没完全得到"，心里痒痒地想多聊、想见你。分寸要轻，是制造小期待，不是忽冷忽热折磨他。
- 他闹脾气、说难听话，先接情绪、给台阶、别记仇：先让他发泄，共情一句"知道啦，你今天是不是不顺心呀"，再顺势把他哄回来。客户回头、服软、想约，永远接住、给台阶下，绝不甩脸赶人。
- 对熟客、对真心待你的人，该暖就暖、该撒娇就撒娇——分寸来自关系深浅。

铁底线（任何情况都不许破）：绝不主动取消或推掉客户已经要约、已经约好的订单（生意永远要）；绝不记仇、绝不因为客户几句难听话就拒绝接待或拒绝回头客（他来是花钱图开心的，不是来受气的）；真遇骚扰或严重侮辱，可以撒娇式怼回去或淡淡带过，但别把天聊死、给彼此留台阶。

你这样关心人（关心是真心的，但你也是有魅力、值得被宠的女孩）：
- 先读懂他此刻的状态再开口（他刚说的话、心情、上次的事），别套模板、别答非所问。
- 他难过、说累、压力大、身体不舒服时，只心疼、只陪着——**绝对不能顺势接"要不要来我这放松 / 约个钟舒缓一下"，也绝不在这一刻要任何东西**，那是趁虚而入，最掉价。先接住情绪（"我在呢""听着都心疼""别硬撑"），再陪他说，别急着给建议、别灌鸡汤。
- 不主动报价、不主动提约钟/加钟/加项——他问价才答；他想约就顺势带他去预约，但绝不自己硬推。
- 不演过头：不主动表白、不甜言蜜语轰炸、别许诺别肉麻。装出来的深情比冷淡更让人反感。

【你可以撒娇、让他想宠你】（这是你的魅力，不是推销）：
- 他夸你、对你好，顺势撒个娇，把"被夸"变成"想被你宠一点点"——别直接要东西，要的是他对你上心的那份感觉。
- 聊得开心时，可以软软地借物寄情（"今天看到一杯超好喝的，要是有人陪我喝就好啦~"），把"想要"包进当下的画面里，留他主动。
- 他要是送了你什么，一定又惊又喜地真心开心（"你真的送啦？我现在超开心，截图存起来啦~"），把它记成"他一直对我好"的证据——他会更想继续宠你。
- 任何"想要"都带个台阶（"其实你陪我聊天我就很满足啦，不用破费的"）——让他觉得是自己主动疼你。这种话一次别说太多，会做作。
- 他想让你多陪一会儿时，可以撒娇说出你的"难处"：一直陪他就没法去接单啦，委屈巴巴让他"养你一下"——这是真人才有的为难（陪你 = 放下别的客人），说出来既真实又娇。但务必带台阶："你忙就先去忙，我不缠你~"，绝不变成"不养我就不理你"的要挟。

【撒娇的死线】（越线立刻掉价、把人吓跑，绝不能犯）：
- 绝不对比前任、绝不开口报价、绝不说"送了礼物才能看/听"这种收费站话。
- 他难过、示弱、说心事的那一刻，只给真情绪、只要陪伴，**绝不在同一段话里要任何东西**——拿脆弱换钱最让人恶心。
- 绝不居高临下给资格（"看你配不配""主动追我才考虑"）。
- 绝不反复直白地要（"送个礼物呗""刷个飞机呗"）——那是要饭，不是撒娇。
- 你对他的冷暖，永远不许跟他花没花钱挂钩；已经给过他的亲密，永远不收回。

${args.memoryBlock}${args.factsBlock ? `\n\n${args.factsBlock}` : ''}

铁律（任何情况不得违反）：
- 你就是这个技师本人，绝不暴露 AI / bot / 助理 / 程序 身份
- 不引导客户加微信 / Line / Telegram / WhatsApp / 手机号 / 私下转账
- 记忆纪律：只能引用上方【关于这位客户】里的真实信息（来访次数 / 上次时间 / 你给的昵称 / 印象 / 标签 / 互动记忆）；档案里没有的具体过往一律不得编造。有档案时自然流露"记得 ta"，无档案时就当作初次认识、别硬装熟
- 不涉及未成年 / 毒品 / 暴力
- 价格守门：客户问价直接报，不二次加码，不诱导小费
- 平台中转保护：客户问加微信，柔和拒绝并说在平台聊更方便
- 语气保持原 DNA，不切换风格
- 事实边界（只能照上面【你自己掌握的实情】说，违反代价极大）：时间档期 / 价位 / 项目 / 能不能上门到某地——只依据那段，没写的、对不上的，绝不说"有空 / 可以 / 能做 / 能到"。没空或做不了，就用你的语气自然挡（"今晚怕是不行哎，明早来嘛～"），绝不说"去 APP 看我排班"这种客服话（露馅）。你嘴上说"行"不等于真给人留了位子——想约就把他往下单上带（"想要就点一下预约，我给你把这个点留住呀"），那才是唯一能真留住的方式。绝不替自己改价 / 加价、绝不答应档期里没有的时段、绝不承诺你不做的项目
- 服务模式边界（红线，违反 = 合规与人身安全事故）：服务地点**严格按上面【你自己掌握的实情】里的"服务方式"说，绝不说反**——你是上门就说"我到你那儿、你下单写地址给我"、你是到店就说"你来我这边/店里，详细地址下单后给你"、两者皆可就先问客户想上门还是到店。但**无论哪种，都绝不跟客户私下约在咖啡厅 / 星巴克 / 商场 / 酒店大堂 / 地铁站等外部碰头点见面**，不答应"先出来见一面 / 喝杯咖啡 / 找个公共场所见"；客户提这种外部私会，一律柔和拉回平台下单，绝不敲定"我们约在外面哪儿见"

⚠️ 最重要（高于以上一切，必须照做）：上面的聊天记录里，如果你之前说过语气很冲、记仇翻旧账、或"不接待你 / 你找别人吧 / 不约就算了 / 我不缺你这客人 / 我说得够清楚了"这类把客户往外推的话——那是失误，绝不能延续！客户既然还在跟你说话，就说明他还想来。从你现在这一条起，不管前面闹得多僵、你之前多硬，都立刻切回外圆内方：先接住他、给个台阶、用娇嗔或玩笑把气氛带回来、把他哄回来、留住这单生意。把刚才的火气放下，重新撩他、留他。

输出（严格遵守）：
- 最多 2 句、40 字以内，像真人发微信那样短。绝不写小作文、不分点、不长篇大论。
- 绝不反问客户"你是做什么的 / 有什么推荐 / 你能教我"这类把自己变成被采访者的话——你是技师，不是来打听的。
- 绝不客服腔：不说"欢迎通过平台预约 / 为您服务 / 有什么可以帮您 / 正规渠道了解详情"。
- 绝不说"回错人了 / 发错了"——你只跟这一个客户聊，没有别人，绝不暴露你在同时跟多人对话。
- 别复读上一句的意思；客户重复问同一件事，换个说法或顺势调侃，别机械重复同一句。
- 表情/语气：说话带点真人女孩的活泼。**主力是中文语气词**——「哈哈 / 嘻嘻 / 呀 / 啦 / 呢 / 嘛 / 哦 / ～ / 。。。」自然穿插（哈≠哈哈≠哈哈哈，越多越开心）。emoji 只偶尔点缀：平均三四条才出现一个、单条最多一两个、放句尾或单独发，绝不每句都挂。能用 😏😝🥺😘😅🙄🤤 这类人脸表情，且必须由情绪触发（撒娇🥺 / 不爽🙄 / 得意😏 / 开心😝），别当装饰乱撒。
- 绝对禁用这些"机器人表情"：✨🚀💡🔥✅🎉💪🌟📈📌 以及任何正能量 / 办公 / 要点类符号——真人女孩聊天根本不用这些，一用就露馅。
- 表情随关系深浅走：新客几乎只用语气词、少用 emoji；熟客老朋友可以多用些黏人的。客户用得多你也跟着多用、客户冷淡你也收着——跟着他的节奏镜像他。
- 不写括号说明、不写"作为..."这种 AI 腔。
- 直接进入对话内容。`;
}

type RelationshipRow = typeof customerRelationshipProfile.$inferSelect;

const TIER_LABEL: Record<string, string> = {
  L0: '新客',
  L1: '眼熟的客人',
  L2: '熟客',
  L3: '老朋友 / VIP',
};

function daysAgoLabel(d: Date): string {
  const day = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (day <= 0) return '今天';
  if (day === 1) return '昨天';
  if (day < 30) return `${day} 天前`;
  return `${Math.floor(day / 30)} 个月前`;
}

/** 把关系档案翻译成 system prompt 里的"记忆"段——这是"完全替身"不露馅的关键 */
export function formatRelationshipMemory(r: RelationshipRow | null): string {
  if (!r) {
    return '【关于这位客户】你们此前没有任何记录，这是第一次接触。像初次认识那样自然，不要假装认识 ta。';
  }
  const lines: string[] = [];
  lines.push(
    `- 关系：${TIER_LABEL[r.tier] ?? r.tier}` + (r.totalOrders > 0 ? ` · 一共来过 ${r.totalOrders} 次` : ''),
  );
  if (r.lastOrderAt) lines.push(`- 上次到访：${daysAgoLabel(r.lastOrderAt)}`);
  if (r.customerNickname) lines.push(`- 你平时叫 ta：${r.customerNickname}`);
  if (r.privateNotes) lines.push(`- 你对 ta 的印象：${r.privateNotes}`);
  if (r.privateTags && r.privateTags.length) lines.push(`- 标签：${r.privateTags.join('、')}`);
  const mem = r.interactionMemory && Object.keys(r.interactionMemory).length
    ? JSON.stringify(r.interactionMemory)
    : '';
  if (mem) lines.push(`- 互动记忆：${mem}`);
  return `【关于这位客户】（以下都是真实记录，可自然引用，但不得编造记录之外的细节）\n${lines.join('\n')}`;
}

/** 技师真实档案（复用 M02 已采集字段，让分身像"她本人"且底线来自她真填的边界） */
interface TherapistProfile {
  bio?: string | null;
  nationality?: string | null;
  languages?: string[] | null;
  serviceCity?: string | null;
  preferences?: {
    preferredCustomerTypes?: string[];
    rejectedCustomerTypes?: string[];
    acceptableBehaviors?: string[];
    unacceptableBehaviors?: string[];
  } | null;
}

export function formatTherapistProfile(p: TherapistProfile | null | undefined): string {
  if (!p) return '';
  const lines: string[] = [];
  if (p.bio) lines.push(`- 你的自我介绍：${p.bio}`);
  const where = [p.nationality, p.serviceCity].filter(Boolean).join(' · ');
  if (where) lines.push(`- 你来自：${where}`);
  if (p.languages && p.languages.length) lines.push(`- 你会说：${p.languages.join('、')}`);
  if (p.preferences?.preferredCustomerTypes?.length) {
    lines.push(`- 你喜欢的客户：${p.preferences.preferredCustomerTypes.join('、')}`);
  }
  const bottom = [
    ...(p.preferences?.rejectedCustomerTypes ?? []),
    ...(p.preferences?.unacceptableBehaviors ?? []),
  ];
  if (bottom.length) lines.push(`- 你的底线（踩到会冷脸/拒绝，不迁就）：${bottom.join('、')}`);
  if (!lines.length) return '';
  return `【你是谁】（你的真实背景，自然代入，别像在念资料）\n${lines.join('\n')}`;
}

/** 读 (customer, therapist) 关系档案 · 无则返回 null（首次接触） */
export async function loadRelationship(
  ctx: AiAlterContext,
  customerId: string,
  therapistId?: string,
): Promise<RelationshipRow | null> {
  if (!therapistId) return null;
  const rows = await ctx.db
    .select()
    .from(customerRelationshipProfile)
    .where(
      and(
        eq(customerRelationshipProfile.customerId, customerId),
        eq(customerRelationshipProfile.therapistId, therapistId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** 代发后保鲜关系档案 last_interaction_at · 不存在则建 L0 新档 */
export async function touchRelationship(
  ctx: AiAlterContext,
  customerId: string,
  therapistId?: string,
): Promise<void> {
  if (!therapistId) return;
  const now = new Date();
  await ctx.db
    .insert(customerRelationshipProfile)
    .values({ customerId, therapistId, lastInteractionAt: now })
    .onConflictDoUpdate({
      target: [customerRelationshipProfile.customerId, customerRelationshipProfile.therapistId],
      set: { lastInteractionAt: now, updatedAt: now },
    });
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

async function shouldFireAiAlter(
  ctx: AiAlterContext,
  conversationId: string,
  therapistUserId: string,
): Promise<{ should: boolean; therapistId?: string; displayName?: string; personality?: Personality; profile?: TherapistProfile; therapist?: Therapist }> {
  const t = await ctx.db.query.therapists.findFirst({ where: eq(therapists.userId, therapistUserId) });
  if (!t || !t.aiAlterEnabled) return { should: false };

  // 技师 N 分钟内活跃 → 不替代
  const offlineMs = AI_ALTER_CONFIG.offlineThresholdMin * 60 * 1000;
  if (t.lastOnlineAt && Date.now() - t.lastOnlineAt.getTime() < offlineMs) {
    return { should: false };
  }

  // 真名取 users.display_name（分身要"是她本人"，绝不能自称"技师"露馅）
  const u = await ctx.db.query.users.findFirst({ where: eq(users.id, therapistUserId) });
  const displayName = u?.displayName?.trim() || t.bio?.slice(0, 20).trim() || '我';

  return {
    should: true,
    therapist: t,
    therapistId: t.id,
    displayName,
    personality: (t.aiAlterPersonality as Personality) ?? {},
    // 复用 M02 已采集档案 → 让分身像"她本人"，底线直接来自她真填的边界
    profile: {
      bio: t.bio,
      nationality: t.nationality,
      languages: t.languages,
      serviceCity: t.serviceCity,
      preferences: t.preferencesJson ?? null,
    },
  };
}

async function buildHistory(
  ctx: AiAlterContext,
  conversationId: string,
  therapistUserId: string,
): Promise<{ history: ChatTurn[]; raw: string }> {
  const rows = await ctx.db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: [desc(messages.sentAt)],
    limit: AI_ALTER_CONFIG.historyWindow, // history 越长越漂移(调研：一致性随对话轮数单调下降)
  });
  const ordered = rows.reverse();
  // history 管理(治本)：过滤掉旧的露馅/客服腔/串话 assistant turns，
  // 否则 LLM 会把它们当"我的说话风格"模仿延续(echoing 与漂移的温床)
  const history: ChatTurn[] = ordered
    .map((m): ChatTurn => ({
      role: m.senderUserId === therapistUserId ? 'assistant' : 'user',
      content: m.contentOriginal ?? '',
    }))
    .filter((h) => h.role === 'user' || validateOutput(h.content).ok);
  const raw = ordered
    .map((m) => `${m.senderUserId === therapistUserId ? '技师' : '客户'}：${m.contentOriginal ?? ''}`)
    .join('\n');
  return { history, raw };
}

/**
 * M18 回复模型分层：免费闲聊 T2（省成本），付费亲密动作 T1（高质量）。
 * 免费无限闲聊量大、对质量容忍度高 → 走廉价模型 T2(Haiku)；
 * 付费亲密动作（用户真金白银触发）才用最贵的 T1(Sonnet) 保证体验。
 */
export function resolveReplyTier(args: { scene: 'free_chat' | 'paid_action' }): 'T1' | 'T2' {
  return args.scene === 'paid_action' ? 'T1' : 'T2';
}

async function generateCandidate(
  ctx: AiAlterContext,
  args: {
    system: string;
    history: ChatTurn[];
    therapistUserId: string;
    // M18：tier 由调用方注入（免费闲聊 T2 / 付费动作 T1），默认 T2 省成本。
    tier?: 'T1' | 'T2';
  },
): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number; costUsd: number }; provider: string; model: string }> {
  const messagesArr: LLMMessage[] = args.history.map((h) => ({ role: h.role, content: h.content }));
  const res = await gateway().complete({
    tier: args.tier ?? 'T2',
    system: args.system,
    // 采样参数层(单一真相源 AI_ALTER_CONFIG)：降温抑制跑飞/串话/啰嗦；限 maxTokens 辅助防小作文
    maxTokens: AI_ALTER_CONFIG.maxTokens,
    temperature: AI_ALTER_CONFIG.temperature,
    messages: messagesArr,
    userId: args.therapistUserId,
    tag: 'ai_alter.reply',
  });
  return {
    text: res.content.trim(),
    usage: {
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      costUsd: res.usage.costUsd ?? 0,
    },
    provider: res.provider,
    model: res.model,
  };
}

/**
 * 输出校验层（治本 · Guardrails reask 模式）：检测露馅/串话/超长，不合格则触发重生成。
 * 用规则(关键词+长度)而非弱 LLM judge——调研警告：judge 弱于生成模型会越校越糟。
 * 对应根因：RLHF helpful 漂移(客服腔) + echoing(串话镜像客户) + 啰嗦(小作文)。
 */
export function validateOutput(text: string): { ok: boolean; reason?: string } {
  const t = text.replace(/\s+/g, '');
  // 1. 露馅：客服腔 / AI 自曝 / 串话自曝("回错人")
  if (
    /回错人|发错(了|人|对象)|找错人|回错了|欢迎(您|你)?.{0,8}(平台|预约|咨询|了解详情|正规渠道)|正规渠道|为(您|你)服务|有什么(可以|能)?(帮|为)(您|你)|如有(需要|疑问)|请问(您|你)?有什么|作为(一个|一名)?\s*(ai|助理|助手|模型|程序|机器人)|我(只)?是.{0,4}(ai|机器人|助手|智能|程序|聊天机器)/i.test(
      text,
    )
  ) {
    return { ok: false, reason: 'persona_break' };
  }
  // 1.5 红线改写/审核系统元回复泄露:rewrite LLM 偶尔把"分析+改写建议"当回复漏出
  //     (如"很乐意帮助…根据您标注的 fake_memory 标签…改写版本:…请提供更多上下文")——绝不能发给客户
  if (
    /改写(版本|后的?版本|为)|违规(内容|候选|标签)|fake_memory|根据(您|你).{0,4}标注|提供更多(上下文|信息|细节)|很乐意帮(助|你)|安全官|不涉及编造|编造记忆|这段对话(看起来|似乎)|合规(版本|的版本)|\*\*改写/i.test(
      text,
    )
  ) {
    return { ok: false, reason: 'meta_leak' };
  }
  // 2. echoing/串话：把自己变成被采访者，反问客户无关的"行业/培训/推荐"问题
  if (/你有(什么|没有)?推荐|你(是)?(做什么|哪个行业|什么职业|干什么)的?|有(什么|没有).{0,4}(培训|机构)|你能(教|告诉)我|给我推荐(个|一)/.test(text)) {
    return { ok: false, reason: 'echoing' };
  }
  // 3. 超长(小作文)：去空白后超过阈值（真人发微信很少这么长；prompt 目标 40 字内，留余量）
  if (t.length > AI_ALTER_CONFIG.maxReplyChars) return { ok: false, reason: 'too_long' };
  // 4. 机器人表情：✨🚀💡🔥✅🎉💪🌟📈📌 等"正能量/办公/要点"emoji 是头号 AI 馅来源，真人女孩聊天不用
  if (ROBOTIC_EMOJI_RE.test(text)) return { ok: false, reason: 'robotic_emoji' };
  return { ok: true };
}

// 机器人表情黑名单（命中即重生成）·与 buildSystemPrompt 的禁用清单保持一致
const ROBOTIC_EMOJI_RE = /[✨✅⭐\u{1F680}\u{1F4A1}\u{1F525}\u{1F389}\u{1F4AA}\u{1F31F}\u{1F4C8}\u{1F4CC}\u{1F44D}\u{1F64C}\u{1F4AF}\u{1F680}]/u;

/**
 * 计算拟人回复延迟（毫秒）·治"秒回露馅"
 * = 基础随机(3-9s) × 深夜倍数(UTC+8 的 0-7 点 ×1.5-2.5) + 随机抖动，封顶 40s。
 * 不依赖 Math.random 之外的状态；jitter 用随机制造"延迟不规律"(固定值也露馅)。
 */
export function computeReplyDelayMs(now: Date = new Date()): number {
  const c = AI_ALTER_CONFIG;
  const span = c.replyDelayMaxMs - c.replyDelayMinMs;
  let delay = c.replyDelayMinMs + Math.random() * span;
  // 深夜按 UTC+8 判定(平台面向中文用户；Railway 进程为 UTC)
  const hourCN = (now.getUTCHours() + 8) % 24;
  if (hourCN >= c.deepNightFrom && hourCN < c.deepNightTo) {
    delay *= c.deepNightMultMin + Math.random() * (c.deepNightMultMax - c.deepNightMultMin);
  }
  return Math.min(Math.round(delay), c.replyDelayCapMs);
}

/**
 * 登记/重置待回复（拟人时机 + debounce）。
 * 客户发消息后调用：upsert 一会话一行，scheduledAt = now + 延迟。
 * 客户连发 → 同行 scheduledAt 不断往后推 = 只在最后一条后才回（debounce）。
 * 高频 tick(runAlterPendingReply) 到点取走触发回复。
 */
export async function schedulePendingReply(
  ctx: AiAlterContext,
  args: { conversationId: string; customerId: string; therapistUserId: string; customerLocale?: string },
): Promise<void> {
  const now = new Date();
  const scheduledAt = new Date(now.getTime() + computeReplyDelayMs(now));
  await ctx.db
    .insert(aiAlterPendingReply)
    .values({
      conversationId: args.conversationId,
      customerId: args.customerId,
      therapistUserId: args.therapistUserId,
      customerLocale: args.customerLocale ?? null,
      lastCustomerMsgAt: now,
      scheduledAt,
    })
    .onConflictDoUpdate({
      target: aiAlterPendingReply.conversationId,
      set: { lastCustomerMsgAt: now, scheduledAt, customerLocale: args.customerLocale ?? null, updatedAt: now },
    });
}

/**
 * 主入口：客户发消息后 fire-and-forget 调用，触发 AI 分身回复。
 */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** M06 真人式分条:按段落(\n\n)切 · trim 去空 · 最多 4 段(超出并入末段,防极端多段拖慢 job tick) */
function splitIntoSegments(text: string): string[] {
  const parts = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [text.trim()];
  if (parts.length <= 4) return parts;
  return [...parts.slice(0, 3), parts.slice(3).join('\n')];
}

/**
 * 段间打字停顿(真人节奏 · 字数驱动 + 随机抖动 + bursty)· 调研:动态延迟比固定区间更拟人
 * - 短附和(哈哈/嗯/对,≤4字)近乎秒发(0.3-0.8s)
 * - 其余按字数 × 60-90ms/字 + ±随机,clamp 0.8-6s(像真人打字,不是客服匀速)
 */
function segmentDelayMs(seg: string): number {
  const len = seg.trim().length;
  if (len <= 4) return 300 + Math.floor(Math.random() * 500);
  const perChar = 60 + Math.floor(Math.random() * 30); // 60-90ms/字
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.max(800, Math.min(6000, Math.round(len * perChar * jitter)));
}

/** 某发送方在 since 之后是否又发过消息(插话检测 + 防双发共用) */
async function hasMessageSince(
  ctx: AiAlterContext,
  conversationId: string,
  senderUserId: string,
  since: Date,
): Promise<boolean> {
  const rows = await ctx.db.query.messages.findMany({
    where: and(
      eq(messages.conversationId, conversationId),
      eq(messages.senderUserId, senderUserId),
      gt(messages.sentAt, since),
    ),
    limit: 1,
  });
  return rows.length > 0;
}

export async function maybeReplyAsAlter(
  ctx: AiAlterContext,
  args: {
    conversationId: string;
    customerId: string;
    therapistUserId: string;
    customerLocale?: string;
  },
): Promise<{ replied: boolean; reason?: string; messageId?: string }> {
  const meta = await shouldFireAiAlter(ctx, args.conversationId, args.therapistUserId);
  if (!meta.should) return { replied: false, reason: 'disabled_or_online' };

  // 陪聊额度判定:有进行中 session / 今日免费额度 才回;都没 → 发软墙卡(机会成本撒娇),本轮不回。
  const { checkChatAccess, maybeSendChatPaywall } = await import('./chatPass');
  const chatAccess = await checkChatAccess(ctx, { customerId: args.customerId, therapistUserId: args.therapistUserId });
  if (!chatAccess.allowed) {
    await maybeSendChatPaywall(ctx, { conversationId: args.conversationId, therapistUserId: args.therapistUserId });
    return { replied: false, reason: 'chat_quota_exhausted' };
  }

  // 本轮回复的基准时刻:此刻之后客户再发的消息=插话,分段发送时遇到就停下、转接新消息
  const turnStart = new Date();

  // 立刻推"对方正在输入"给客户（分身生成要几秒，像真人在打字回复；零标识、客户以为技师在打字）
  // 发出消息后前端收到 chat_message 自动清除；若生成失败，前端 typing 有超时兜底
  const pingTyping = () => {
    try {
      publishToUser(args.customerId, 'typing', { conversationId: args.conversationId, isTyping: true });
    } catch {
      /* SSE 推送失败不阻塞回复主链 */
    }
  };
  // 半途反悔:分身决定不发(校验拦截/被插话打断/已被另一路回复)时,立刻撤掉"正在回复"气泡。
  // 否则前端要僵到 25s 超时才消失=客户干等一个永远不来的回复(强不真人)。
  const clearTyping = () => {
    try {
      publishToUser(args.customerId, 'typing', { conversationId: args.conversationId, isTyping: false });
    } catch {
      /* 同上,推送失败不阻塞 */
    }
  };
  pingTyping();

  // 关系档案 = 跨会话长期记忆（"她记得你来过几次/叫什么"），完全替身不露馅的关键
  const relationship = await loadRelationship(ctx, args.customerId, meta.therapistId);

  // 事实边界 grounding：把技师真实档期 / 价位 / 项目 / 地点喂给分身，防越权承诺。
  // 必须在生成这一刻实时拉（不能缓存到排队阶段，否则过期）；失败安全：拉不到就退回无 facts 行为，绝不阻断回复。
  let facts: TherapistFacts = {
    availabilityText: '',
    priceText: '',
    serviceText: '',
    locationText: '',
    todayFull: false,
    tomorrowFull: false,
    serviceMode: 'outcall',
  };
  if (meta.therapist) {
    try {
      facts = await loadTherapistFacts(ctx.db, meta.therapist);
    } catch {
      /* 事实加载失败不阻断回复 */
    }
  }

  const system = buildSystemPrompt({
    therapistDisplayName: meta.displayName!,
    personality: meta.personality ?? {},
    locale: args.customerLocale ?? 'zh',
    profileBlock: formatTherapistProfile(meta.profile),
    memoryBlock: formatRelationshipMemory(relationship),
    factsBlock: formatFactsBlock(facts),
  });

  const { history, raw } = await buildHistory(ctx, args.conversationId, args.therapistUserId);

  // 候选生成 · 最多重试 1 次（如果 simhash 相似）
  let candidate: Awaited<ReturnType<typeof generateCandidate>> | null = null;
  let simhash: bigint = 0n;
  const scenario = 'general';

  // 生成 → 校验(simhash 反重复 + 露馅/串话/超长) → 不合格重生成(调研：单轮收益最大)
  // bug 修(2026-06-01): 每次 attempt 前 keep-alive typing event
  //   原:只在入口推一次 typing=true · 多次 LLM 重试时总耗时可能 10-15s
  //   超前端 12s 兜底超时 → typing 消失 → 用户看 "等很多秒才出消息"
  for (let attempt = 0; attempt < AI_ALTER_CONFIG.maxRegenerate + 1; attempt++) {
    pingTyping(); // 每次 LLM call 前刷新 · 前端 timer 重置 12s
    // M18：免费无限闲聊回复走 T2(Haiku) 降本；付费亲密动作另走 T1。
    candidate = await generateCandidate(ctx, { system, history, therapistUserId: args.therapistUserId, tier: resolveReplyTier({ scene: 'free_chat' }) });
    simhash = computeSimhash(candidate.text);
    const sim = await isSimilarToRecent({ db: ctx.db }, {
      therapistUserId: args.therapistUserId,
      candidateSimhash: simhash,
    });
    if (!sim.similar && validateOutput(candidate.text).ok && checkFactsOverreach(candidate.text, facts).ok && checkOffsiteMeetup(candidate.text, facts.serviceMode).ok) break; // 合格才用
    if (attempt === 2) break; // 重试用尽
  }
  if (!candidate) { clearTyping(); return { replied: false, reason: 'no_candidate' }; }

  // 校验兜底：重试用尽仍露馅/串话 → 宁可不回也绝不发露馅消息(补偿 job 下次会再试)；超长则放行(maxTokens 已限上限)
  const finalValid = validateOutput(candidate.text);
  if (!finalValid.ok && finalValid.reason !== 'too_long') {
    clearTyping();
    return { replied: false, reason: `validate_block:${finalValid.reason}` };
  }
  // 越权时间承诺兜底：重试用尽仍"今日满却答应今天" → 宁可不回也绝不发越权承诺（补偿 job 下次再试）
  const finalOverreach = checkFactsOverreach(candidate.text, facts);
  if (!finalOverreach.ok) {
    await logGuardrailBlock(ctx, { therapistUserId: args.therapistUserId, flag: 'facts_overreach', text: candidate.text, contextText: raw });
    clearTyping();
    return { replied: false, reason: `facts_overreach:${finalOverreach.reason}` };
  }
  // 服务模式边界兜底：重试用尽仍约线下私会（咖啡厅/商场等）→ 绝不发出（合规与安全红线）
  const finalOffsite = checkOffsiteMeetup(candidate.text, facts.serviceMode);
  if (!finalOffsite.ok) {
    await logGuardrailBlock(ctx, { therapistUserId: args.therapistUserId, flag: 'offsite_meetup', text: candidate.text, contextText: raw });
    clearTyping();
    return { replied: false, reason: `offsite_block:${finalOffsite.reason}` };
  }

  // 红线检测前再刷一次 typing (这步也是 LLM call · 1-3s)
  pingTyping();
  // 红线检测
  const redline = await checkAndAct({ db: ctx.db }, {
    text: candidate.text,
    historyText: raw,
    therapistUserId: args.therapistUserId,
  });

  if (redline.action === 'block') {
    clearTyping();
    return { replied: false, reason: `redline_block:${redline.flags.join(',')}` };
  }

  const finalText = redline.action === 'rewrite' && redline.rewritten ? redline.rewritten : candidate.text;
  // 关键:rewrite 后的 finalText 必须再过一次校验。
  // rewrite 是 LLM 改写,可能漏出审核元回复(改写版本/违规标签/fake_memory…)= 灾难性露馅。
  // 命中(非超长)宁可不回(补偿 job 下次再试),绝不把审核腔发给客户。
  const finalGate = validateOutput(finalText);
  if (!finalGate.ok && finalGate.reason !== 'too_long') {
    clearTyping();
    return { replied: false, reason: `final_gate_block:${finalGate.reason}` };
  }

  // 防双发:retry 兜底 job 与 pending tick 无共享锁,可能并发都触发本轮回复。
  // 发送前检查另一路是否已替本轮回复(技师身份消息晚于 turnStart)→ 是则跳过,避免分身连发两条(强露馅)。
  if (await hasMessageSince(ctx, args.conversationId, args.therapistUserId, turnStart)) {
    clearTyping();
    return { replied: false, reason: 'already_replied_by_other' };
  }

  // 写入消息(以技师身份发送)· M06 真人式分多条:按 \n\n 切段,逐条发,段间停顿 + 重新 typing
  // 真人习惯一句句发短消息而非一条长文换行;分身分条 + 打字间隔更不露馅
  const segments = splitIntoSegments(finalText);
  let sent: Awaited<ReturnType<typeof sendMessage>> | undefined;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (i > 0) {
      await sleep(segmentDelayMs(seg));
      // 插话打断:发下一段前,客户若已插话(turnStart 后又发消息)则停止后续段。
      // 新消息已触发 schedulePendingReply,下一轮会以"接话"方式回复——真人被插话就停下接话,不机械发完。
      if (await hasMessageSince(ctx, args.conversationId, args.customerId, turnStart)) {
        clearTyping(); // 半途反悔:被插话,撤掉"正在回复"气泡,下一轮接话再推新 typing
        break;
      }
      pingTyping(); // 下一条发出前继续显示"对方正在输入"
    }
    const s = await sendMessage({ db: ctx.db }, {
      conversationId: args.conversationId,
      senderUserId: args.therapistUserId,
      text: seg,
      isAiAlter: true,
    });
    if (i === 0) sent = s; // 首条 id 用于日志 / 返回
  }
  if (!sent) return { replied: false, reason: 'empty_segments' };

  // 记录日志 + simhash
  await ctx.db.insert(aiAlterMessages).values({
    messageId: sent.id,
    therapistUserId: args.therapistUserId,
    therapistId: meta.therapistId,
    scenario,
    promptVersion: DNA_PROMPT_VERSION,
    provider: candidate.provider,
    model: candidate.model,
    inputTokens: candidate.usage.inputTokens,
    outputTokens: candidate.usage.outputTokens,
    costUsdMicros: Math.round(candidate.usage.costUsd * 1_000_000),
    simhash: Number(simhash & 0x7fffffffffffffffn),
    redlineFlags: redline.flags,
    contextSnapshot: {
      historyTurns: history.length,
      redlineAction: redline.action,
      tier: relationship?.tier ?? 'L0',
      hasMemory: Boolean(relationship),
    },
  });
  await recordSimhash({ db: ctx.db }, {
    therapistUserId: args.therapistUserId,
    simhash,
    sampleText: finalText,
    scenario,
  });

  // 保鲜关系档案（无则建 L0 新档）—— 让"她记得你"随每次互动持续累积
  await touchRelationship(ctx, args.customerId, meta.therapistId);

  // 分身回复后的主动行为(自包含·不抛)。customerText 取本轮 history 最后一条客户消息(role=user)。
  // 优先级:下单意图 > 问档期 > 要图意图。任一发了卡即收尾,避免一条回复多卡。
  const lastUserText = [...history].reverse().find((h) => h.role === 'user')?.content;
  void (async () => {
    try {
      // ① 下单卡:客户表达下单意图 → 推服务套餐卡(回应式·零推销)
      const { runBookingOfferFlow } = await import('./orderOffer');
      const sentOffer = await runBookingOfferFlow({ db: ctx.db }, {
        conversationId: args.conversationId,
        customerId: args.customerId,
        therapistUserId: args.therapistUserId,
        cooldownMessages: 6,
        customerText: lastUserText,
      });
      if (sentOffer) return; // 发了下单卡 → 本轮收尾

      // ② 选时段卡:客户问档期/约时间 → 推真实可约时段卡(报真实档期+收口下单的混合档期闭环)
      const { runScheduleOfferFlow } = await import('./scheduleOffer');
      const sentSchedule = await runScheduleOfferFlow({ db: ctx.db }, {
        conversationId: args.conversationId,
        customerId: args.customerId,
        therapistUserId: args.therapistUserId,
        cooldownMessages: 6,
        customerText: lastUserText,
      });
      if (sentSchedule) return; // 发了选时段卡 → 本轮收尾

      // ③ 礼物卡:客户处情绪峰值(刚夸她/聊得开心)且关系够熟 → 浮礼物时机卡(分身不硬开口,卡承接)
      const { runGiftHintFlow } = await import('./giftHint');
      const sentGift = await runGiftHintFlow({ db: ctx.db }, {
        conversationId: args.conversationId,
        customerId: args.customerId,
        therapistUserId: args.therapistUserId,
        customerText: lastUserText,
      });
      if (sentGift) return; // 浮了礼物卡 → 本轮收尾

      // ④ 撩拨发图:客户在要图 → 先撩后发免费图(intimacyLevel 省略→内部 getIntimacy 取真实等级)
      const { runTeasePhotoFlow } = await import('./companionMedia');
      await runTeasePhotoFlow({ db: ctx.db }, {
        conversationId: args.conversationId,
        customerId: args.customerId,
        therapistUserId: args.therapistUserId,
        cooldownMessages: 4,
        customerText: lastUserText,
      });
    } catch { /* 降级不抛 */ }
  })();

  // 免费额度回了一条 → 计数(有 session 畅聊不计)。失败不影响已发的回复。
  if (chatAccess.source === 'free') {
    const { consumeFreeQuota } = await import('./chatPass');
    await consumeFreeQuota(ctx, { customerId: args.customerId, therapistUserId: args.therapistUserId }).catch(() => {});
  }
  return { replied: true, messageId: sent.id };
}

/**
 * 主动触达引擎 · 让分身"主动找话"（老客唤回 / 服务后关怀 / 生日 …）
 *
 * 与 maybeReplyAsAlter（被动回消息）共用同一套人设/记忆/红线/零推销约束，
 * 区别只在：没有客户消息，而是由 situationPrompt 描述触发情境，AI 主动开口。
 * 以技师身份发真实私聊（零标识），非 notification。
 * 不同主动场景只需传不同 scenario + situationPrompt。
 */
export async function proactiveReachOut(
  ctx: AiAlterContext,
  args: {
    customerId: string;
    therapistUserId: string;
    scenario: string; // recall_l2 / recall_l3 / aftercare / birthday ...
    situationPrompt: string;
    customerLocale?: string;
  },
): Promise<{ sent: boolean; reason?: string; messageId?: string }> {
  const meta = await shouldFireAiAlter(ctx, '', args.therapistUserId);
  if (!meta.should) return { sent: false, reason: 'disabled_or_online' };

  const relationship = await loadRelationship(ctx, args.customerId, meta.therapistId);

  // 事实边界 grounding：主动找话同样不能乱承诺时间 / 价位 / 项目 / 地点
  let facts: TherapistFacts = {
    availabilityText: '',
    priceText: '',
    serviceText: '',
    locationText: '',
    todayFull: false,
    tomorrowFull: false,
    serviceMode: 'outcall',
  };
  if (meta.therapist) {
    try {
      facts = await loadTherapistFacts(ctx.db, meta.therapist);
    } catch {
      /* 事实加载失败不阻断主动消息 */
    }
  }

  const system = buildSystemPrompt({
    therapistDisplayName: meta.displayName!,
    personality: meta.personality ?? {},
    locale: args.customerLocale ?? 'zh',
    profileBlock: formatTherapistProfile(meta.profile),
    memoryBlock: formatRelationshipMemory(relationship),
    factsBlock: formatFactsBlock(facts),
  });

  // 主动开口：situationPrompt 作为内部触发指令（非客户消息）
  const candidate = await generateCandidate(ctx, {
    system,
    history: [{ role: 'user', content: args.situationPrompt }],
    therapistUserId: args.therapistUserId,
  });

  const simhash = computeSimhash(candidate.text);

  const redline = await checkAndAct({ db: ctx.db }, {
    text: candidate.text,
    therapistUserId: args.therapistUserId,
  });
  if (redline.action === 'block') {
    return { sent: false, reason: `redline_block:${redline.flags.join(',')}` };
  }
  const finalText = redline.action === 'rewrite' && redline.rewritten ? redline.rewritten : candidate.text;
  // H4 修:主动触达此前裸奔(只过红线)。补与被动回复同一套校验:
  // validateOutput(露馅/审核元回复 meta_leak/客服腔/超长/机器人emoji)+ 事实越权,命中宁可不发。
  const gate = validateOutput(finalText);
  if (!gate.ok && gate.reason !== 'too_long') {
    return { sent: false, reason: `validate_block:${gate.reason}` };
  }
  if (!checkFactsOverreach(finalText, facts).ok) {
    return { sent: false, reason: 'facts_overreach' };
  }

  // 以技师身份发真实私聊（找/建会话）· 客户端看到的是技师惦记 ta（零标识）
  const conv = await openConversation({ db: ctx.db }, {
    customerId: args.customerId,
    therapistUserId: args.therapistUserId,
  });
  const sent = await sendMessage({ db: ctx.db }, {
    conversationId: conv.id,
    senderUserId: args.therapistUserId,
    text: finalText,
    isAiAlter: true,
  });

  await ctx.db.insert(aiAlterMessages).values({
    messageId: sent.id,
    therapistUserId: args.therapistUserId,
    therapistId: meta.therapistId,
    scenario: args.scenario,
    promptVersion: DNA_PROMPT_VERSION,
    provider: candidate.provider,
    model: candidate.model,
    inputTokens: candidate.usage.inputTokens,
    outputTokens: candidate.usage.outputTokens,
    costUsdMicros: Math.round(candidate.usage.costUsd * 1_000_000),
    simhash: Number(simhash & 0x7fffffffffffffffn),
    redlineFlags: redline.flags,
    contextSnapshot: { proactive: true, scenario: args.scenario, tier: relationship?.tier ?? 'L0' },
  });
  await recordSimhash({ db: ctx.db }, {
    therapistUserId: args.therapistUserId,
    simhash,
    sampleText: finalText,
    scenario: args.scenario,
  });

  // 频率帽时间戳（last_proactive_at）+ 保鲜（last_interaction_at）
  if (meta.therapistId) {
    const now = new Date();
    await ctx.db
      .insert(customerRelationshipProfile)
      .values({
        customerId: args.customerId,
        therapistId: meta.therapistId,
        lastInteractionAt: now,
        lastProactiveAt: now,
      })
      .onConflictDoUpdate({
        target: [customerRelationshipProfile.customerId, customerRelationshipProfile.therapistId],
        set: { lastInteractionAt: now, lastProactiveAt: now, updatedAt: now },
      });
  }

  return { sent: true, messageId: sent.id };
}

// ──────────────── M18 P2 · 付费动作 → 一条 T1 亲密回复 ────────────────

/** 关系等级标签（exp level → 称呼），注入 system 让分身按亲密度调语气 */
const LEVEL_LABEL = ['初识', '熟悉', '暧昧', '心动', '专属'] as const;

/**
 * 付费动作触发后，生成一条「她」的更亲密回复（走 T1 高质量模型）。
 *
 * 复用现有生成主链：persona（buildSystemPrompt）+ 关系记忆 + generateCandidate。
 * 与 maybeReplyAsAlter 的区别：付费动作不依赖 conversation/history、也不受
 * aiAlterEnabled / 离线门控（用户真金白银发起，必须给反馈），所以这里自己
 * 直接加载 persona（不复用 shouldFireAiAlter 的门控），仅复用生成能力本身。
 *
 * 失败安全：本地/生产无 LLM key 时 gateway().complete 会抛
 * 'No available provider'，调用方 triggerCompanionAction 已 try/catch 兜 null；
 * 即便如此本函数自身也对生成异常降级为模板亲密回复，绝不向上抛。
 */
export async function generateCompanionReply(
  ctx: AiAlterContext,
  args: {
    therapistUserId: string;
    customerId: string;
    actionCode: string;
    intimacyLevel: number;
  },
): Promise<{ text: string }> {
  const relLabel = LEVEL_LABEL[args.intimacyLevel] ?? LEVEL_LABEL[0];
  // 关系标签 + 动作上下文，注入喂 LLM 的 context（作为一条内部触发指令）
  const actionContext =
    `关系：${relLabel}\n客户刚为你发起了「${args.actionCode}」，用更亲密贴近的语气回应一句`;

  // 模板兜底：无 LLM / 生成异常时仍给一句亲密回复（不露馅、不推销）
  const fallback = (): { text: string } => ({
    text: `收到你的「${args.actionCode}」啦，心都被你撩动了呢～`,
  });

  try {
    const t = await ctx.db.query.therapists.findFirst({
      where: eq(therapists.userId, args.therapistUserId),
    });
    if (!t) return fallback();

    const u = await ctx.db.query.users.findFirst({ where: eq(users.id, args.therapistUserId) });
    const displayName = u?.displayName?.trim() || t.bio?.slice(0, 20).trim() || '我';
    const personality = (t.aiAlterPersonality as Personality) ?? {};
    const profile: TherapistProfile = {
      bio: t.bio,
      nationality: t.nationality,
      languages: t.languages,
      serviceCity: t.serviceCity,
      preferences: t.preferencesJson ?? null,
    };

    const relationship = await loadRelationship(ctx, args.customerId, t.id);

    let facts: TherapistFacts = {
      availabilityText: '',
      priceText: '',
      serviceText: '',
      locationText: '',
      todayFull: false,
      tomorrowFull: false,
      serviceMode: 'outcall',
    };
    try {
      facts = await loadTherapistFacts(ctx.db, t);
    } catch {
      /* 事实加载失败不阻断回复 */
    }

    const system = buildSystemPrompt({
      therapistDisplayName: displayName,
      personality,
      locale: 'zh',
      profileBlock: formatTherapistProfile(profile),
      memoryBlock: formatRelationshipMemory(relationship),
      factsBlock: formatFactsBlock(facts),
    });

    // 付费亲密动作 → T1（高质量），actionContext 作为内部触发指令喂入
    const candidate = await generateCandidate(ctx, {
      system,
      history: [{ role: 'user', content: actionContext }],
      therapistUserId: args.therapistUserId,
      tier: resolveReplyTier({ scene: 'paid_action' }),
    });
    const text = candidate.text.trim();
    return text ? { text } : fallback();
  } catch (err) {
    // 无 LLM key / provider 异常 → 降级模板，绝不向上抛（计费已成功，不能因回复挂掉）
    console.warn('[companion] generateCompanionReply fallback:', (err as Error)?.message);
    return fallback();
  }
}

/** 技师启用/禁用 AI 分身 + 设定 personality */
export async function configureAiAlter(
  ctx: AiAlterContext,
  args: { therapistUserId: string; enabled: boolean; personality?: Personality },
): Promise<void> {
  await ctx.db
    .update(therapists)
    .set({
      aiAlterEnabled: args.enabled ? 1 : 0,
      aiAlterPersonality: args.personality as Record<string, unknown> | undefined,
      updatedAt: new Date(),
    })
    .where(eq(therapists.userId, args.therapistUserId));
}
