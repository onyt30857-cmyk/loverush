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
  reason: string;
  checkSteps: string[];
  /** 默认严重度(查询时用 · admin UI 可视化) */
  severity?: number;
}

export const ERROR_HINTS: Record<string, ErrorHint> = {
  // ──────────────── 通用层(优先匹配) ────────────────
  server_500: {
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
    reason: '内部错误兜底码 · 真实原因看 stack',
    checkSteps: ['同上 server_500 (没有指定 code 的 5xx)'],
    severity: 80,
  },
};

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
