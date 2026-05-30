/**
 * Onboarding 共享类型 · 对齐 0522 信息采集表 · 9 步
 *
 * facts 是累计抓到的字段(每一步往里塞,最终写入 customer_saved_memory.facts/stable_prefs)。
 *
 * 字段来源标注:
 *   - [orig] 原 6 步保留维度
 *   - [doc]  0522 文档新增维度
 */

export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type NextStep = OnboardingStep | 'done';

export interface OnboardingFacts {
  // ── 步 1:城市 [orig]
  city?: string;

  // ── 步 2:主要关注(锚定权重 · 多选)[doc]
  //   值域:looks(颜值与身材)/ vibe(互动与性格)/ skill(按摩手法)/ service(服务态度)/ privacy(隐私安全)
  primary_focus?: string[];

  // ── 步 3:颜值风格 swipe 衍生(gender_pref + age_pref + look_style) [orig + doc]
  gender_pref?: string; // female / male / any
  age_pref?: string[]; // ['18-22','23-28','29-35','36-42']
  look_style?: string[]; // ['甜美可爱','性感妩媚','御姐气质','异域风情']

  // ── 步 4:外形偏好 4 组 [doc]
  height_pref?: string[]; // ['<=159','160-164','165-169','>=170']
  body_type?: string[]; // ['纤细苗条','匀称健康','软糯丰满','高挑大气']
  bust_pref?: string[]; // ['A-B','C','D','E-G']
  // age_pref 已在步 3 抓 · 此处不重复

  // ── 步 5:服务风格 + 服务力度 [doc]
  service_style?: string[]; // ['温柔安静','活泼聊天','成熟知性','体贴入微','元气开朗']
  service_strength?: string[]; // ['轻柔舒缓','适中均衡','力度较重','按需调整']

  // ── 步 6:国籍 + 语言 + 服务区域 [doc + orig:language]
  nationality_pref?: string[]; // ['泰国','马来西亚','中国','本地华人','缅甸','印尼','越南']
  language?: string; // zh / en / th / any · 保留单选(主沟通语言)
  service_area?: string[]; // ['30min','1h','2h','any']

  // ── 步 7:价位 + 隐私 + 小费 + 时段 [orig + doc]
  price_range?: string; // low / mid / high / flexible
  privacy_mode?: string; // codename / plain
  tip_band?: string; // none / 20-50 / 50-100 / 100-200 / 200+
  time_slot?: string; // '20:00' / '22:00' / 'tomorrow_day' / 'flexible'

  // ── 步 8:特别喜欢 + 特别讨厌(自由文本)[doc]
  likes_text?: string;
  dislikes_text?: string;

  // ── 步 9:自我推荐(自由文本)[doc]
  self_intro?: string;

  // ── 兼容旧:intent(原步 2 状态)+ style_pref(原步 3 混合风格)
  intent?: string; // relax / deep_tissue / explore
  style_pref?: string[]; // 旧 stable_prefs.priorities 数据源 · 与 look_style 合并

  /** 完成标记 */
  onboarding_complete?: boolean;
}

/**
 * 步 3 swipe payload:
 *   { liked: ['style_tender_young_f', ...], skipped: [...] }
 * 由 onboarding.ts 解析 cards.tags 抽取 gender / age / look_style。
 */
export interface SwipePayload {
  liked?: string[];
  skipped?: string[];
}
