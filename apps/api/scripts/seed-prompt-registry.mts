/**
 * 把现有硬编码 prompt 灌入 registry 作为 v1 active(后台可见可改)。
 * 幂等:已有 active 的 key 跳过。
 *
 * 跑法(生产):railway run -- pnpm tsx apps/api/scripts/seed-prompt-registry.mts
 * 跑法(本地):DATABASE_URL=... pnpm tsx apps/api/scripts/seed-prompt-registry.mts
 */
import { createDb } from '@loverush/db';
import { SYSTEM_PROMPT_ZH } from '../src/services/assistant/prompts/system-prompt-zh';
import { SYSTEM_PROMPT_EN } from '../src/services/assistant/prompts/system-prompt-en';
import {
  getActivePrompt,
  saveDraft,
  publishVersion,
} from '../src/services/prompt-registry';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('缺 DATABASE_URL');
  process.exit(1);
}
const db = createDb(url);
const ctx = { db };

const seeds: Array<{ key: string; label: string; layer: string; content: string }> = [
  { key: 'm03.system.zh', label: 'M03 助理人设 · 中文', layer: 'B', content: SYSTEM_PROMPT_ZH },
  { key: 'm03.system.en', label: 'M03 助理人设 · 英文', layer: 'B', content: SYSTEM_PROMPT_EN },
];

for (const s of seeds) {
  const existing = await getActivePrompt(ctx, s.key);
  if (existing != null) {
    console.log(`skip ${s.key}(已有 active)`);
    continue;
  }
  const draft = await saveDraft(ctx, {
    key: s.key,
    content: s.content,
    layer: s.layer,
    label: s.label,
    changeNote: '从代码常量初始化 v1',
  });
  await publishVersion(ctx, { key: s.key, version: draft.version });
  console.log(`seeded ${s.key} v${draft.version} → active`);
}

console.log('done');
process.exit(0);
