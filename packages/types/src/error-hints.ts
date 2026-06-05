/**
 * 错误自查表 · admin 后台 system-errors 页"点开看 hint"用
 *
 * 维护原则:
 *   - reason 1 句解释(运营/客服能秒懂)
 *   - checkSteps 3-5 步排查动作(用 imperative 第二人称)
 *   - 通用层(server/db/external)优先级最高 · 业务码次之
 *
 * key 既包含 ErrorCode(E0001 等) 也包含通用 type/route key(如 'db_timeout' / 'server_500')
 */

export interface ErrorHint {
  /** 运营视角人话:这个错会让"谁、在哪、看到什么" · 不懂技术也能秒懂 */
  impact?: string;
  reason: string;
  checkSteps: string[];
  /** 默认严重度(查询时用 · admin UI 可视化) */
  severity?: number;
}

export const ERROR_HINTS: Record<string, ErrorHint> = {
  // ──────────────── 通用层(优先匹配) ────────────────
  server_500: {
    impact: '某个页面或操作"打不开/点了报错" · 用户卡在那一步用不了 · 多半是代码 bug 要工程修',
    reason: '后端代码异常 · 未捕获的 throw/promise reject',
    checkSteps: [
      '点开看 stack · 找到最近一行项目代码',
      '复制 sampleRequestId 到 Railway logs 搜该请求完整上下文',
      '若同一 fingerprint 短时连续 ≥10 次 · 立即回滚最近一次部署',
      'fix 后点"已修复" · count 重新计数',
    ],
    severity: 80,
  },
  db_connection_failed: {
    impact: '大面积"打不开/转圈" · 几乎所有功能同时受影响 · 最高优先级 · 多半是数据库扛不住或连不上',
    reason: 'DB 连接失败 · pool 满 / Supabase 限流 / 网络抖',
    checkSteps: [
      '打开 Supabase Dashboard 看 connections / CPU',
      '看 Railway api service metrics 是否 burst',
      '若 connections 满 · 升 Supabase 套餐 或 调小 pool size 复用',
      '看本次部署是否引入新 DB hot path(N+1 查询)',
    ],
    severity: 90,
  },
  db_timeout: {
    impact: '某些页面"加载很久最后报错" · 越用人多越明显 · 多半是某条查询太慢',
    reason: 'DB 查询超时 · 慢查询 / 索引缺失 / 锁等待',
    checkSteps: [
      'Supabase Dashboard 看 Query Performance · 找最慢的语句',
      'EXPLAIN ANALYZE 该 query 看是否全表扫',
      '加索引 或 改 query 限制 result set',
      '看是否有死锁(deadlock detected log)',
    ],
    severity: 85,
  },
  external_api_failed: {
    impact: 'AI 不回话 / 图片传不上 / 付款失败之类 · 通常是我们用的第三方服务挂了 · 不一定是我们代码问题',
    reason: '外部 API 失败 · LLM/Cloudflare R2/支付通道挂',
    checkSteps: [
      '看 stack 确认哪家 provider(Anthropic/OpenAI/R2)',
      '该 provider 官方 status 页查事故',
      '看 .env 凭证是否过期/被吊销',
      '加重试机制(若没有)',
    ],
    severity: 70,
  },
  rate_limit_burst: {
    impact: '有人短时间疯狂请求被系统挡了 · 可能是攻击/刷接口,也可能是真高峰 · 看是不是同一个人',
    reason: '限流频繁触发 · 攻击 / 客户端 bug 重发 / 业务高峰',
    checkSteps: [
      '看 sample_user_id 是否同一用户高频(攻击)',
      '看 sample_payload IP 是否集中(分布式攻击)',
      '若正常业务高峰 · 调大限流阈值',
      '若是攻击 · 加 ip_blacklist',
    ],
    severity: 60,
  },

  // ──────────────── 认证类 ────────────────
  E1001: {
    reason: 'OTP / 账号密码不正确',
    checkSteps: [
      '看 sample_user_id 是否真实存在',
      '若同 handle 连续失败 · 看是不是被暴力破解(查 risk_events login_wrong_password)',
      '客户端可能用错 endpoint',
    ],
    severity: 30,
  },
  E1002: {
    reason: 'OTP 已过期 · 用户输入太慢 / 系统时钟漂移',
    checkSteps: ['客户端把 OTP TTL 提示给用户(默认 5min)', '看服务器时间是否同步 NTP'],
    severity: 20,
  },
  E1010: {
    reason: 'OTP 限流触发 · 客户端短时多次请求',
    checkSteps: ['看是不是 retry 逻辑写错', '看是不是同一手机被刷'],
    severity: 40,
  },
  E1020: {
    reason: 'Telegram initData 验证失败 · TG bot token 错或被改',
    checkSteps: ['检查 TELEGRAM_BOT_TOKEN env', '看是不是有人伪造 Telegram WebApp 请求'],
    severity: 70,
  },
  E1031: {
    reason: '邀请码无效 · 已用 / 过期 / 不存在',
    checkSteps: ['DB SELECT invite_codes WHERE code = ?', '看是否被人爆破猜码'],
    severity: 25,
  },
  E1040: {
    reason: 'BIP-39 助记词恢复失败',
    checkSteps: ['看用户输入是否漏字/拼错', '客户端 Trim/lowercase 是否做对'],
    severity: 30,
  },

  // ──────────────── 用户/资金类 ────────────────
  E2010: {
    reason: '余额不足 · 客户点抢单/付费时积分不够',
    checkSteps: ['SELECT points_account WHERE user_id = sample_user_id', '看是不是积分扣双了(payments 日志)'],
    severity: 25,
  },

  // ──────────────── 订单类 ────────────────
  E3050: {
    reason: '订单状态机非法跳转 · 并发改单 / 状态过期 / 客户端缓存旧态',
    checkSteps: ['SELECT orders WHERE id = sample 看当前 status', '看 admin_audit_log 谁动了'],
    severity: 50,
  },

  // ──────────────── AI 类 ────────────────
  E5040: {
    reason: 'AI 红线拦截 · 涉黄涉政关键词',
    checkSteps: ['看 sample_payload 触发的 flags', '若误伤 · 在 ai_alter_redline_logs 看是不是新词需要白名单'],
    severity: 50,
  },
  E5050: {
    reason: 'LLM Provider 挂 · Anthropic/OpenAI 故障',
    checkSteps: ['查 provider status 页', '看 fallback chain 是否生效', '是否要临时切到备用 provider'],
    severity: 70,
  },

  // ──────────────── 风控类 ────────────────
  E7001: {
    reason: '被封禁用户尝试登录 · 通常意味着账号已被 admin 封但用户不知道',
    checkSteps: [
      'SELECT users WHERE id = sample_user_id · 确认 status = banned',
      '查 admin_audit_log 看封禁原因',
      '若大量同一用户尝试登录 · 可能在试图找回 · 客服跟进',
    ],
    severity: 40,
  },

  // ──────────────── 系统类 ────────────────
  E9000: {
    reason: '请求被限流',
    checkSteps: ['同上 rate_limit_burst'],
    severity: 50,
  },
  E9999: {
    impact: '某个操作出错了但系统没说清是哪种 · 看下面"大概是什么问题"和技术原文判断',
    reason: '内部错误兜底码 · 真实原因看 stack',
    checkSteps: ['同上 server_500 (没有指定 code 的 5xx)'],
    severity: 80,
  },
};

/**
 * 把后端/数据库的英文原始报错翻成人话标题(运营/客服一眼看懂"大概啥问题")
 *
 * 只做"分类翻译" · 不替代技术原文(原文仍展示给工程定位)
 * 匹配不到返回 null(页面回退展示原始 message)
 */
export function humanizeMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.toLowerCase();

  // ── 数据库结构/SQL 类(几乎都是代码 bug,要工程修) ──
  if (m.includes('invalid input value for enum')) {
    return '代码用了一个数据库不认的状态值(枚举写错) · 工程 bug';
  }
  if (m.includes('invalid reference to from-clause') || m.includes('missing from-clause')) {
    return '数据库查询语句写错了(表引用/别名不对) · 工程 bug';
  }
  if (m.includes('column') && m.includes('does not exist')) {
    return '数据库缺了一个字段(代码和库结构对不上,多半漏跑迁移) · 工程修';
  }
  if (m.includes('relation') && m.includes('does not exist')) {
    return '数据库缺了一张表(多半漏跑迁移) · 工程修';
  }
  if (m.includes('violates not-null constraint') || m.includes('null value in column')) {
    return '必填的数据是空的就想写进库 · 工程 bug';
  }
  if (m.includes('duplicate key value') || m.includes('violates unique constraint')) {
    return '存了重复数据(同一条被存了两次) · 工程修';
  }
  if (m.includes('violates foreign key constraint')) {
    return '关联的数据不存在(比如订单指向了一个没有的用户) · 工程修';
  }
  if (m.includes('syntax error at or near')) {
    return '数据库查询语句有语法错 · 工程 bug';
  }

  // ── 连接/超时类(基础设施,不一定是代码) ──
  if (m.includes('timeout') || m.includes('etimedout') || m.includes('timed out')) {
    return '数据库或外部服务太慢、等不到回应 · 看是不是高峰或服务抖动';
  }
  if (m.includes('econnrefused') || m.includes('connection refused') || m.includes('connection terminated')) {
    return '连不上数据库或某个服务 · 多半是基础设施问题';
  }
  if (m.includes('enotfound') || m.includes('getaddrinfo')) {
    return '找不到要访问的服务地址 · 网络或配置(域名/地址)问题';
  }
  if (m.includes('fetch failed') || m.includes('network error')) {
    return '调外部服务没成功 · 网络或对方服务问题';
  }

  // ── 运行时代码 bug 类 ──
  if (m.includes('cannot read propert') || m.includes('cannot read properties') || m.includes('of undefined') || m.includes('of null')) {
    return '后端代码读了一个不存在的数据导致崩溃 · 工程 bug';
  }
  if (m.includes('is not a function')) {
    return '后端代码调用方式错了 · 工程 bug';
  }
  if (m.includes('unexpected token') && m.includes('json')) {
    return '收到的数据格式不对、解析失败 · 多半是上游返回了非预期内容';
  }

  // ── 凭证/权限类 ──
  if (m.includes('unauthorized') || m.includes('invalid api key') || m.includes('authentication failed')) {
    return '某个服务的密钥/登录失效了 · 检查 env 凭证是否过期';
  }
  if (m.includes('permission denied') || m.includes('forbidden')) {
    return '没有权限做这个操作 · 检查角色/权限配置';
  }

  return null;
}

/** 取 hint · 优先看 errorCode · 然后按 errorType+httpStatus 兜底 */
export function getErrorHint(opts: {
  errorCode?: string | null;
  errorType?: string;
  httpStatus?: number | null;
}): ErrorHint | null {
  if (opts.errorCode && ERROR_HINTS[opts.errorCode]) {
    return ERROR_HINTS[opts.errorCode] ?? null;
  }
  if (opts.errorType === 'db') {
    return ERROR_HINTS.db_timeout ?? null;
  }
  if (opts.errorType === 'external') {
    return ERROR_HINTS.external_api_failed ?? null;
  }
  if (opts.errorType === 'server' && opts.httpStatus && opts.httpStatus >= 500) {
    return ERROR_HINTS.server_500 ?? null;
  }
  return null;
}
