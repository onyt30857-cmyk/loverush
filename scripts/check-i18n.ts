#!/usr/bin/env bun
/**
 * i18n key 一致性检查
 *
 * 用法：bun scripts/check-i18n.ts
 * 退出码：0 = 一致；1 = 有 missing / extra / 空值
 *
 * 用 zh.json 作为 source-of-truth：
 * - 其他语种 missing key → 错（生产会 fallback 到 key 名，体验差）
 * - 其他语种 extra key → 警告（zh 没有的 key 应当先在 zh 加）
 * - 任何语种空字符串 → 错（视为漏译）
 * - 占位符 {{var}} 必须与 zh 一致（不一致 → 翻译时漏了变量）
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, '..', 'packages', 'i18n', 'src', 'locales');
const SOURCE = 'zh';

function load(locale: string): Json {
  return JSON.parse(readFileSync(join(localesDir, `${locale}.json`), 'utf8'));
}

function flatten(obj: Json, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (typeof obj === 'string') out[prefix] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      out[key] = v;
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    }
  }
  return out;
}

function extractVars(s: string): string[] {
  const matches = s.match(/\{\{\s*(\w+)\s*\}\}/g) ?? [];
  return matches.map((m) => m.replace(/[{}\s]/g, '')).sort();
}

const sourceFlat = flatten(load(SOURCE));
const sourceKeys = new Set(Object.keys(sourceFlat));

const locales = readdirSync(localesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''))
  .filter((l) => l !== SOURCE);

let errCount = 0;
let warnCount = 0;

console.log(`\n[i18n check] source=${SOURCE} · target locales: ${locales.join(', ')}\n`);

for (const locale of locales) {
  const targetFlat = flatten(load(locale));
  const targetKeys = new Set(Object.keys(targetFlat));

  const missing: string[] = [];
  const extra: string[] = [];
  const empty: string[] = [];
  const varMismatch: string[] = [];

  for (const k of sourceKeys) {
    if (!targetKeys.has(k)) {
      missing.push(k);
    } else {
      const tv = targetFlat[k];
      if (!tv || tv.trim() === '') empty.push(k);
      const sv = sourceFlat[k];
      const sVars = extractVars(sv).join(',');
      const tVars = extractVars(tv).join(',');
      if (sVars !== tVars) varMismatch.push(`${k}  zh=[${sVars}]  ${locale}=[${tVars}]`);
    }
  }

  for (const k of targetKeys) if (!sourceKeys.has(k)) extra.push(k);

  const localeErr = missing.length + empty.length + varMismatch.length;
  const localeWarn = extra.length;
  errCount += localeErr;
  warnCount += localeWarn;

  if (localeErr === 0 && localeWarn === 0) {
    console.log(`  [OK]    ${locale}.json  (${targetKeys.size} keys)`);
    continue;
  }

  console.log(`  [FAIL]  ${locale}.json`);
  if (missing.length) {
    console.log(`    - missing ${missing.length}:`);
    for (const k of missing) console.log(`        ${k}`);
  }
  if (empty.length) {
    console.log(`    - empty ${empty.length}:`);
    for (const k of empty) console.log(`        ${k}`);
  }
  if (varMismatch.length) {
    console.log(`    - placeholder mismatch ${varMismatch.length}:`);
    for (const k of varMismatch) console.log(`        ${k}`);
  }
  if (extra.length) {
    console.log(`    - extra ${extra.length} (warn):`);
    for (const k of extra) console.log(`        ${k}`);
  }
}

console.log(
  `\n[i18n check] done. errors=${errCount}  warnings=${warnCount}  source keys=${sourceKeys.size}\n`,
);

if (errCount > 0) process.exit(1);
process.exit(0);
