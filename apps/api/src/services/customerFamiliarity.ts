/**
 * 客户"了解程度"档 · 驱动首页 AI 智能匹配文案动态(新客谦逊+引导,熟客自信)。
 *
 * 依据真实画像深度(不是访问次数):
 *   - customer_master_preferences 已填的偏好维度(体型/服务风格/情绪需求/沟通风格/intentSummary)
 *   - customer_reference_memory 记忆条数(AI 记住了多少关于他的事)
 *
 * 归一成 0 新客 / 1 渐熟 / 2 熟客。注意:老客但从没表达过喜好 → 仍是 0(AI 确实不懂他,文案该谦逊)。
 */
import { eq, count } from 'drizzle-orm';
import type { Database } from '@loverush/db';
import { customerMasterPreferences, customerReferenceMemory } from '@loverush/db';

export type Familiarity = 0 | 1 | 2;

export async function computeCustomerFamiliarity(db: Database, userId: string): Promise<Familiarity> {
  let score = 0;

  const pref = await db.query.customerMasterPreferences.findFirst({
    where: eq(customerMasterPreferences.userId, userId),
  });
  if (pref) {
    if (pref.bodyTypePrefs && pref.bodyTypePrefs.length > 0) score += 1;
    if (pref.serviceStylePrefs && pref.serviceStylePrefs.length > 0) score += 1;
    if (pref.emotionalNeeds && pref.emotionalNeeds.length > 0) score += 1;
    if (pref.communicationStyle) score += 1;
    // LLM 维护的一句话画像 = 最强信号(说明 AI 真的形成了对他的理解)
    if (pref.intentSummary && pref.intentSummary.trim()) score += 2;
  }

  const memRows = await db
    .select({ n: count() })
    .from(customerReferenceMemory)
    .where(eq(customerReferenceMemory.userId, userId));
  const mem = memRows[0]?.n ?? 0;
  if (mem >= 3) score += 1;
  if (mem >= 8) score += 1;

  if (score <= 0) return 0;
  if (score <= 2) return 1;
  return 2;
}
